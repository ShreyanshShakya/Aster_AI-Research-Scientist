import subprocess
import os
import sys
import threading
import time
from pathlib import Path
from dmlf.communication import cml_pb2

class JobLauncher:
    def __init__(self):
        self.current_process = None
        self.log_thread = None

    def launch_torchrun(self, job_id, nnodes, node_rank, master_addr, master_port, nproc_per_node, script_path, extra_args, node_id, stub, on_finished=None):
        if self.current_process and self.current_process.poll() is None:
            print("A job is already running on this node.")
            return False

        # Commands contain the repository-relative training script. Resolve it
        # from this installed project rather than the agent's current working
        # directory, which may otherwise run an unrelated train.py that exits
        # successfully without joining DDP.
        script = Path(script_path)
        if not script.is_absolute():
            script = Path(__file__).resolve().parents[2] / script
        script = script.resolve()
        if not script.is_file():
            error = f"DMLF training script not found: {script}"
            print(error)
            stub.ReportJobStatus(cml_pb2.JobStatusRequest(
                node_id=node_id, job_id=job_id, status="failed", error_message=error
            ))
            if on_finished:
                on_finished()
            return False

        # Run torchrun through this interpreter instead of resolving a global
        # `torchrun` executable. This is essential on Windows where a node
        # agent launched from a virtual environment may not inherit its
        # Scripts directory on PATH.
        direct_rank_launch = nproc_per_node == 1
        if direct_rank_launch:
            # torch.distributed.run's static rendezvous in some Windows CPU
            # builds hard-codes libuv before the child gets a chance to read
            # USE_LIBUV=0. Launching one rank directly per node still
            # initializes real Gloo/DDP, including multi-node CPU jobs.
            cmd = [sys.executable, str(script)]
        else:
            cmd = [
                sys.executable,
                "-m",
                "torch.distributed.run",
                f"--nnodes={nnodes}",
                f"--node_rank={node_rank}",
                f"--master_addr={master_addr}",
                f"--master_port={master_port}",
                f"--nproc_per_node={nproc_per_node}",
                str(script)
            ]
        if extra_args:
            cmd.extend(extra_args.split())

        print(f"Executing rank {node_rank}/{nnodes} at {master_addr}:{master_port}: {' '.join(cmd)}")
        
        env = os.environ.copy()
        # Windows CPU wheels may not ship libuv. PyTorch's TCP rendezvous
        # otherwise requests it by default and aborts before DDP starts.
        env["USE_LIBUV"] = "0"
        # Optional override for systems with VPN/WSL/virtual interfaces. The
        # interface name is system-specific (for example, Wi-Fi or Ethernet).
        if os.environ.get("DMLF_GLOO_INTERFACE"):
            env["GLOO_SOCKET_IFNAME"] = os.environ["DMLF_GLOO_INTERFACE"]
        if direct_rank_launch:
            env.update({
                "RANK": str(node_rank),
                "LOCAL_RANK": "0",
                "WORLD_SIZE": str(nnodes),
                "MASTER_ADDR": master_addr,
                "MASTER_PORT": str(master_port),
            })
        try:
            self.current_process = subprocess.Popen(
                cmd,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1
            )
        except OSError as error:
            print(f"Could not launch DMLF job {job_id}: {error}")
            try:
                stub.ReportJobStatus(cml_pb2.JobStatusRequest(
                    node_id=node_id, job_id=job_id, status="failed", error_message=str(error)
                ))
            finally:
                if on_finished:
                    on_finished()
            return False
        
        def log_generator():
            last_output = ""
            for line in iter(self.current_process.stdout.readline, ''):
                if line:
                    last_output = line.strip()
                    yield cml_pb2.LogMessage(
                        timestamp=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                        node_id=node_id,
                        job_id=job_id,
                        level="INFO",
                        message=line.strip()
                    )
            
            # Send status update when process finishes
            exit_code = self.current_process.wait()
            status = "completed" if exit_code == 0 else "failed"
            try:
                error_message = "" if exit_code == 0 else f"Training process exited with code {exit_code}."
                if exit_code != 0 and last_output:
                    error_message += f" Last output: {last_output}"
                stub.ReportJobStatus(cml_pb2.JobStatusRequest(
                    node_id=node_id,
                    job_id=job_id,
                    status=status,
                    error_message=error_message
                ))
            except Exception as e:
                print(f"Failed to report job status: {e}")
            finally:
                if on_finished:
                    on_finished()

        def stream_logs():
            try:
                stub.StreamLogs(log_generator())
            except Exception as e:
                print(f"Log streaming disconnected: {e}")
                
        self.log_thread = threading.Thread(target=stream_logs, daemon=True)
        self.log_thread.start()
        
        return True

    def stop_current_job(self):
        if self.current_process and self.current_process.poll() is None:
            self.current_process.terminate()
            if self.log_thread:
                self.log_thread.join(timeout=2.0)
            self.current_process = None
            return True
        return False
