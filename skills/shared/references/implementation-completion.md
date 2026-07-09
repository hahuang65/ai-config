# Completion

Shared reference for `implement` and `implement-coach`. Run this **after the post-implementation review chain (see [review-chain.md](review-chain.md)) is clean.** The completion is identical for both skills — only *who* did the work differs (the AI in `/implement`, the user in `/implement-coach`), so report it accordingly.

## Report

Report what was accomplished this session:

- Slices completed (each checked off and marked `**Status:** ✅ Complete` in `tasks.md`)
- Tests added and passing
- Type check / lint / build ✅
- Review findings addressed
- Which visuals were refreshed (`spec.html`, `tasks.html`, `diff-review.html`)

## Completion pointers

After reporting, add these pointers:

> If you notice structural issues now that the code is done:
> - **Local restructuring** (a file got too big, a helper is worth extracting, a rename is worth doing) → run `/refactor` — it's user-directed and works on what you point it at.
> - **Architectural friction** (modules feel shallow, tests had to reach past interfaces, the area is hard to navigate) → run `/improve-codebase` — it surfaces deepening opportunities across an area as an HTML report you can drive a separate session against.
>
> Both deliberately live outside the implement phase. Invoke them when you notice friction, not as a mandatory step.

## Never commit

**NEVER commit to version control** — no `git add`, `git commit`, or `git push`. The user commits when ready.
