# Two-machine DMLF demo (Windows)

Use this runbook for the real cross-machine DDP demo. It runs one DMLF agent on each physical machine and uses the existing manager and bridge on **Machine A**. Do not run the full `docker compose up` stack on Machine B: that would create a second isolated manager instead of joining the first cluster.

## Before starting

- Put both machines on the same LAN. Disconnect VPNs while testing.
- Use the physical Wi-Fi or Ethernet adapter, not a virtual/WSL adapter.
- Clone the same repository on both machines after the GitHub push completes.
- Record the LAN IPv4 address of each machine from `ipconfig`. Substitute `<MANAGER-LAN-IP>`, `<MACHINE-A-LAN-IP>`, and `<MACHINE-B-LAN-IP>` below with your own private LAN addresses.

On **both** machines, open PowerShell in:

```powershell
cd .\AI-Research-Scientist\Distributed-ML-Training-main\Distributed-ML-Training-main
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Find the physical adapter name if needed:

```powershell
Get-NetAdapter | Where-Object Status -eq Up | Select-Object Name, InterfaceDescription
```

## Machine A: manager, bridge, dashboard, and first agent

Allow gRPC manager traffic and DDP rendezvous traffic. Run PowerShell as Administrator:

```powershell
New-NetFirewallRule -DisplayName 'DMLF Manager gRPC' -Direction Inbound -Protocol TCP -LocalPort 50051 -Action Allow
New-NetFirewallRule -DisplayName 'DMLF DDP Rendezvous' -Direction Inbound -Protocol TCP -LocalPort 20000-39999 -Action Allow
```

Save Machine A's DMLF node configuration. Replace the IP and adapter name:

```powershell
.\setup-dmlf-node.ps1 -ManagerAddress '<MANAGER-LAN-IP>:50051' -AdvertiseIp '<MACHINE-A-LAN-IP>' -GlooInterface 'Wi-Fi'
```

Open four terminals.

```powershell
# Terminal A1 - from the DMLF directory
.\start-dmlf-manager.ps1

# Terminal A2 - from the DMLF directory
.\start-dmlf-bridge.ps1

# Terminal A3 - from the DMLF directory
.\start-dmlf-node.ps1

# Terminal A4 - from the repository root
npm.cmd start
```

## Machine B: second DMLF agent

Allow the DDP rendezvous port range. Run PowerShell as Administrator:

```powershell
New-NetFirewallRule -DisplayName 'DMLF DDP Rendezvous' -Direction Inbound -Protocol TCP -LocalPort 20000-39999 -Action Allow
```

From Machine B's DMLF directory, confirm that it can reach Machine A's manager:

```powershell
.\.venv\Scripts\python.exe -m dmlf.preflight --manager <MANAGER-LAN-IP>:50051
```

It must report `"reachable": true`. Then save its own configuration and start the agent:

```powershell
.\setup-dmlf-node.ps1 -ManagerAddress '<MANAGER-LAN-IP>:50051' -AdvertiseIp '<MACHINE-B-LAN-IP>' -GlooInterface 'Wi-Fi'
.\start-dmlf-node.ps1
```

## Run the dashboard demo

1. On Machine A, open `http://localhost:3000/dmlf`.
2. Click **Refresh** until two live nodes are shown as `IDLE`.
3. Enable DMLF and save these settings:
   - Bridge endpoint: `http://127.0.0.1:8002`
   - Manager address: `<MANAGER-LAN-IP>:50051`
   - Nodes required: `2`
4. Open `http://localhost:3000/`.
5. Select **DMLF synthetic - execution smoke test** and use:
   - Question: `Does an offline DMLF synthetic classifier execute correctly across two distributed workers?`
   - Experiments: `1`
   - Epochs: `1`
   - Seed repetitions: `1`
6. Preview the plan, then start the loop. Show the job assignment, polling progress, final real `validation_accuracy`, report, and manifest.

## If it times out

- Verify both agents advertised their physical LAN addresses in their terminal output.
- Check that the adapter name saved in each `dmlf-node.json` is the real Wi-Fi/Ethernet adapter.
- Confirm that both machines allow inbound TCP `20000-39999` and that security software is not blocking Python.
- Stop stale jobs before retrying. Each retry uses a new rendezvous port, so do not manually reserve port `29500`.
