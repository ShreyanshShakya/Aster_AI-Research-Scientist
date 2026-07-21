# Submission checklist

## Five-minute final verification

```powershell
npm.cmd test
npm.cmd start
```

Open `http://localhost:3000/`. Confirm the dashboard shows the question form, benchmark preset, seed repetitions, paper-review controls, worker registry, and recent runs. Open `http://localhost:3000/dmlf` to confirm the DMLF configuration page loads.

## Recommended live demo: real two-node DMLF smoke test

Use this only if the two-node cluster was already verified. Do not troubleshoot networking during the recording.

1. On the manager machine, start the saved DMLF manager, bridge, and local node scripts from the DMLF project directory:

   ```powershell
   .\start-dmlf-manager.ps1
   .\start-dmlf-bridge.ps1
   .\start-dmlf-node.ps1
   ```

2. On the second machine, start its saved node script:

   ```powershell
   .\start-dmlf-node.ps1
   ```

3. Refresh `/dmlf` and confirm two live nodes are idle. Enable DMLF, request two nodes, and save the configuration.
4. On the research dashboard select **DMLF synthetic - execution smoke test**. Use the question `Does an offline DMLF synthetic classifier execute correctly?`, one experiment, one epoch, and one repetition.
5. Start the run. Show the assignment, polling progress, completed status, real metric, report, and reproducibility manifest.

Say explicitly: "The execution and metric are real. The data is synthetic, so this is a distributed-systems validation, not a scientific performance claim."

## Fallback demo: offline, no credentials

If the cluster is unavailable, run the dashboard in its default mode. It demonstrates the same research workflow: paper approval, hypothesis, critic gate, bounded plan, scheduler, report, and manifest, with deterministic simulated workers. Keep the simulation warning visible.

## Submission materials

- [ ] Public repository with this README and setup instructions
- [ ] Short video using [demo-script.md](demo-script.md)
- [ ] Clear one-line pitch: "An auditable, human-approved AI research loop that plans ML experiments, runs them on distributed compute, and turns results into reproducible reports."
- [ ] Mention the no-key offline fallback and the real DMLF integration
- [ ] Do not claim synthetic results are benchmark results
- [ ] Include one real completed report or screenshot in the repository/submission, if permitted
