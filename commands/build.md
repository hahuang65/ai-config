---
description: Full feature workflow — grill, draft a PRD, break into vertical-slice tasks, implement via TDD
---
Load the build skill, then build: $ARGUMENTS

Follow the build skill workflow through all four phases. Because `/build` is only an orchestrator, load each phase skill's `SKILL.md` when entering that phase (`grill`, `prd`, `tasks`, then `implement` or `implement-coach`) and follow it; do not rely on whether the phase appears in an available-skills list.

1. **Grill** — interview the user, refine `CONTEXT.md` and ADRs inline, sharpen domain terminology
2. **PRD** — synthesize a PRD from the grilling outcome, iterate through annotation cycles until approved
3. **Tasks** — break the PRD into vertical-slice tracer bullets (HITL/AFK), quiz the user until approved
4. **Implement** — execute all slices via vertical-slice TDD (one test, one impl, repeat), then generate a fact-checked diff review

Stop **only at the four phase boundaries** — Grill→PRD, PRD→Tasks, Tasks→Implement, Implement→done — and wait for user confirmation at each transition. Inside a phase, proceed without per-tool-call approval. Tool calls are never gates.
