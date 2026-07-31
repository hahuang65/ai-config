# Completion

Shared reference for `code` and `coach`. Run this **after post-implementation hygiene (see [implementation-hygiene.md](implementation-hygiene.md)) and full verification are clean.** The completion is identical for both skills — only *who* did the work differs (the AI in `/code`, the user in `/coach`), so report it accordingly.

## Report

Report what was accomplished this session:

- Slices completed (each criterion and slice visibly complete with `data-status="complete"` in canonical `tasks.html`)
- Tests added and passing
- Every final type-check, lint, test, and build command with its exact scope and outcome
- Hygiene items applied or reported
- That final documentation, canonical-artifact fact-checking, and the decision report remain owned by Review change in build mode

## What happens next

- **Inside `/build`:** proceed straight to Phase 5 — `review-change` scoped to only the feature change, with canonical `specs.html` and `tasks.html` as Authoritative intent, the implementation mode for repair ownership, and the exact final verification commands, scopes, and outcomes as prior broad evidence that it records without rerunning. No gate sits between implementation and Review change; its report carries the final approve-as-is or fix-selected decision.
- **Standalone `/code`:** after reporting, add these pointers:

> If you notice structural issues now that the code is done:
> - **Local restructuring** (a file got too big, a helper is worth extracting, a rename is worth doing) → run `/refactor` — it's user-directed and works on what you point it at.
> - **Architectural friction** (modules feel shallow, tests had to reach past interfaces, the area is hard to navigate) → run `/review-code` — the `architecture-reviewer` agent surfaces deepening opportunities as an HTML report (no arguments = entire codebase, arguments = that area).
>
> Invoke them when you notice friction, not as a mandatory step.

## Never commit

**NEVER commit to version control** — no `git add`, `git commit`, or `git push`. The user commits when ready.
