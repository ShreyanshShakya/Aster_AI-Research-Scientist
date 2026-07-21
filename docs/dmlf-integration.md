# DMLF execution integration

The project includes the supplied `Distributed-ML-Training-main` project as its real distributed execution engine. The research app does not imitate DMLF scheduling: it posts a bounded experiment to `dmlf.bridge`, which calls DMLF's existing gRPC `SubmitJob` API. DMLF's Cluster Manager then selects nodes, reserves them, launches `torchrun`, handles retries, and records durable status in `cluster.db`.

```text
Research dashboard -> DMLF bridge (HTTP) -> DMLF Cluster Manager (gRPC)
                                          -> DMLF node agents -> torchrun / PyTorch DDP
Research dashboard <- DMLF bridge polls <- cluster.db + structured DMLF log result
```

## CPU-only local demo

The supplied DMLF runner now has a CPU-safe MNIST DDP profile (`gloo`). A single CPU node is still a real DMLF submission and real PyTorch training; it is not a distributed multi-node benchmark. On Windows CPU PyTorch builds without libuv, DMLF uses its one-rank Gloo/DDP fallback instead of elastic `torchrun`, because that launcher requests unavailable libuv before training begins.

From `Distributed-ML-Training-main/Distributed-ML-Training-main`, create an environment and install its dependencies, then open three terminals in that same directory:

```powershell
# Terminal 1: manager
python -m dmlf.manager.cluster_manager

# Terminal 2: one DMLF CPU node agent
python -m dmlf.agent.agent --manager 127.0.0.1:50051

# Terminal 3: HTTP bridge used by the research app
$env:DMLF_MANAGER_ADDR='127.0.0.1:50051'
$env:DMLF_CLUSTER_DB='cluster.db'
$env:DMLF_CLUSTER_LOG='logs/cluster.log'
$env:DMLF_TRAINING_SCRIPT='train.py'
python -m dmlf.bridge
```

Configure the research app in its `.env`, then restart `npm.cmd start`:

```text
WORKER_CONFIG_JSON=[{"type":"dmlf","id":"dmlf-cpu-cluster","endpoint":"http://127.0.0.1:8002/execute","capabilities":["cpu"],"slots":1,"timeoutMs":1800000}]
```

In the dashboard, use the question:

```text
Does augmentation improve a DMLF distributed MNIST classifier?
```

Start with `maxExperiments: 1` and `maxEpochs: 1`. The result is a real `validation_accuracy` emitted by rank zero as `DMLF_RESULT_JSON`; it is shown as `simulated: false` in the research report and manifest.

The standard profile uses MNIST and downloads it on rank zero. If a firewall or air-gapped demo environment blocks that download, the bridge also accepts an explicit `dataset: "synthetic"` experiment for an offline DDP smoke test. Its metrics are real model measurements but must be labelled synthetic—not MNIST benchmark evidence.

For the dashboard, ask: `Does an offline DMLF synthetic classifier execute correctly?` The dedicated profile carries that synthetic-data provenance through the plan, manifest, and report.

## Configuration dashboard

After starting the research app, open `http://localhost:3000/dmlf`. Enable DMLF there only when its bridge is running. Set the bridge URL, manager address, and nodes required for each DMLF experiment. Add planned nodes with a host/IP, CPU or GPU label, and process count to document the intended cluster.

The live DMLF registry shown on this page comes from node-agent registration and is authoritative. A GPU label in the planned layout does not manufacture GPU access: the DMLF agent detects its real hardware and reports it to the manager. For a multi-machine run, copy the project and environment to each machine, start an agent against the shared manager, ensure the training script/data are available on every machine, then set the requested node count to the number of registered agents.

### Second-device validation

On the manager machine, obtain its LAN IPv4 address and start the manager. On the second device, activate its DMLF environment and run:

```powershell
python -m dmlf.preflight --manager <MANAGER-LAN-IP>:50051
```

It must return `"reachable": true` and report the device hardware. Then run the `nextCommand` shown by preflight. Refresh `/dmlf` on the manager to confirm both distinct node IDs are `IDLE` before setting **Nodes required per DMLF experiment** to `2`.

## Multi-machine DDP

For a genuine multi-node run, run a DMLF node agent on each machine, ensure every agent can reach the manager, and ensure the configured training script and dataset path are available on every participating machine. Change the `distributed.nodes` value for the DMLF experiments only after that cluster is healthy. DMLF's allocator currently prefers GPU-equipped nodes but will schedule CPU nodes when they are the available registered nodes.

The bridge intentionally has no authority to fabricate node count, metrics, or completion. A DMLF manager must accept the job and its database/logs are the source of job state.
