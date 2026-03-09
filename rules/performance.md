# Performance & Model Selection

## Model routing guidance

Choose the right model for the task:

- **Haiku**: Deterministic, low-risk mechanical changes. Renaming, reformatting, simple find-and-replace, generating boilerplate, running linters. Fast and cheap.
- **Sonnet**: Default for most work. Implementation, refactoring, bug fixes, code review, test writing. Covers ~90% of tasks.
- **Opus**: Architecture decisions, deep code review, ambiguous requirements, complex multi-file refactors, planning phases. Use when accuracy matters more than speed.

When in doubt, start with Sonnet. Escalate to Opus if the task requires reasoning across many files or making judgment calls about design.

## General performance

- Profile before optimizing. Never guess at bottlenecks.
- Prefer algorithmic improvements over micro-optimizations.
- Cache expensive computations. Invalidate caches explicitly.
- Use pagination for list endpoints. Default to cursor-based for large datasets.
- Lazy-load heavy resources. Load code, images, and data only when needed.
- Set timeouts on all external calls. No unbounded waits for HTTP requests, database queries, or subprocess execution.
