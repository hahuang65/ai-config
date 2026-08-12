---
name: model-domain
description: Build, augment, or audit a project's domain model and ubiquitous language in local or Confluence documentation. Use to bootstrap missing context, condense bloated context, resolve domain terminology, record a durable decision, or support another skill that needs to change the model.
argument-hint: "[build|augment|audit] [scope-or-topic]"
---

# Model Domain

Actively build and sharpen the project's domain model as you design.
Challenge terms, invent edge-case scenarios, and write the glossary and decisions down when they crystallize.

**Context files** are local `CONTEXT.md` and `CONTEXT-MAP.md` files collectively.
**Context documentation** is the durable source: context files, or an A5 linked worktree's saved Confluence context document.
It records or locates the project's **ubiquitous language**: the shared, canonical vocabulary that domain experts, users, documentation, tests, and code use for the project's domain.
The documentation is the durable record of that language, not the language itself; the words become ubiquitous only when everyone and every artifact use them consistently.

Merely reading the applicable context documentation to consume the ubiquitous language is a one-line habit that any skill can follow.
Invoke this skill when terms, relationships, context boundaries, or durable decisions need to be added, challenged, or changed.

When another skill invokes `model-domain`, embed this discipline in that skill's active workflow rather than starting a second interview.
When invoked standalone, start the dedicated session below.

Adapted from Matt Pocock's [domain-modeling skill](https://github.com/mattpocock/skills/blob/main/skills/engineering/domain-modeling/SKILL.md), with this repository's context and decision-record conventions.

## Resolve the Worktree Documentation Destination

Read and follow the shared [domain documentation destination](../shared/references/domain-documentation.md) protocol before reading or writing domain documentation.
It uses local files without prompting for every non-A5 project and for an A5 main project directory.
It persists one safe local-or-Confluence selection only for an A5 linked worktree.

Read and write the selected destination only.
For Confluence, the two supplied pages are a closed destination: never create another page or write to a linked or subordinate page.
Write context content only to the designated context document, and write contracts and decision records only to the designated decisions document.
Never create local context files or ADRs as hidden companions for Confluence pages.
Use the [context documentation format](references/context-format.md) and [decision record format](references/adr-format.md), including their Confluence-safe update rules.

## Local File Structure

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

For a local destination, read the applicable context files: the root `CONTEXT.md`, or `CONTEXT-MAP.md` and the relevant subordinate `CONTEXT.md` files.
Read recent and relevant project-wide ADRs from the root `docs/adr/`.
Create context files lazily: create `CONTEXT.md` when the first term resolves, `CONTEXT-MAP.md` when the first multi-context structure resolves, and root `docs/adr/` when the first ADR qualifies.

For a Confluence destination, read the supplied context document and decisions document before modeling.
Treat those two designated pages as the complete durable project-wide documentation; preserve their unrelated content and existing organization.
Do not create context-specific, contract-specific, or decision-specific pages.

## Standalone Session

When invoked standalone, read and follow the [standalone session workflow](references/standalone-session.md).
It selects **build from scratch**, **augment**, or **audit and condense** from `$ARGUMENTS` and the selected context documentation.
Investigate facts from code, documentation, and decision records, and ask the user only for domain decisions.

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

### Update Context Files Inline or Update Confluence Inline

When a term or an intra-context relationship resolves, update the applicable local `CONTEXT.md` or the selected Confluence context document immediately.
When context membership, ownership, a context boundary, or an inter-context relationship resolves, update the local `CONTEXT-MAP.md` or the corresponding Confluence context section immediately.
Do not batch these updates or leave relationships inconsistent with their context definitions.

Context documentation is a glossary and context map, nothing else.
Keep it devoid of implementation details, specifications, and scratch-pad content.
Use its canonical terms consistently in the current conversation and every downstream artifact.

### Offer Decision Records Sparingly

Offer to create a local ADR or a Confluence decision record only when all three conditions are true:

1. **Hard to reverse** — changing the decision later has meaningful cost.
2. **Surprising without context** — a future reader will reasonably ask why this choice was made.
3. **The result of a real trade-off** — genuine alternatives existed and were rejected for specific reasons.

If any condition is missing, do not create a decision record.
For Confluence, use `D-NNN` identifiers and the **Decision details** structure from the decision record format.
