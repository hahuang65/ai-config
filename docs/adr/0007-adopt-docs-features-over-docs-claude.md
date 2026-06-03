# Adopt `docs/features/` for per-feature artifacts, replacing `docs/claude/`

The `/build` pipeline writes each run's PRD, tasks, and diff-review artifacts into a per-feature directory. It was named `docs/claude/<YYYYMMDD-HHMM>-<slug>/`, a Claude-Code-specific name in a repo that is explicitly **multi-harness** (Claude Code, OpenCode, oh-my-pi). We renamed the convention to the harness-neutral `docs/features/<YYYYMMDD-HHMM>-<slug>/`.

## Considered Options

- **Keep `docs/claude/`** — zero churn, but bakes one harness's name into an artifact path the other two harnesses also produce, and the name no longer describes its contents.
- **Adopt `docs/features/` and migrate history** (chosen) — every pipeline skill, every cross-referencing standalone skill (`handoff`, `prototype`, `improve-codebase`), the README, the example project, and the existing dated feature directories move to the new name in one cut. No straddle, no orphaned convention.

## Consequences

- The nine existing feature directories were `git mv`'d from `docs/claude/` to `docs/features/`, and internal links inside their archived `prd.md` / `tasks.md` / `*.html` were updated to match. History is preserved, just relocated.
- Any external bookmark or link pointing at a `docs/claude/...` path breaks. Acceptable: these are internal working artifacts, not a published surface.
- The cutover is deliberately total — a future reader should never find both names in the tree. If one appears, it is a miss to fix, not a second supported convention.
