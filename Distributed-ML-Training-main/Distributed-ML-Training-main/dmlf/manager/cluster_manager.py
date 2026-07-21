import time
import uuid
import grpc
import json
import os
import sqlite3
import threading
import hashlib
import argparse
from concurrent import futures
from typing import Dict, Any, List

from dmlf.communication import cml_pb2
from dmlf.communication import cml_pb2_grpc
from dmlf.manager.node_registry import NodeRegistry, NodeState, JobState
from dmlf.manager.queue import JobQueue
from dmlf.manager.allocator import NodeAllocator
from dmlf.manager.scheduler import Scheduler


def rendezvous_port(job_id: str, retry: int = 0) -> int:
    """Choose a distinct high TCP port for each distributed job attempt."""
    base = int(os.environ.get("DMLF_MASTER_PORT_BASE", "20000"))
    span = int(os.environ.get("DMLF_MASTER_PORT_SPAN", "20000"))
    if not (1024 <= base <= 65535 and 1 <= span <= 65536 - base):
        raise ValueError("DMLF_MASTER_PORT_BASE/SPAN must describe valid TCP ports")
    digest = hashlib.sha256(f"{job_id}:{retry}".encode("utf-8")).digest()
    return base + (int.from_bytes(digest[:4], "big") % span)

class ClusterManagerServicer(cml_pb2_grpc.ClusterManagerServicer):
    def __init__(self, registry: NodeRegistry, job_queue: JobQueue):
        self.registry = registry
        self.queue = job_queue
        # A dictionary mapping node_id -> Queue to hold pending commands
        import queue as thread_queue
        self.command_queues: Dict[str, thread_queue.Queue] = {}
        self.lock = threading.Lock()
        # A multi-node DDP job is complete only after every assigned agent
        # reports completion. Rank 1 can exit before rank 0 has streamed the
        # structured metric that the HTTP bridge consumes.
        self.completed_nodes: Dict[str, set] = {}
        
        os.makedirs("logs", exist_ok=True)
        self.log_file = open("logs/cluster.log", "a", encoding="utf-8")

    def RegisterNode(self, request, context):
        node_id = f"node-{uuid.uuid4().hex[:8]}"
        success = self.registry.register_node(
            node_id=node_id,
            hostname=request.hostname,
            ip_address=request.ip_address,
            cpu_count=request.cpu_count,
            gpu_model=request.gpu_model,
            ram_total=request.ram_total
        )
        
        with self.lock:
            import queue as thread_queue
            self.command_queues[node_id] = thread_queue.Queue()

        print(f"[{time.strftime('%H:%M:%S')}] Node Registered: {node_id} ({request.hostname} @ {request.ip_address})")
        return cml_pb2.RegistrationResponse(
            success=success,
            node_id=node_id,
            message="Successfully registered with Cluster Manager."
        )

    def SendHeartbeat(self, request, context):
        # Calculate Round Trip Time Latency (or 1-way since agent sends send_timestamp)
        current_time = time.time()
        latency_ms = (current_time - request.send_timestamp) * 1000 if request.send_timestamp > 0 else 0.0
        
        metrics = {
            "cpu_percent": request.cpu_percent,
            "ram_percent": request.ram_percent,
            "gpu_utilization": request.gpu_utilization,
            "gpu_memory_mb": request.gpu_memory_mb
        }
        self.registry.update_heartbeat(request.node_id, request.current_status, metrics, latency_ms)
        return cml_pb2.HeartbeatResponse(acknowledged=True)

    def ListenForCommands(self, request, context):
        node_id = request.node_id
        
        with self.lock:
            if node_id not in self.command_queues:
                import queue as thread_queue
                self.command_queues[node_id] = thread_queue.Queue()
        
        q = self.command_queues[node_id]
        import queue as thread_queue
        
        try:
            while context.is_active():
                try:
                    command = q.get(timeout=2.0)
                    yield command
                except thread_queue.Empty:
                    continue
        except grpc.RpcError:
            print(f"Node {node_id} disconnected from command stream.")
        
        return

    def ReportJobStatus(self, request, context):
        detail = f" — {request.error_message}" if request.error_message else ""
        print(f"[{time.strftime('%H:%M:%S')}] Job Status from {request.node_id}: {request.job_id} is {request.status}{detail}")
        if request.status.lower() in ("failed", "error"):
            job = self.registry.get_job(request.job_id)
            if job:
                with self.lock:
                    self.completed_nodes.pop(request.job_id, None)
                if job["status"] == JobState.CANCELED:
                    self.registry.update_node_state(request.node_id, NodeState.IDLE)
                    return cml_pb2.JobStatusResponse(acknowledged=True)
                # One DDP job can report failure from every rank. Only the
                # first failure for a RUNNING attempt may schedule a retry.
                if job["status"] != JobState.RUNNING:
                    self.registry.update_node_state(request.node_id, NodeState.IDLE)
                    return cml_pb2.JobStatusResponse(acknowledged=True)
                error = request.error_message or f"Node {request.node_id} reported a failed training process."
                self.registry.update_job_error(request.job_id, error)
                if job["retries"] < job["max_retries"]:
                    log_entry = {
                        "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                        "node": "Manager",
                        "job": request.job_id,
                        "level": "WARNING",
                        "message": f"Job Failed ({job['retries'] + 1}/{job['max_retries']} retries). {error} Re-queueing..."
                    }
                    self.log_file.write(json.dumps(log_entry) + "\n")
                    self.log_file.flush()
                    self.registry.update_node_state(request.node_id, NodeState.IDLE)
                    self.queue.retry_job(job)
                else:
                    log_entry = {
                        "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                        "node": "Manager",
                        "job": request.job_id,
                        "level": "ERROR",
                        "message": f"Job permanently FAILED after {job['max_retries']} retries. {error}"
                    }
                    self.log_file.write(json.dumps(log_entry) + "\n")
                    self.log_file.flush()
                    self.registry.update_job_status(request.job_id, JobState.FAILED, exit_code=1)
                    self.registry.update_node_state(request.node_id, NodeState.IDLE)
        elif request.status.lower() == "completed":
            job = self.registry.get_job(request.job_id)
            assigned_nodes = set(json.loads(job.get("assigned_nodes") or "[]")) if job else set()
            with self.lock:
                completed = self.completed_nodes.setdefault(request.job_id, set())
                completed.add(request.node_id)
                all_finished = bool(assigned_nodes) and assigned_nodes.issubset(completed)
            if all_finished:
                self.registry.update_job_status(request.job_id, JobState.COMPLETED, exit_code=0)
                with self.lock:
                    self.completed_nodes.pop(request.job_id, None)
            else:
                print(f"Waiting for DDP peers of {request.job_id}: {len(completed)}/{len(assigned_nodes)} completed")
            self.registry.update_node_state(request.node_id, NodeState.IDLE)
            
        return cml_pb2.JobStatusResponse(acknowledged=True)
        
    def StreamLogs(self, request_iterator, context):
        """Receives structured JSON logs streamed from agents."""
        for log_msg in request_iterator:
            structured_log = {
                "timestamp": log_msg.timestamp,
                "node": log_msg.node_id,
                "job": log_msg.job_id,
                "level": log_msg.level,
                "message": log_msg.message.strip()
            }
            # Write to centralized cluster.log
            self.log_file.write(json.dumps(structured_log) + "\n")
            self.log_file.flush()
        return cml_pb2.LogAck(acknowledged=True)
        
    def SubmitJob(self, request, context):
        print(f"[{time.strftime('%H:%M:%S')}] Received Job Submission. Adding to queue...")
        job_id = f"job-{uuid.uuid4().hex[:8]}"
        
        # Write to centralized log
        log_entry = {
            "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            "node": "Manager",
            "job": job_id,
            "level": "INFO",
            "message": f"Job submitted to queue (nodes: {request.nnodes})"
        }
        self.log_file.write(json.dumps(log_entry) + "\n")
        self.log_file.flush()
        
        job_data = {
            "job_id": job_id,
            "script_path": request.script_path,
            "required_nodes": request.nnodes,
            "args": request.args,
            "nproc_per_node": request.nproc_per_node
        }
        
        # Pushes to in-memory queue and SQLite durable storage
        self.queue.submit_job(job_data)
            
        return cml_pb2.JobSubmitResponse(
            success=True,
            job_id=job_id,
            message="Job added to queue."
        )

    def CancelJob(self, request, context):
        job = self.registry.get_job(request.job_id)
        if not job:
            return cml_pb2.JobCancelResponse(success=False, message="Job not found.")
        if job["status"] in (JobState.COMPLETED, JobState.FAILED, JobState.CANCELED):
            return cml_pb2.JobCancelResponse(success=False, message=f"Job is already {job['status'].lower()}.")

        self.queue.cancel_job(request.job_id)
        assigned_nodes = json.loads(job.get("assigned_nodes") or "[]")
        self.registry.update_job_status(request.job_id, JobState.CANCELED, assigned_nodes=assigned_nodes, exit_code=-1)
        for node_id in assigned_nodes:
            self.send_command(node_id, cml_pb2.Command(
                command_id=f"cmd-{uuid.uuid4().hex[:8]}", type=cml_pb2.Command.STOP_JOB
            ))
            self.registry.update_node_state(node_id, NodeState.IDLE)

        log_entry = {
            "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            "node": "Manager", "job": request.job_id, "level": "INFO", "message": "Job canceled by dashboard request."
        }
        self.log_file.write(json.dumps(log_entry) + "\n")
        self.log_file.flush()
        return cml_pb2.JobCancelResponse(success=True, message="Cancellation command sent to assigned nodes.")

    def send_command(self, node_id: str, command: cml_pb2.Command):
        with self.lock:
            if node_id in self.command_queues:
                self.command_queues[node_id].put(command)
                print(f"Queued command for {node_id}")
            else:
                print(f"Cannot send command: Node {node_id} not registered.")
                
    def dispatch_allocated_job(self, job: Dict[str, Any], nodes: List[Dict[str, Any]]):
        """Callback from the Scheduler to dispatch the actual commands to the selected nodes."""
        current = self.registry.get_job(job["job_id"])
        if not current or current["status"] == JobState.CANCELED:
            print(f"Skipping canceled job {job['job_id']}")
            return
        print(f"[{time.strftime('%H:%M:%S')}] Scheduler allocated {len(nodes)} nodes for job {job['job_id']}")
        # Node 0 owns the TCP rendezvous. A fixed 29500 collides when a job
        # is retried or another distributed job is active on the same node.
        master_addr = nodes[0]["ip_address"]
        master_port = rendezvous_port(job["job_id"], int(job.get("retries", 0)))
        log_entry = {
            "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            "node": "Manager",
            "job": job["job_id"],
            "level": "INFO",
            "message": f"Scheduler allocated {len(nodes)} nodes; rendezvous {master_addr}:{master_port}."
        }
        self.log_file.write(json.dumps(log_entry) + "\n")
        self.log_file.flush()
        
        assigned_node_ids = [n["node_id"] for n in nodes]
        self.registry.update_job_status(job["job_id"], JobState.RUNNING, assigned_nodes=assigned_node_ids)
        
        for rank, node in enumerate(nodes):
            cmd = cml_pb2.Command(
                command_id=f"cmd-{uuid.uuid4().hex[:8]}",
                type=cml_pb2.Command.LAUNCH_JOB,
                job_payload=cml_pb2.JobPayload(
                    job_id=job["job_id"],
                    nnodes=job["required_nodes"],
                    node_rank=rank,
                    master_addr=master_addr,
                    master_port=master_port,
                    nproc_per_node=job["nproc_per_node"],
                    script_path=job["script_path"],
                    args=job["args"]
                )
            )
            self.send_command(node["node_id"], cmd)


