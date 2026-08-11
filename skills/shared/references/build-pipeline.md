# Build Pipeline Protocol

Shared reference for the `/build` pipeline skills (`build`, `grill`, `mockup`, `spec`, `todo`, `code`, `coach`, `review-change`, `review-artifact`).
It defines the approval gates, file conventions, session management, and canonical HTML synchronization rules they obey.

## Approval Gates

The pipeline has exactly **four** approval gates. These are the only points where you wait for user confirmation:

1. **Design→Spec** — after grilling invokes `model-domain`, explicit mockup approval clears the gate when relevant UI requires canonical `mockups.html`; otherwise post-grill chat confirmation clears it
2. **Spec → Tasks** — after the canonical `specs.html` receives explicit approval through `review-artifact` or its chat fallback
3. **Tasks → Implement** — after the canonical `tasks.html` receives explicit approval through the same workflow
4. **Review → Done** — after all slices are complete and verified, implementation flows gate-less into Phase 5 Review change; its report is where the user explicitly disposes every `ask-user` Finding and approves as-is or selects repairs

Within an active phase, all routine operations proceed **without per-call approval** — reads, writes, edits, bash, tests, environment bootstrap. Announcing intended tool batches and asking "OK to proceed?" before each one is not how the pipeline works. If you find yourself appealing to a meta-policy that requires per-call confirmation, you have drifted — return to the phase.

## File Conventions

### Project-wide (accrete across many `/build` runs)

```text
CONTEXT.md or CONTEXT-MAP.md         # root context entry point
<context>/CONTEXT.md                 # optional bounded-context records
docs/adr/*.md                        # project-wide decisions
```

These outlive any single feature.
The `git-commit` rule decides whether to include them, including its A5 project exception.

### Feature-specific (one directory per build run)

```
docs/features/<YYYYMMDD-HHMM>-<slug>/
  mockups.html        # Conditional canonical UI design and Authoritative intent
  specs.html          # Phase 2 canonical review artifact and build intent
  tasks.html          # Phase 3 canonical review artifact and completion state
```

There is no `research.md`, `plan.md`, `specs.md`, or `tasks.md` in this pipeline.
Grilling does its own ad-hoc codebase exploration; canonical semantic HTML replaces the former Markdown-plus-visual-companion format.

To create the feature directory:

1. Derive a short slug from the feature description (lowercase, hyphens, no special chars, max ~5 words)
2. Get the current timestamp: `date +%Y%m%d-%H%M`
3. Create `docs/features/<timestamp>-<slug>/`

For relevant UI, create the directory after grilling and before invoking `mockup`; explicit mockup approval then starts `spec` without another confirmation.
For work without relevant UI, create it after post-grill chat confirmation at the start of Phase 2.
Reuse the directory through all later phases and pass it to each invoked skill.

## Testable Interface Thread

The spec, tasks, and implementation phases share the same testing contract in [testable-interfaces.md](testable-interfaces.md): tests attach to stable public interfaces of deep modules. `/spec` proposes the test surface with the module sketch, `/todo` carries it into each vertical slice, and `/code` / `/coach` write one behavior test at a time through that seam. Do not ask the user to decide from scratch which modules need tests; ask only to correct module boundaries or public-interface choices.

## Session Management

The workflow is designed to run in a **single long session**.
By the time implementation starts, shared understanding has accumulated through grilling and HTML-native spec refinement.
Canonical HTML artifacts survive context compaction and can be re-read at any point.

The applicable context files record or locate the project's ubiquitous language.
They and `docs/adr/` are the durable spine that successive `/build` runs sharpen.

## Review Artifact Sync

`mockups.html` when present, `specs.html`, and `tasks.html` are canonical semantic HTML, not companions to another source.
Generate each once, open it through the [review artifact protocol](review-artifact.md), and update the same file after every feedback batch so the browser live-reloads the current artifact.
Later phases read those HTML files directly; implementation updates visible task-completion metadata in `tasks.html`.

After implementation, Review change validates approved mockup intent with focused UI evidence and reports material drift without rewriting the mockup to match implementation.
It cold-fact-checks `specs.html` and `tasks.html` against final code and Git history, applies factual corrections in place, and confirms that a second clean pass is idempotent.
It does not generate an automatic `diff-review.html`; `/visualize-diff` remains available standalone.
The disposable Review change report lives in the operating-system temp directory and is opened through `review-artifact` for the final decision.

## Cleanup

After a feature is complete, the user decides whether to keep, delete, or commit the Feature directory.
Defer artifact inclusion to the `git-commit` rule, including its A5 project exception.
