# Screenshot capture guide

Capture three images only. They tell the full story without requiring a GIF.

## 1. Research plan and human approval

Open `http://localhost:3000/`, enter a focused question, select the benchmark preset, and click **Preview plan**. Capture the question, literature brief, hypothesis, plan critic verdict, and bounded experiments in one frame.

Suggested filename: `docs/assets/01-plan-review.png`

## 2. Distributed execution lifecycle

Open `http://localhost:3000/dmlf` with the verified cluster running. Capture the live node registry showing two connected nodes and a running or completed job entry. If possible, take this while the job is between 10% and 85% so the progress state is visible.

Suggested filename: `docs/assets/02-dmlf-progress.png`

## 3. Auditable result

Return to the research dashboard after completion. Capture the final report section containing the experiment comparison, evidence label, recommendation, limitation, and timeline.

Suggested filename: `docs/assets/03-report.png`

## Caption text

- **Plan review:** "The agent proposes a falsifiable, bounded study for human approval before compute is allocated."
- **DMLF execution:** "The scheduler submits a bounded job to DMLF, receives a job ID, and polls live distributed-worker progress."
- **Result:** "The final report preserves metrics, worker assignments, provenance, and limitations so the result remains inspectable."

For the synthetic DDP smoke test, state: "Execution and metrics are real; the synthetic dataset makes this a distributed-systems validation, not benchmark evidence."
