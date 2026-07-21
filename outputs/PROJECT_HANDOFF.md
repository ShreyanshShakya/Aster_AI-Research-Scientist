# Distributed AI Research Scientist — project handoff

The runnable MVP source is in the parent workspace.

- `README.md` — setup, API demo, and OpenAI configuration
- `docs/architecture.md` — architecture, agent contracts, distributed worker boundary, and safety constraints
- `docs/implementation-plan.md` — four build phases and demo acceptance criteria
- `src/` — Node.js research orchestrator, agents, worker scheduler, persistence, and HTTP API
- `test/orchestrator.test.js` — end-to-end deterministic test

Run with `npm.cmd test` and `npm.cmd start` in Windows PowerShell. A project-specific `data/runs.json` is created after the first API run.
