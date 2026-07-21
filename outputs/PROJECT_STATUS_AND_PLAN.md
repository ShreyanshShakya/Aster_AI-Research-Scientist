# Distributed AI Research Scientist — Status and Plan

**Project purpose:** a hackathon-sized, auditable system that turns an ML research question into a literature brief, falsifiable hypothesis, bounded experiment plan, distributed execution, result analysis, and Markdown report.

## Current status

The application is a runnable Node.js MVP with no external dependencies and no API key required. It runs in a clearly labeled offline-demo mode using deterministic agents and simulated workers. The orchestration, worker, audit, and API contracts are designed so real model calls and remote training services can replace the simulators without changing the overall workflow.

Run locally from the project root:

```powershell
npm.cmd test
npm.cmd start
```

Then open `http://localhost:3000/`.

## What has been implemented

### Research workflow

1. **Research question intake** — the dashboard accepts a user-editable research question and resource budget.
2. **Question-aware planning** — offline profiles select research-relevant metrics and experiments:
   - Brain tumor / MRI / segmentation questions: Dice score, U-Net baseline, Dice-focal loss, and Attention U-Net.
   - NLP / transformer questions: validation accuracy, frozen encoder baseline, adapter tuning, and LoRA tuning.
   - General vision questions: validation accuracy, baseline, augmentation, and learning-rate tuning.
3. **Literature brief** — produces a cautious, explicitly simulated brief aligned to the selected profile.
4. **Hypothesis generation** — creates a falsifiable hypothesis with a measurable threshold and domain metric.
5. **Plan review gate** — `Preview plan` generates the literature brief, hypothesis, and bounded experiments without running or persisting a job.
6. **Execution** — approved runs are scheduled to compatible workers, metrics are collected, results ranked, and a report generated.
7. **Result analysis** — recommends the strongest candidate while prominently documenting the lack of real experimental evidence.

### Distributed execution

- Capability-aware scheduler routes CPU-compatible work to a CPU worker and GPU-required work to a GPU worker.
- Simulated heterogeneous worker pool:
  - `cpu-lab-01`: CPU capability.
  - `gpu-lab-01`: CPU and GPU capability.
- A `RemoteWorker` adapter provides a narrow authenticated HTTP interface for a future Python/PyTorch or containerized worker.
- Remote workers receive structured experiment data only; the agent does not send shell commands or arbitrary source code.
- The dashboard displays current worker metadata via the worker registry.

### Dashboard and auditability

- Browser dashboard at `/`.
- Create and preview research runs.
- View persistent recent runs.
- Open a past run to inspect its report, worker assignments, and event timeline.
- Download a reproducibility manifest for each completed run.
- The manifest includes the question, budget, literature mode, hypothesis, planned configurations, worker assignments, metrics, analysis, and limitations.
- Every current output explicitly marks itself as simulated.

### OpenAI integration readiness

- `AgentGateway` supports the OpenAI Responses API when `OPENAI_API_KEY` is set.
- Default target is controlled through `OPENAI_MODEL` (currently `gpt-5.6`, matching the requested hackathon target).
- Without a key, the system remains runnable through deterministic fallbacks.
- API keys remain server-side and are never exposed in the browser.
- `.env.example` documents optional server configuration without committing credentials or worker tokens.

### API endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/` | Interactive dashboard |
| `GET` | `/health` | Health check and active mode (`offline-demo` or `openai`) |
| `GET` | `/workers` | Worker capability registry |
| `GET` | `/runs` | Saved run summaries, newest first |
| `POST` | `/runs/preview` | Generate an inspectable plan without execution or persistence |
| `POST` | `/runs` | Execute and persist a complete research run |
| `GET` | `/runs/:id` | Full saved run |
| `GET` | `/runs/:id/report` | Markdown report |
| `GET` | `/runs/:id/manifest` | Reproducibility JSON manifest |

### Verification

The test suite currently has **8 passing tests**. It covers:

- End-to-end auditable research loop.
- Preview behavior without worker execution or persistence.
- Domain-aware segmentation planning.
- Domain-specific metric reporting.
- Run-store ordering.
- Worker metadata exposure.
- Authenticated remote-worker response validation.
- Reproducibility-manifest contents.

## Current limitations

- Literature content is deterministic in offline mode; it is not a live paper search.
- All default metrics are simulated, not trained/evaluated model results.
- The dashboard currently uses simulated workers; `RemoteWorker` is an integration adapter, not a deployed worker service.
- There is no dataset registry, artifact store, experiment cancellation, login/authentication layer, or production database.
- The OpenAI model path has not been activated because no API key is configured.

## Planned work

### Priority 1 — credible paper and experiment inputs

1. Add a paper-source adapter (Semantic Scholar or OpenAlex) with saved paper IDs, publication metadata, and primary-source links.
2. Add a paper-review screen so the user can approve/reject retrieved papers before synthesis.
3. Preserve versioned prompts, model settings, paper metadata, and dataset identifiers in each run manifest.
4. Replace generic profile templates with structured benchmark definitions for a small, practical target such as CIFAR-10 or a limited BraTS pipeline.

### Priority 2 — real distributed training

1. Implement a Python/PyTorch remote-worker service following `docs/worker-protocol.md`.
2. Allowlist container images, datasets, model recipes, epoch limits, and hyperparameter ranges on the worker.
3. Add worker identity/authentication, heartbeats, cancellation, retry/idempotency, resource limits, and artifact uploads.
4. Begin with one lightweight, reproducible benchmark and one baseline model.
5. Store real training logs, checkpoints, metric curves, and provenance artifacts.

### Priority 3 — stronger scheduling and research loop

1. Register worker resources such as GPU memory, available slots, dataset locality, and health.
2. Implement job queue persistence and scheduling policies for heterogeneous hardware.
3. Add early stopping and successive-halving allocation to stop weak candidates and reallocate compute.
4. Add a critic stage that compares results against the stated hypothesis and proposes a bounded next iteration.
5. Require user approval before automatically launching any additional real-compute iteration.

### Priority 4 — model-backed agents

1. Configure `OPENAI_API_KEY` when credits are available.
2. Use GPT-5.6/Codex for bounded literature synthesis, hypothesis formation, plan critique, analysis, and report drafting.
3. Enforce structured outputs for each agent and validate every plan against the experiment allowlist before execution.
4. Record model, prompt version, and response metadata in manifests.

### Priority 5 — hackathon polish and submission

1. Add a clearer worker map, experiment-comparison chart, and status timeline to the dashboard.
2. Create a 2–3 minute demo: question → preview and approval → parallel worker assignments → result comparison → manifest/report.
3. Improve the README with screenshots, deployment instructions, known limitations, and the exact role of GPT-5.6/Codex.
4. Prepare Devpost copy: problem, solution, technical architecture, use of OpenAI tools, impact, and future work.
5. Publish a clean repository with `.env.example`, license, contribution/setup documentation, and reproducible demo data.

## Recommended immediate next step

Build one real, small benchmark runner first. A good scope is a tiny image-classification baseline or a constrained segmentation sample that can finish on available hardware. Once one real worker returns real metrics, the product story becomes: **an auditable AI research planner that distributes and analyzes actual experiments**, rather than a simulated orchestration demo.

## Demo asset

Use `docs/demo-script.md` for a 2–3 minute recording that accurately demonstrates the current MVP without presenting simulated evidence as real research.
