# Post-Implementation Review Chain

Shared reference for `code` and `coach`. Run this chain **after all slices are complete and the verification loop (see [tooling.md](tooling.md)) passes cleanly.**

## Who fixes what

- **`/code` (AI mode):** the AI fixes CRITICAL and HIGH findings directly, then re-runs tests.
- **`/coach` (coached mode):** the AI **surfaces** findings and **guides the user** to fix the ones they own (the implementation code) — they wrote it, they fix it. The AI still applies mechanical cleanup, documentation, and visual artifacts directly. Re-run tests after each fix.

## Chain

1. **Database review** *(conditional)* — if the implementation involved SQL queries, migrations, schema changes, or ORM operations, run the `database-reviewer` agent (via the Agent tool). Fix CRITICAL/HIGH issues. Re-run tests.

2. **Refactor** — run the `refactorer` agent (via the Agent tool) in **hygiene mode** on the changed files: a plan-less hygiene sweep for dead code, unused imports and dependencies, duplicate consolidation, simplification, and idiom fixes. The engine applies SAFE items directly (grep-verified, tests re-run per batch) and reports CAREFUL/RISKY findings without applying them. In AI mode, act on reported findings you judge safe; in coach mode, surface CAREFUL/RISKY findings to the user — they decide. Re-run tests.

3. **Code review** — run the `code-reviewer` agent (via the Agent tool) on all changed files. The agent reads and enforces the project's `rules/` files, applies confidence-based filtering, and reports findings by severity (including the OWASP Top 10). Fix CRITICAL/HIGH. Re-run tests.

4. **Documentation update** *(conditional)* — if the implementation added features, changed APIs, or modified architecture, run the `doc-updater` agent. Skip for trivial changes. (Documentation is not implementation code, so the AI handles it directly even in coach mode.)

5. **Fact-check** — run the `fact-checker` agent on canonical `specs.html` and `tasks.html`.
It starts cold on purpose and re-derives every claim from code and git history, correcting drift directly in the visible semantic HTML.

6. **Refresh canonical artifacts** — update `specs.html` for implementation drift and `tasks.html` for final visible completion status.
There is no Markdown source to regenerate from.

7. **Diff review** — if `visualize` is available, generate `diff-review.html` via `/visualize-diff` against the branch point, then run the `fact-checker` agent on it.
This is informational inside implementation; start `review-artifact` only if the workflow asks the user to respond to it.

8. **Verify task-to-implementation sync** — every acceptance criterion and slice has visible `complete` status plus `data-status="complete"`, deviations are documented in the slice body, and both canonical HTML artifacts reflect the final implementation.

## Completion

With the chain clean and the sync check passing, wrap up per [implementation-completion.md](implementation-completion.md).
