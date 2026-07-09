# Completion

Shared reference for `code` and `coach`. Run this **after the post-implementation review chain (see [review-chain.md](review-chain.md)) is clean.** The completion is identical for both skills — only *who* did the work differs (the AI in `/code`, the user in `/coach`), so report it accordingly.

## Report

Report what was accomplished this session:

- Slices completed (each checked off and marked `**Status:** ✅ Complete` in `tasks.md`)
- Tests added and passing
- Type check / lint / build ✅
- Review findings addressed
- Which visuals were refreshed (`specs.html`, `tasks.html`, `diff-review.html`)

## What happens next

- **Inside `/build`:** proceed straight to Phase 5 — `review-code` scoped to ONLY the feature's changes. No gate between implementation and the review; the review report carries the pipeline's final commit-or-iterate decision.
- **Standalone `/code`:** after reporting, add these pointers:

> If you notice structural issues now that the code is done:
> - **Local restructuring** (a file got too big, a helper is worth extracting, a rename is worth doing) → run `/refactor` — it's user-directed and works on what you point it at.
> - **Architectural friction** (modules feel shallow, tests had to reach past interfaces, the area is hard to navigate) → run `/review-code` — the `architecture-reviewer` agent surfaces deepening opportunities as an HTML report (no arguments = entire codebase, arguments = that area).
>
> Invoke them when you notice friction, not as a mandatory step.

## Never commit

**NEVER commit to version control** — no `git add`, `git commit`, or `git push`. The user commits when ready.
