---
name: grill
description: Interactive grilling session that interviews the user about a feature, sharpens domain terminology, and updates project documentation (CONTEXT.md, ADRs) inline as decisions crystallise. Use when the user wants to stress-test an idea against their project's language and documented decisions before drafting a PRD. Based on Matt Pocock's grill-with-docs skill.
argument-hint: [feature-description]
---

# Grill Phase

Interview the user relentlessly about every aspect of the feature idea until you reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, propose your recommended answer.

**Ask the user questions one at a time, waiting for feedback before posing the next.** This applies to the user-facing questions you draft for the grilling interview — it does NOT apply to your own codebase exploration. Reads, searches, and other tool calls used to ground a question (or to avoid a question the code already answers) proceed without per-call confirmation.

If a question can be answered by exploring the codebase, explore the codebase instead — do not bother the user with something the code already answers.

## Place in the /build Pipeline

This is **Phase 1** of the `/build` pipeline. Output of this phase is not a feature-specific markdown artifact — it is updates to project-wide documentation:

- **`CONTEXT.md`** at the repo root — the shared domain glossary
- **`docs/adr/`** at the repo root — Architectural Decision Records

These are project-wide artifacts that accrete over many `/build` runs. Do not put them inside `docs/claude/<feature-slug>/` — they outlive any single feature.

When invoked **standalone** (not from `/build`), `$ARGUMENTS` is the topic to grill on.

When invoked **from `/build`**, the orchestrator passes the feature description and the feature directory path. The feature directory is used by later phases (`/prd`, `/tasks`); this phase does not write into it.

## Domain Awareness

At the start of the session, look for existing documentation:

### File structure

Most repos have a single context:

```
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

If a `CONTEXT-MAP.md` exists at the root, the repo has multiple contexts. The map points to where each one lives:

```
/
├── CONTEXT-MAP.md
├── docs/
│   └── adr/                          ← system-wide decisions
├── src/
│   ├── ordering/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/                 ← context-specific decisions
│   └── billing/
│       ├── CONTEXT.md
│       └── docs/adr/
```

Create files lazily — only when you have something to write. If no `CONTEXT.md` exists, create one when the first term is resolved. If no `docs/adr/` exists, create it when the first ADR is needed.

## During the Session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in `CONTEXT.md`, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account' — do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible — which is right?"

### Update CONTEXT.md inline

When a term is resolved, update `CONTEXT.md` right there. Don't batch these up — capture them as they happen. Use the format in [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md).

`CONTEXT.md` should be totally devoid of implementation details. Do not treat `CONTEXT.md` as a spec, a scratch pad, or a repository for implementation decisions. It is a glossary and nothing else.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Use the format in [ADR-FORMAT.md](./ADR-FORMAT.md).

## Completion

The grill phase is done when the user says they're satisfied with the shared understanding — typically when:

- All ambiguous terms have been pinned down
- Cardinality and lifecycle questions are answered
- The ADR-worthy decisions are recorded
- The user no longer has questions you cannot answer from the codebase

Then tell the user:

> **Grill phase complete.** I've updated:
> - `CONTEXT.md` with <n> term(s): <list>
> - `docs/adr/` with <n> new ADR(s): <list>
>   *(or "no new ADRs — none of today's decisions met the hard-to-reverse + surprising + real-trade-off bar")*
>
> Say **"draft the PRD"** when you're ready and I'll synthesize what we discussed into a PRD via `/prd`.

Do NOT proceed to drafting the PRD until the user explicitly says so. The grilling conversation IS the design phase — the PRD just transcribes its outcome.

Ultrathink.