def serve(port=50051):
    registry = NodeRegistry()
    queue_mgr = JobQueue(registry)
    
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    servicer = ClusterManagerServicer(registry, queue_mgr)
    cml_pb2_grpc.add_ClusterManagerServicer_to_server(servicer, server)
    server.add_insecure_port(f'[::]:{port}')
    server.start()
    print(f"Cluster Manager started on port {port}")
    
    # Start the Smart Scheduler
    allocator = NodeAllocator()
    scheduler = Scheduler(registry, queue_mgr, allocator, on_job_allocated=servicer.dispatch_allocated_job)
    scheduler.start()
    
    # Background thread to monitor offline nodes
    def monitor_nodes():
        while True:
            # First, check which nodes are about to be marked disconnected
            cutoff_time = time.time() - 15.0
            with sqlite3.connect("cluster.db") as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT node_id FROM nodes WHERE last_heartbeat < ? AND status NOT IN (?, ?)",
                    (cutoff_time, NodeState.DISCONNECTED, NodeState.MAINTENANCE)
                )
                offline_nodes = [row["node_id"] for row in cursor.fetchall()]

            if offline_nodes:
                print(f"Nodes disconnected: {offline_nodes}")
                # For each disconnected node, fail any jobs running on it
                running_jobs = registry.get_jobs(status=JobState.RUNNING)
                for job in running_jobs:
                    assigned = json.loads(job.get("assigned_nodes", "[]"))
                    if any(node in assigned for node in offline_nodes):
                        print(f"Proactively failing job {job['job_id']} because a node crashed.")
                        
                        if job["retries"] < job["max_retries"]:
                            log_entry = {
                                "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                                "node": "Manager",
                                "job": job["job_id"],
                                "level": "WARNING",
                                "message": f"Node crashed. Job Failed ({job['retries'] + 1}/{job['max_retries']}). Re-queueing..."
                            }
                            servicer.log_file.write(json.dumps(log_entry) + "\n")
                            servicer.log_file.flush()
                            queue_mgr.retry_job(job)
                        else:
                            registry.update_job_status(job["job_id"], JobState.FAILED, exit_code=1)

            # Mark them offline in DB
            registry.mark_offline_nodes()
            time.sleep(10)
            
    threading.Thread(target=monitor_nodes, daemon=True).start()
    
    try:
        server.wait_for_termination()
    except KeyboardInterrupt:
        print("Shutting down Cluster Manager...")
        scheduler.stop()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='DMLF Cluster Manager')
    parser.add_argument('--port', type=int, default=50051, help='gRPC port to listen on')
    serve(parser.parse_args().port)
