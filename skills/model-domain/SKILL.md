---
name: model-domain
description: Build, augment, or audit a project's domain model and ubiquitous language. Use to bootstrap missing context files, condense bloated context, resolve domain terminology, record an architectural decision, or support another skill that needs to change the model.
argument-hint: [build|augment|audit] [scope-or-topic]
---

# Model Domain

Actively build and sharpen the project's domain model as you design.
Challenge terms, invent edge-case scenarios, and write the glossary and decisions down when they crystallize.

**Context files** are `CONTEXT.md` and `CONTEXT-MAP.md` files collectively.
They record or locate the project's **ubiquitous language**: the shared, canonical vocabulary that domain experts, users, documentation, tests, and code use for the project's domain.
The files are the durable record of that language, not the language itself; the words become ubiquitous only when everyone and every artifact use them consistently.

Merely reading the applicable context files to consume the ubiquitous language is a one-line habit that any skill can follow.
Invoke this skill when terms, relationships, context boundaries, or durable decisions need to be added, challenged, or changed.

When another skill invokes `model-domain`, embed this discipline in that skill's active workflow rather than starting a second interview.
When invoked standalone, start the dedicated session below.

Adapted from Matt Pocock's [domain-modeling skill](https://github.com/mattpocock/skills/blob/main/skills/engineering/domain-modeling/SKILL.md), with this repository's context and ADR conventions.

## File Structure

Most repositories have one context:

```text
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

If `CONTEXT-MAP.md` exists at the root, the repository has multiple contexts.
The map points to each context and its local documentation:

```text
/
├── CONTEXT-MAP.md
├── docs/
│   └── adr/                          ← project-wide decisions
└── src/
    ├── ordering/
    │   └── CONTEXT.md
    └── billing/
        └── CONTEXT.md
```

Read the applicable context files: the root `CONTEXT.md`, or `CONTEXT-MAP.md` and the relevant subordinate `CONTEXT.md` files.
Read recent and relevant project-wide ADRs from the root `docs/adr/`.
Create context files lazily: create `CONTEXT.md` when the first term resolves, `CONTEXT-MAP.md` when the first multi-context structure resolves, and root `docs/adr/` when the first ADR qualifies.
Use the [CONTEXT.md format](../shared/references/context-format.md) and [ADR format](../shared/references/adr-format.md).

## Standalone Session

When invoked standalone, read and follow the [standalone session workflow](references/standalone-session.md).
It selects **build from scratch**, **augment**, or **audit and condense** from `$ARGUMENTS` and the existing context files.
Investigate facts from code, documentation, and ADRs, and ask the user only for domain decisions.

## During the Session

### Challenge Against the Glossary

When the user uses a term that conflicts with the existing ubiquitous language, call it out immediately.
For example: "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"

### Sharpen Fuzzy Language

When the user uses a vague or overloaded term, propose one precise canonical term.
For example: "You're saying 'account' — do you mean the Customer or the User? Those are different things."

### Discuss Concrete Scenarios

Stress-test domain relationships with specific edge-case scenarios.
Force precision about concept boundaries, context ownership, cardinality, identity, and lifecycle.

### Cross-Reference With Code

When the user states how something works, check whether the code agrees.
Surface contradictions, for example: "Your code cancels entire Orders, but you just said partial cancellation is possible — which is right?"

### Update Context Files Inline

When a term or an intra-context relationship resolves, update the applicable `CONTEXT.md` immediately.
When context membership, ownership, a context boundary, or an inter-context relationship resolves, update `CONTEXT-MAP.md` immediately.
Do not batch these updates or leave the map inconsistent with its context files.

`CONTEXT.md` is a glossary and nothing else.
Keep it devoid of implementation details, specifications, and scratch-pad content.
Use its canonical terms consistently in the current conversation and every downstream artifact.

### Offer ADRs Sparingly

Offer to create an ADR only when all three conditions are true:

1. **Hard to reverse** — changing the decision later has meaningful cost.
2. **Surprising without context** — a future reader will reasonably ask why this choice was made.
3. **The result of a real trade-off** — genuine alternatives existed and were rejected for specific reasons.

If any condition is missing, skip the ADR.
