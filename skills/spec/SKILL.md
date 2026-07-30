---
name: spec
description: Synthesize a feature spec from the current conversation context (typically a /grill session) and the codebase. Produces docs/features/<slug>/specs.md with user stories, decisions, and testing notes — no code snippets, no file paths. Supports annotation cycles. Based on Matt Pocock's to-prd skill.
argument-hint: [feature-description]
---

# Specs Phase

Synthesize a feature spec from the grill session and codebase. **Do NOT interview the user further** — grilling was the design phase; this phase transcribes its outcome into a durable artifact.

## Place in the /build Pipeline

This is **Phase 2** of the `/build` pipeline. It assumes `/grill` (Phase 1) already happened — either in this conversation or recorded in `CONTEXT.md` / `docs/adr/`. If invoked standalone and the context feels thin, point the user at `/grill` instead. See [../shared/references/build-pipeline.md](../shared/references/build-pipeline.md) for the file conventions; write `specs.md` and `specs.html` into the feature directory (`docs/features/<YYYYMMDD-HHMM>-<slug>/`, created standalone if needed). Read [../shared/references/testable-interfaces.md](../shared/references/testable-interfaces.md) before sketching modules so the testing plan is derived from public interfaces, not delegated back to the user.

## Rules Adherence

Comply with the project rules in `rules/` (coding-style, testing, security, performance, git-commit). Read detailed rules from `~/.dotfiles/ai/rules/`; in oh-my-pi, the equivalent native lookup is `rule://<name>`. Testing Decisions must follow the testing rules; Implementation Decisions must respect security and performance rules.

## Process

### Step 1: Read context

- Read `CONTEXT.md` at the repo root (and subordinate `CONTEXT.md` files via `CONTEXT-MAP.md`). Use this vocabulary throughout.
- Read recent ADRs in `docs/adr/` — especially any added this session — and respect them.
- Skim the codebase area the feature touches. The spec is grounded in the actual codebase, not assumptions.

### Step 2: Sketch the modules

Identify the major production modules to build or modify. **Actively look for deep modules** — a lot of functionality behind a simple, testable interface that rarely changes. Prefer deep over shallow (a shallow module's interface is nearly as wide as its implementation). Do not list spec files, fixtures, mocks, or follow-up docs as product modules.

For each module, derive the test surface yourself using [../shared/references/testable-interfaces.md](../shared/references/testable-interfaces.md): test user-visible behavior through the highest stable public interface; direct-test lower-level modules only when they are deep in their own right. The user should not have to answer "which modules get tests?" — the deep-module/testable-interface rule answers that.

**Consult the domain agents when the feature touches their turf.** If the feature adds or changes REST API endpoints, run the `api-designer` agent (via the Agent tool) with the feature description — carry its endpoint contract (paths, status codes, pagination, error format) into the module sketch and Implementation Decisions. If the feature adds or restructures UI, run the `frontend-architect` agent the same way for component boundaries, state ownership, and the a11y baseline. Skip both silently for features that touch neither domain; run both for full-stack features.

This is the one micro-checkpoint in this phase. Briefly confirm with the user:

> Here are the modules I think this feature needs, with the test surface I will use:
> - **<ModuleName>** — <one-line purpose>. **Test surface:** <direct public interface / covered through higher-level interface / no product test + reason>.
>
> Do these module boundaries and test seams match your mental model? If any boundary or public interface is wrong, tell me; otherwise I'll carry this into the spec's Testing Decisions.

Wait for the answer before continuing. If they simply confirm, use the proposed testing plan; do not ask a separate testing-ownership question.

### Step 3: Write the spec

Synthesize `specs.md` using the structure in [references/spec-template.md](references/spec-template.md). Use `CONTEXT.md` vocabulary; reference ADRs by number.

### Step 4: Generate the visual spec

Invoke the `visualize` skill to produce `specs.html` in the feature directory (not `~/.agent/diagrams/`), and **open it in the browser**. The HTML must use "Spec" (not "Plan") in its `<title>` and `<h1>` (e.g. `<h1>Cursor Pagination — Spec</h1>`) and emphasize user stories, decisions, and module sketches — not file maps or code.

### Step 5: Review and advance

Review `specs.md` with the user using the protocol in [../shared/references/artifact-review.md](../shared/references/artifact-review.md). For a spec, default to **`//` annotations** — there's usually a lot to mark up inline. Point the user at what to check: missing or mis-stated user stories, implementation and testing decisions, and scope to cut. **Do not regenerate `specs.html` during the review** — work from `specs.md`; the open visual can lag until the cycles are done.

On the user's confirmation, regenerate `specs.html` once if the markdown changed (reopen it), then advance to the task breakdown:

> **Spec ready** — visual at `<diagram-path>` (opened in your browser). Breaking it into tasks via `/todo`.

Then proceed to `/todo`.

## Important Guidelines

- **Synthesize, don't interview.** If essential information is genuinely missing, ask one targeted question — don't re-run the grill.
- **Use `CONTEXT.md` vocabulary.** If the glossary says "Customer", don't write "User" or "Account".
- **No code snippets, no file paths** in the body (except the narrow exception in the template).
- **Generate `specs.html` when `specs.md` is first written and open it** — don't regenerate during the review; regenerate once at the end only if the markdown changed (and later on implementation drift).
- Keep the spec focused — suggest cutting scope if it grows too large.

Ultrathink.
