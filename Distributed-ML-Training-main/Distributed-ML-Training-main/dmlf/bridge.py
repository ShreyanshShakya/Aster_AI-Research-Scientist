"""HTTP adapter for submitting and observing DMLF jobs.

This deliberately does not schedule work itself. It submits to DMLF's existing
gRPC Cluster Manager, which owns node selection, reservations, retries, and
the torchrun/DDP launch. The adapter simply presents the asynchronous contract
used by Distributed AI Research Scientist:

POST /execute -> 202 {jobId, statusUrl}
GET  /jobs/<jobId> -> queued | running | completed | failed | canceled
GET  /jobs -> recent DMLF job history
POST /jobs/<jobId>/cancel -> requests cancellation through the cluster manager
"""

import json
import os
import sqlite3
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import grpc

from dmlf.communication import cml_pb2, cml_pb2_grpc


MANAGER = os.environ.get("DMLF_MANAGER_ADDR", "127.0.0.1:50051")
DB_PATH = Path(os.environ.get("DMLF_CLUSTER_DB", "cluster.db"))
LOG_PATH = Path(os.environ.get("DMLF_CLUSTER_LOG", "logs/cluster.log"))
TRAINING_SCRIPT = os.environ.get("DMLF_TRAINING_SCRIPT", "train.py")


def result_for(job_id):
    """Extract the rank-zero result emitted by DMLF's training script."""
    if not LOG_PATH.exists():
        return None
    try:
        for line in reversed(LOG_PATH.read_text(encoding="utf-8").splitlines()):
            entry = json.loads(line)
            if entry.get("job") != job_id:
                continue
            message = entry.get("message", "")
            if message.startswith("DMLF_RESULT_JSON "):
                return json.loads(message.removeprefix("DMLF_RESULT_JSON "))
    except (OSError, json.JSONDecodeError):
        return None
    return None


def job_status(job_id):
    if not DB_PATH.exists():
        return {"status": "failed", "progress": 0, "error": f"DMLF database not found at {DB_PATH}"}
    with sqlite3.connect(DB_PATH) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            "SELECT status, assigned_nodes, exit_code, last_error FROM jobs WHERE job_id = ?", (job_id,)
        ).fetchone()
    if not row:
        return {"status": "failed", "progress": 0, "error": f"DMLF job {job_id} was not found"}
    status = row["status"].lower()
    payload = {"status": {"pending": "queued"}.get(status, status), "progress": {"pending": 0, "running": 50, "completed": 100, "failed": 100, "canceled": 100}.get(status, 0)}
    if row["assigned_nodes"]:
        payload["assignedNodes"] = json.loads(row["assigned_nodes"])
    if status == "completed":
        result = result_for(job_id)
        if not result:
            return {"status": "failed", "progress": 100, "error": "DMLF completed without a structured result metric."}
        payload["metrics"] = result
    elif status == "failed":
        payload["error"] = row["last_error"] or f"DMLF job failed with exit code {row['exit_code']}"
    elif status == "canceled":
        payload["error"] = "DMLF job was canceled by the user"
    elif row["last_error"]:
        payload["warning"] = row["last_error"]
    return payload


def job_history(limit=50):
    """Return durable manager-owned job history for the DMLF dashboard."""
    if not DB_PATH.exists():
        return {"jobs": [], "error": f"DMLF database not found at {DB_PATH}"}
    with sqlite3.connect(DB_PATH) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            "SELECT job_id, status, required_nodes, assigned_nodes, created_at, started_at, "
            "completed_at, exit_code, args, last_error FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    jobs = []
    for row in rows:
        job = dict(row)
        job["status"] = {"pending": "queued"}.get(job["status"].lower(), job["status"].lower())
        job["assignedNodes"] = json.loads(job.pop("assigned_nodes") or "[]")
        job["jobId"] = job.pop("job_id")
        job["requiredNodes"] = job.pop("required_nodes")
        jobs.append(job)
    return {"jobs": jobs}


