# One-command local DMLF demo

Docker Compose starts the dashboard, DMLF Cluster Manager, asynchronous bridge, and two CPU DMLF agents on one Docker network. It is a reproducible local distributed-systems demo; it does not replace a real multi-machine cluster.

## Prerequisite

Install Docker Desktop and ensure it is running. On Windows, use Linux containers.

Stop any native dashboard, bridge, or manager process first if it is already using ports `3000`, `50051`, or `8002`.

## Start

From the repository root:

```powershell
docker compose up --build
```

Open `http://localhost:3000/`. The dashboard is preconfigured to use the Compose bridge and request two CPU nodes. Open `http://localhost:3000/dmlf` and wait until two agents appear in the live registry.

Use the **DMLF synthetic - execution smoke test** preset, one experiment, one epoch, and one repetition. This submits a real PyTorch Gloo/DDP job across two containers.

## Real MNIST benchmark

For the **DMLF MNIST - real benchmark** preset, both worker containers use the shared host cache at `datasets/mnist/`. Before launching the benchmark, download MNIST once on the host from the repository root:

```powershell
.\.venv\Scripts\python.exe -c "from torchvision import datasets; datasets.MNIST('datasets/mnist', train=True, download=True); datasets.MNIST('datasets/mnist', train=False, download=True)"
```

Then recreate the agents so they receive the shared cache:

```powershell
docker compose up -d --build --force-recreate dmlf-agent-1 dmlf-agent-2
```

Docker shared-cache mode lets rank zero verify/download MNIST once; rank one waits at the DDP barrier and then reads the same verified files. `datasets/` is a local cache and is not committed to Git.

## Stop and reset

```powershell
docker compose down
```

To remove local job history and dashboard run data as well:

```powershell
docker compose down -v
```

## Important boundaries

- The Compose stack is CPU-only. It is designed for a reliable, self-contained demo.
- The synthetic profile produces a real execution metric but is not benchmark evidence.
- For a real second physical machine, keep the existing native DMLF node-agent setup and connect it to the manager's LAN IP. Docker service names such as `dmlf-manager` only resolve inside the Compose network.
- The first build downloads PyTorch CPU wheels and can take several minutes.
