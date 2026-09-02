---
name: spec
description: Synthesize a feature spec from the current conversation context and codebase as canonical semantic HTML, then review it through review-artifact until explicitly approved. Produces timestamped docs/features HTML with user stories, decisions, and testing notes.
argument-hint: [feature-description]
---

# Specs Phase

Synthesize a feature spec from the grill session and codebase. **Do NOT interview the user further** — grilling and any approved mockup settled the design intent; this phase transcribes their outcomes into a durable artifact.

## Place in the /build Pipeline

This is **Phase 2** of the `/build` pipeline.
It assumes `/grill` already happened in this conversation or is recorded in the selected context documentation and decision records.
If invoked standalone and the context feels thin, point the user at `/grill` instead.
Before synthesis, apply the `mockup` relevance test; when a relevant `mockups.html` is missing, load and run [mockup](../mockup/SKILL.md) before synthesizing the Spec.
Inside `/build`, reuse the mockup and Design→Spec decision already produced by the orchestrator rather than asking again.
See [../shared/references/build-pipeline.md](../shared/references/build-pipeline.md) for file conventions; write the canonical `specs.html` into the feature directory.
Read [../shared/references/testable-interfaces.md](../shared/references/testable-interfaces.md) before sketching modules so the testing plan is derived from public interfaces, not delegated back to the user.

## Process

### Step 1: Read context

- Resolve the [domain documentation destination](../shared/references/domain-documentation.md) again for this invocation. For an A5 linked worktree, reloading valid state avoids another prompt while renewing every trust check. Every other checkout uses local files without prompting.
- Read the applicable local context files and recent ADRs, or the saved Confluence context and decisions documents, especially records added this session.
- Read approved `mockups.html` when present and treat its selected design as Authoritative intent.
- Skim the codebase area the feature touches. The spec is grounded in the actual codebase, not assumptions.
- After those current sources, read the [optional historical memory](../shared/references/agentmemory.md) protocol and search once when agentmemory is available. Search with the feature slug and principal domain or module terms, verify useful prior constraints and corrections, and never use memory to bypass grilling or establish approval.

### Step 2: Sketch the modules

Identify the major production modules to build or modify. **Actively look for deep modules** — a lot of functionality behind a simple, testable interface that rarely changes. Prefer deep over shallow (a shallow module's interface is nearly as wide as its implementation). Do not list spec files, fixtures, mocks, or follow-up docs as product modules.

For each module, derive the test surface yourself using [../shared/references/testable-interfaces.md](../shared/references/testable-interfaces.md): test user-visible behavior through the highest stable public interface; direct-test lower-level modules only when they are deep in their own right. The user should not have to answer "which modules get tests?" — the deep-module/testable-interface rule answers that.

**Consult the domain agents when the feature touches their turf.** If the feature adds or changes REST API endpoints, run the `api-designer` agent (via the Agent tool) with the feature description — carry its endpoint contract (paths, status codes, pagination, error format) into the module sketch and Implementation Decisions. If the feature adds or restructures UI, run the `frontend-architect` agent the same way for component boundaries, state ownership, and the a11y baseline. Skip both silently for features that touch neither domain; run both for full-stack features.

This is the one micro-checkpoint in this phase.
Choose its presentation from the module count:

- For more than four modules, generate a temporary module-sketch HTML artifact in the operating-system temporary directory with one bounded card per module.
  Each card contains the module name, one-line purpose, and test surface: direct public interface, covered through a higher-level interface, or no product test with the reason.
  Load `review-artifact` with the `approval` purpose and `explore` mode by passing `--purpose approval --mode explore`, then follow the shared protocol.
  Apply feedback to the same temporary artifact and keep its module identifiers stable until the user approves it.
- For four or fewer modules, present the same information as a concise list in chat and wait for confirmation.

End either presentation with this checkpoint question:

> Do these module boundaries and test seams match your mental model? Identify any module whose boundary or public interface is wrong; otherwise approve, and I will carry the accepted sketch into the Spec's Testing Decisions.

This replaces the existing chat confirmation only when the artifact threshold is met; it does not add another pipeline approval gate or a separate testing-ownership question.
If the browser runtime falls back to chat, present the module cards as a concise numbered list and preserve explicit confirmation.
After approval or chat confirmation, use the proposed testing plan and carry the accepted module sketch into the canonical Spec; the temporary checkpoint is not a second source of Authoritative intent.

### Step 3: Write the canonical spec

Synthesize `specs.html` using the semantic structure in [references/spec-template.md](references/spec-template.md).
Use the ubiquitous language from the selected context documentation and reference decision records by their `ADR-NNNN` or `D-NNN` identifier.
The file itself is the durable spec; do not create `specs.md` or a hidden duplicate model.
The HTML must use `<feature title> - Spec` in its `<title>`, use "Spec" in its `<h1>`, and emphasize user stories, decisions, and module sketches rather than file maps or code.
Use `visualize` guidance for presentation when available, but the semantic HTML deliverable is mandatory.
When a mockup exists, summarize and link the selected design without duplicating the visual artifact in the Spec.

### Step 4: Review and advance

Load `review-artifact` and review `specs.html` as an approval review using [the shared protocol](../shared/references/review-artifact.md).
Point the user at missing or misstated user stories, implementation and testing decisions, and scope to cut.
After each feedback batch, update the same HTML so the open browser live-reloads the current spec, then resume polling with an agent reply.
If Spec feedback materially redesigns the UI, use this return path:

1. Pause the Spec approval review.
2. Update the changed `mockups.html`, then load and run [mockup](../mockup/SKILL.md) through `review-artifact` until explicit approval.
3. Synchronize `specs.html` with the approved mockup, then resume the Spec approval review.
4. Continue to Tasks only after explicit Spec approval; renew any prior Spec approval invalidated by the UI change.

On explicit browser approval or chat-fallback confirmation, advance immediately:

> **Spec ready** — canonical artifact at `<spec-path>`. Breaking it into tasks via `/todo`.

Then proceed to `/todo`.

## Important Guidelines

- **Synthesize, don't interview.** If essential information is genuinely missing, ask one targeted question — don't re-run the grill.
- **Do not silently change the domain model.** If feedback or synthesis exposes a missing or conflicting domain concept, invoke [model-domain](../model-domain/SKILL.md) to resolve and record it before continuing.
- **No code snippets, no file paths** in the body (except the narrow exception in the template).
- **Write canonical `specs.html` directly and keep it live.** Apply every feedback batch to that same file before polling again.
- Keep the spec focused — suggest cutting scope if it grows too large.
