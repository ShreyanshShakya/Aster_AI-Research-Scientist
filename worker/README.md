# CIFAR-10 worker

This is a real, bounded PyTorch worker for the `cifar10-small-v1` experiment profile. It implements an asynchronous job protocol: `POST /execute` returns a `jobId`, then the orchestrator polls `GET /jobs/{jobId}` every two seconds until the job is completed or failed.

## Run

```powershell
cd worker
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8001
```

It downloads CIFAR-10 on first execution and limits training to 5,000 samples, 1,000 validation samples, and at most five epochs. Configure a GPU worker with a CUDA-compatible PyTorch install; CPU-only workers must receive CPU-required experiments.

Job states are `queued`, `running`, `completed`, and `failed`. Each job runs on an isolated background thread; while training, progress advances from 5% through batch/epoch checkpoints to 85% validation and 100% completion. The Node orchestrator polls every two seconds and records only changed progress values.

## Connect it to the orchestrator

Set this before starting the Node app:

```powershell
$env:WORKER_CONFIG_JSON = '[{"type":"remote","id":"cifar-gpu-01","endpoint":"http://127.0.0.1:8001/execute","capabilities":["cpu","gpu"],"slots":1,"timeoutMs":1800000}]'
```

For a CPU-only worker, set the app budget to one experiment so it schedules only the CPU baseline. Do not expose an unauthenticated worker outside a trusted local network; add an authentication layer before deployment.

`timeoutMs` is the orchestration-side HTTP timeout. The default is 30 minutes (maximum 60 minutes); it must exceed expected dataset-download and training time. Cancellation currently does not interrupt an already-running FastAPI/PyTorch job, so wait for or explicitly stop the worker before retrying a timed-out run.
