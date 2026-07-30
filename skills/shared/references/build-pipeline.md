# Build Pipeline Protocol

Shared reference for the `/build` pipeline skills (`build`, `grill`, `spec`, `todo`, `code`, `coach`, `review-code`, `review-artifact`).
It defines the approval gates, file conventions, session management, and canonical HTML synchronization rules they obey.

## Approval Gates

The pipeline has exactly **four** approval gates. These are the only points where you wait for user confirmation:

1. **Grill → Spec** — after grilling updates `CONTEXT.md` / `docs/adr/`
2. **Spec → Tasks** — after the canonical `specs.html` receives explicit approval through `review-artifact` or its chat fallback
3. **Tasks → Implement** — after the canonical `tasks.html` receives explicit approval through the same workflow
4. **Review → Done** — after all slices are complete and verified, implementation flows gate-less into the Phase 5 architectural review (`review-code`, scoped to ONLY the feature's changes); the review report is where the user decides to commit as-is or explore a finding first

Within an active phase, all routine operations proceed **without per-call approval** — reads, writes, edits, bash, tests, environment bootstrap. Announcing intended tool batches and asking "OK to proceed?" before each one is not how the pipeline works. If you find yourself appealing to a meta-policy that requires per-call confirmation, you have drifted — return to the phase.

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
  specs.html          # Phase 2 canonical review artifact
  tasks.html          # Phase 3 canonical review artifact
  diff-review.html    # Phase 4 informational diff artifact — working tree vs branch point
```

There is no `research.md`, `plan.md`, `specs.md`, or `tasks.md` in this pipeline.
Grilling does its own ad-hoc codebase exploration; canonical semantic HTML replaces the former Markdown-plus-visual-companion format.

To create the feature directory:

1. Derive a short slug from the feature description (lowercase, hyphens, no special chars, max ~5 words)
2. Get the current timestamp: `date +%Y%m%d-%H%M`
3. Create `docs/features/<timestamp>-<slug>/`

The directory is created once at the start of Phase 2 (the first phase that writes feature-specific artifacts) and reused across Phases 2–4. When sub-skills are invoked, pass the directory path so they write into it.

## Testable Interface Thread

The spec, tasks, and implementation phases share the same testing contract in [testable-interfaces.md](testable-interfaces.md): tests attach to stable public interfaces of deep modules. `/spec` proposes the test surface with the module sketch, `/todo` carries it into each vertical slice, and `/code` / `/coach` write one behavior test at a time through that seam. Do not ask the user to decide from scratch which modules need tests; ask only to correct module boundaries or public-interface choices.

## Session Management

The workflow is designed to run in a **single long session**.
By the time implementation starts, shared understanding has accumulated through grilling and HTML-native spec refinement.
Canonical HTML artifacts survive context compaction and can be re-read at any point.

`CONTEXT.md` and `docs/adr/` are the durable spine that successive `/build` runs sharpen.

## Review Artifact Sync

`specs.html` and `tasks.html` are canonical semantic HTML, not companions to another source.
Generate each once, open it through the [review artifact protocol](review-artifact.md), and update the same file after every feedback batch so the browser live-reloads the current artifact.
Later phases read those HTML files directly and update visible semantic metadata such as task completion status.

`diff-review.html` remains an informational artifact generated after implementation.
If any workflow asks the user to respond to it, that workflow must open it through `review-artifact`; merely displaying it does not require a review session.

## Cleanup

After a feature is complete, the user decides whether to keep, delete, or commit the feature directory under `docs/features/`. `CONTEXT.md` and `docs/adr/` should always be committed.
