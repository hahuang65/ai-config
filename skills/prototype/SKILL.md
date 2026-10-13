---
name: prototype
description: Build a bounded, clearly marked runnable experiment to answer a logic, state, integration, or host-interface question without treating it as production code.
---

# Prototype

A prototype answers one question, not an entire feature request.
Agree on the question, the observation that would answer it, the allowed files and services, and a bounded time or effort budget.
Read the relevant current code and context before choosing the smallest useful experiment.
Use [mockup](../mockup/SKILL.md) instead when static appearance is the only question; neither skill is mandatory first.

- Mark the experiment `PROTOTYPE — NOT PRODUCTION` in its entry point and visible output.
  Keep it isolated from normal application startup, deployment, and production routes.
  Follow local conventions for scratch code or test routes; do not overwrite unrelated work.
- Give one command to run it with the existing project toolchain, plus any stop command and prerequisites.
  Do not install dependencies or start external services without permission.
  Bound subprocess and external-call timeouts, including any host-application experiment.
- No production data, credentials, customer records, or live production writes.
  Use synthetic fixtures with realistic shape and density when those matter.
- No persistence by default: keep state in process memory.
  If persistence is the question, agree on an isolated scratch database or clearly named scratch file and a cleanup boundary first.
- Expose relevant state and transitions without printing secrets or environment dumps.
  Include the failure cases needed to answer the question, but avoid production architecture and unrelated polish.
  Keep basic input validation and safe rendering even in throwaway code.
- Run the agreed experiment and report observed results and limitations separately from hypotheses.
  A runnable demonstration does not establish production correctness, performance, or security.

Capture the answer concisely and reference any existing issue or design document rather than duplicating it.
Use [model-domain](../model-domain/SKILL.md) for agreed durable terms or architecture decisions, and [work-log](../work-log/SKILL.md) for one meaningful checkpoint.
Ask for permission before deleting or adopting any prototype files, including files created during this experiment.
Adoption requires production constraints and tests; never silently promote the prototype shell.
Do not commit, publish, launch another session, or start implementation as an implied next step.
