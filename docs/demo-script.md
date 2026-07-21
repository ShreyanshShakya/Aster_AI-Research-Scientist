# Hackathon demo script (2-3 minutes)

## Setup before recording

1. Run `npm.cmd test`, then `npm.cmd start`.
2. Open `http://localhost:3000/` and `http://localhost:3000/dmlf`.
3. Preferred: use the already-verified two-node DMLF synthetic smoke-test profile. Fallback: use the safe offline dashboard path.
4. Never imply simulated metrics or synthetic smoke-test metrics are scientific benchmark results.

## Recording flow

### 0:00-0:20 - problem and product

> ML research is slow because literature review, controlled experiment design, compute scheduling, evidence tracking, and reporting are disconnected. Distributed AI Research Scientist closes that loop with a transparent, human-approved workflow.

> The workflow is auditable end to end. I’ll show the same interface with real distributed execution; the report preserves exactly what is real, simulated, or synthetic.

### 0:20-0:55 - plan before compute

Select **DMLF synthetic - execution smoke test**, enter `Does an offline DMLF synthetic classifier execute correctly?`, set one experiment, one epoch, and one seed repetition, then click **Preview plan**.

> The system selects the execution-validation benchmark, forms a falsifiable hypothesis, runs a critic gate, and creates a bounded plan. No worker is started at this point; the researcher reviews the plan first.

Point to the literature brief, hypothesis, critic, and experiment list.

### 0:55-1:35 - distributed execution

Show two idle nodes on the DMLF configuration dashboard, then start the research loop.

> After approval, the scheduler requests two DMLF nodes. The dashboard posts a bounded experiment, receives a job ID, polls progress asynchronously, and captures every assignment in the research timeline.

Point to the completed result and report.

> The analyst records a real metric emitted by rank zero and recommends repeated seeds before accepting a finding. It does not overclaim: this run used synthetic data, and the report states that it is not benchmark evidence.

### 1:35-2:05 - auditability

Click **Download reproducibility manifest**.

> Every run produces an exportable manifest with the question, preset, prompt versions, approved-paper metadata, exact experiment configuration, worker assignments, metrics, analysis, and limitations. This makes the system inspectable rather than a black box.

### 2:05-2:35 - technical differentiation

> The system uses a narrow remote-worker contract, not agent-generated shell commands. The DMLF bridge receives an allowlisted experiment specification, returns a job ID immediately, and exposes progress and a validated metric. That is the bridge from agent planning to real PyTorch DDP across heterogeneous machines.

> The next validation is repeated-seed MNIST or domain-specific training. The architecture already supports that without changing the research workflow.

## Suggested one-line pitch

> Distributed AI Research Scientist is an auditable, human-approved research loop that plans ML experiments, runs them on distributed compute, and turns results into reproducible reports.

## Fallback wording

If the DMLF cluster is unavailable, use the default local dashboard and say: “This offline path validates the review, planning, scheduling, report, and manifest contracts. Its metrics are deliberately labelled simulated; the DMLF integration is the real execution path.”

## Recording checklist

- Two live DMLF nodes are visible before the run, or the simulation warning is visible for the fallback path.
- Show the plan-review gate before execution.
- Show progress polling, the final report, and the manifest.
- Do not claim synthetic metrics came from a real dataset.
- End with the repeated-seed or real-benchmark next step.
