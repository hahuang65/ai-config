# Post-Implementation Review Chain

Shared reference for `implement` and `implement-coach`. Run this chain **after all slices are complete and the verification loop (see [tooling.md](tooling.md)) passes cleanly.**

## Who fixes what

- **`/implement` (AI mode):** the AI fixes CRITICAL and HIGH findings directly, then re-runs tests.
- **`/implement-coach` (coached mode):** the AI **surfaces** findings and **guides the user** to fix the ones they own (the implementation code) — they wrote it, they fix it. The AI still applies mechanical cleanup, documentation, and visual artifacts directly. Re-run tests after each fix.

## Chain

1. **Database review** *(conditional)* — if the implementation involved SQL queries, migrations, schema changes, or ORM operations, run the `database-reviewer` agent (via the Agent tool). Fix CRITICAL/HIGH issues. Re-run tests.

2. **Refactor** — run the `refactorer` agent (via the Agent tool) in **hygiene mode** on the changed files: a plan-less hygiene sweep for dead code, unused imports and dependencies, duplicate consolidation, simplification, and idiom fixes. The engine applies SAFE items directly (grep-verified, tests re-run per batch) and reports CAREFUL/RISKY findings without applying them. In AI mode, act on reported findings you judge safe; in coach mode, surface CAREFUL/RISKY findings to the user — they decide. Re-run tests.

3. **Code review** — run the `code-reviewer` agent (via the Agent tool) on all changed files. The agent reads and enforces the project's `rules/` files, applies confidence-based filtering, and reports findings by severity (including the OWASP Top 10). Fix CRITICAL/HIGH. Re-run tests.

4. **Documentation update** *(conditional)* — if the implementation added features, changed APIs, or modified architecture, run the `doc-updater` agent. Skip for trivial changes. (Documentation is not implementation code, so the AI handles it directly even in coach mode.)

5. **Fact-check** — run the `fact-checker` agent (via the Agent tool) on both `spec.md` and `tasks.md`. It starts cold on purpose — independent of the session that wrote the documents — and re-derives every claim (module names, decisions, behavior descriptions) from the code and git history, correcting drift in place.

6. **Refresh visuals** — regenerate `spec.html` and `tasks.html` so they mirror the final markdown, and open them in the browser. Mandatory — the visuals MUST always mirror the markdown.

7. **Diff review** — if `visual-explainer` is available, generate `diff-review.html` via `/diff-review`: compare the working tree against the branch point (typically `main`). Open it in the browser, then run the `fact-checker` agent (via the Agent tool) on the generated HTML. If `visual-explainer` is not available, skip silently.

8. **Verify task-to-implementation sync** — every acceptance criterion checked off (`- [x]`), every slice marked `**Status:** ✅ Complete`, deviations documented in the slice body, and both `tasks.html` and `spec.html` reflecting the final state.

## Completion

With the chain clean and the sync check passing, wrap up per [implementation-completion.md](implementation-completion.md).
