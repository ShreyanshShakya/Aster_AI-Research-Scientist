# Phased implementation plan

## Phase 0 — demo spine (this scaffold)

Complete a question-to-report flow with mock literature, three planned experiments, two heterogeneous simulated workers, result ranking, and an observable timeline. Success: `npm test` passes and a reviewer can create and inspect a run over HTTP.

## Phase 1 — credible research inputs

Add an approved paper source adapter (Semantic Scholar/OpenAlex), structured citations, PDF metadata extraction, and a review screen. Keep retrieval separate from synthesis and save paper IDs/versioned prompts to each run.

## Phase 2 — real experiment runners

Implement a worker daemon with mTLS/authentication. Run an allowlisted Docker image with mounted, versioned datasets; stream metrics; support cancellation and heartbeats. Start with one small benchmark and a baseline training script.

## Phase 3 — intelligent allocation

Add worker registration, GPU memory and dataset locality constraints, queue persistence, early stopping, and successive-halving allocation. Expose every stop/reallocation decision in the timeline.

## Phase 4 — polished hackathon submission

Build a single-page research timeline, worker map, experiment comparison chart, and downloadable report. Record a 2–3 minute demo: question → plan → parallel workers → result → auditable report. Include architecture, setup, limitations, and exactly where Codex/GPT-5.6 accelerates research work in the README.

## Acceptance criteria for the demo

1. A focused question completes under 30 seconds with simulated workers.
2. Every run shows plans, assignments, metrics, analysis, and report.
3. The demo makes the simulated-vs-real boundary unmistakable.
4. A real worker can be added through one adapter interface.