def cluster_health():
    if not DB_PATH.exists():
        return {"status": "degraded", "manager": MANAGER, "database": str(DB_PATH), "nodes": [], "error": "DMLF database not found"}
    with sqlite3.connect(DB_PATH) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute("SELECT node_id, hostname, ip_address, cpu_count, gpu_model, ram_total, status, last_heartbeat FROM nodes ORDER BY node_id").fetchall()
    return {"status": "ok", "manager": MANAGER, "database": str(DB_PATH), "nodes": [dict(row) for row in rows]}


def submit(experiment):
    distributed = experiment.get("distributed") or {}
    nodes = int(distributed.get("nodes", 1))
    processes = int(distributed.get("processesPerNode", 1))
    if nodes < 1 or processes < 1:
        raise ValueError("distributed.nodes and processesPerNode must be positive integers")
    epochs = max(1, min(int(experiment.get("epochs", 1)), 30))
    learning_rate = float(experiment.get("learningRate", 0.01))
    seed = int(experiment.get("seed", 42))
    augmentation = experiment.get("augmentation", "none")
    dataset = experiment.get("dataset", "mnist")
    if augmentation not in {"none", "standard"}:
        raise ValueError("Only 'none' and 'standard' augmentation are supported by the DMLF MNIST runner")
    if dataset not in {"mnist", "synthetic"}:
        raise ValueError("Only 'mnist' and explicit offline 'synthetic' datasets are supported by the DMLF runner")
    args = f"--epochs={epochs} --lr={learning_rate} --batch-size=64 --backend=gloo --augmentation={augmentation} --dataset={dataset} --seed={seed} --rendezvous-timeout-seconds=90"
    with grpc.insecure_channel(MANAGER) as channel:
        response = cml_pb2_grpc.ClusterManagerStub(channel).SubmitJob(
            cml_pb2.JobSubmitRequest(script_path=TRAINING_SCRIPT, nnodes=nodes, nproc_per_node=processes, args=args), timeout=10
        )
    if not response.success:
        raise RuntimeError(response.message or "DMLF rejected the job")
    return response.job_id


def cancel(job_id):
    with grpc.insecure_channel(MANAGER) as channel:
        response = cml_pb2_grpc.ClusterManagerStub(channel).CancelJob(
            cml_pb2.JobCancelRequest(job_id=job_id), timeout=10
        )
    if not response.success:
        raise RuntimeError(response.message or "DMLF could not cancel the job")
    return response.message or "Cancellation requested"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def send_json(self, status, body):
        encoded = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_POST(self):
        path = urlparse(self.path).path
        if path.startswith("/jobs/") and path.endswith("/cancel"):
            job_id = path.removeprefix("/jobs/").removesuffix("/cancel").strip("/")
            if not job_id:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "A job id is required"})
                return
            try:
                self.send_json(HTTPStatus.OK, {"jobId": job_id, "message": cancel(job_id)})
            except (ValueError, grpc.RpcError, RuntimeError) as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        if path != "/execute":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length))
            experiment = payload.get("experiment")
            if not isinstance(experiment, dict):
                raise ValueError("Request must include an experiment object")
            job_id = submit(experiment)
            self.send_json(HTTPStatus.ACCEPTED, {"jobId": job_id, "statusUrl": f"/jobs/{job_id}"})
        except (ValueError, grpc.RpcError, RuntimeError) as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            self.send_json(HTTPStatus.OK, cluster_health())
            return
        if path == "/jobs":
            self.send_json(HTTPStatus.OK, job_history())
            return
        if not path.startswith("/jobs/"):
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return
        self.send_json(HTTPStatus.OK, job_status(path.removeprefix("/jobs/")))


def main():
    port = int(os.environ.get("DMLF_BRIDGE_PORT", "8002"))
    host = os.environ.get("DMLF_BRIDGE_HOST", "127.0.0.1")
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"DMLF bridge listening on http://{host}:{port} (manager: {MANAGER})")
    server.serve_forever()


if __name__ == "__main__":
    main()
