# Build Pipeline Protocol

Shared reference for the `/build` pipeline skills (`build`, `grill`, `prd`, `tasks`, `implement`, `implement-coach`). Defines the approval gates, file conventions, session management, and visual-sync rules they all obey.

## Approval Gates

The pipeline has exactly **four** approval gates. These are the only points where you wait for user confirmation:

1. **Grill → PRD** — after grilling updates `CONTEXT.md` / `docs/adr/`
2. **PRD → Tasks** — after the PRD and its visual are approved (annotation cycles complete)
3. **Tasks → Implement** — after the task breakdown is approved
4. **Implement → Done** — after all slices are complete and verified

Within an active phase, all routine operations proceed **without per-call approval** — reads, writes, edits, bash, tests, environment bootstrap. Announcing intended tool batches and asking "OK to proceed?" before each one is not how the pipeline works. If you find yourself appealing to a meta-policy that requires per-call confirmation, you have drifted — return to the phase. (In omp, see `~/.omp/agent/RULES.md`: "Approval gates are user-facing only.")

## File Conventions

### Project-wide (accrete across many `/build` runs)

```
/
├── CONTEXT.md                      # shared glossary (refined by /grill)
└── docs/
    └── adr/                        # Architectural Decision Records (added by /grill)
        ├── 0001-event-sourced-orders.md
        └── 0002-postgres-for-write-model.md
```

These outlive any single feature and should be committed.

### Feature-specific (one directory per build run)

```
docs/features/<YYYYMMDD-HHMM>-<slug>/
  prd.md             # Phase 2 output
  prd.html           # Phase 2 visual companion
  tasks.md           # Phase 3 output
  tasks.html         # Phase 3 visual companion
  diff-review.html   # Phase 4 visual companion — working tree vs branch point
```

There is no `research.md` or `plan.md` in this pipeline. Grilling does its own ad-hoc codebase exploration; the PRD replaces the old plan format.

To create the feature directory:

1. Derive a short slug from the feature description (lowercase, hyphens, no special chars, max ~5 words)
2. Get the current timestamp: `date +%Y%m%d-%H%M`
3. Create `docs/features/<timestamp>-<slug>/`

The directory is created once at the start of Phase 2 (the first phase that writes feature-specific artifacts) and reused across Phases 2–4. When sub-skills are invoked, pass the directory path so they write into it.

## Session Management

The workflow is designed to run in a **single long session**. By the time implementation starts, you've built deep shared understanding through grilling and PRD refinement. All artifacts — markdown and visual HTML — survive context compaction and can be re-read at any point.

`CONTEXT.md` and `docs/adr/` are the durable spine that successive `/build` runs sharpen.

## Visual Sync

Each visual HTML companion is generated and opened **when its markdown is first written**. It is **not** regenerated during the review — the markdown is the source of truth across the feedback loop, so the open visual may lag — then regenerated once after the review if the markdown changed, and again after implementation (drift / completion status). Regenerating on every intermediate feedback pass is slow and costly; don't.

- **`prd.html`** — generated and opened when `prd.md` is first written; regenerated once after the PRD review if it changed, and after implementation if drift is detected.
- **`tasks.html`** — generated and opened when `tasks.md` is first written; regenerated once after the task review if it changed, and after implementation to reflect completion status.
- **`diff-review.html`** — generated once after implementation: a visual HTML page comparing the working tree against the branch point (typically `main`), showing what changed.

The `visual-explainer` skill produces these companions. If it is not installed, every visual step is skipped silently.

## Cleanup

After a feature is complete, the user decides whether to keep, delete, or commit the feature directory under `docs/features/`. `CONTEXT.md` and `docs/adr/` should always be committed.
