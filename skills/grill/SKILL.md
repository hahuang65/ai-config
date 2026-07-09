---
name: grill
description: Interactive grilling session that interviews the user about a feature, sharpens domain terminology, and updates project documentation (CONTEXT.md, ADRs) inline as decisions crystallise. Use when the user wants to stress-test an idea against their project's language and documented decisions before drafting a spec. Based on Matt Pocock's grill-with-docs skill.
argument-hint: [feature-description]
---

# Grill Phase

Interview the user relentlessly about every aspect of the feature idea until you reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, propose your recommended answer.

**Ask the user questions one at a time, waiting for feedback before posing the next.** This applies to the user-facing interview questions — NOT to your own codebase exploration. Reads, searches, and other tool calls used to ground a question (or to avoid a question the code already answers) proceed without per-call confirmation.
Asking multiple questions are once is bewildering and overwhelming.

If a *fact* can be found by exploring the codebase, look it up rather than asking me — do not bother the user with something the code already answers.
The *decisions*, though, are mine — put each one to me and wait for my answer.

## Place in the /build Pipeline

This is **Phase 1** of the `/build` pipeline (see [../shared/references/build-pipeline.md](../shared/references/build-pipeline.md)). The output is not a feature-specific artifact — it is updates to **project-wide** documentation that accrue across many `/build` runs:

- **`CONTEXT.md`** at the repo root — the shared domain glossary
- **`docs/adr/`** at the repo root — Architectural Decision Records

Do not put these inside the feature directory; they outlive any single feature. When invoked standalone, `$ARGUMENTS` is the topic to grill on; when invoked from `/build`, the orchestrator passes the feature description (this phase does not write into the feature directory).

## Context Files

At the start, read existing documentation: `CONTEXT.md` at the repo root (and any subordinate `CONTEXT.md` files via `CONTEXT-MAP.md`), plus recent/relevant ADRs in `docs/adr/`. Create files lazily — only when you have something to write.

- **CONTEXT.md format** → [../shared/references/context-format.md](../shared/references/context-format.md)
- **ADR format** → [../shared/references/adr-format.md](../shared/references/adr-format.md)

## During the Session

Drive the interview with these moves. Update `CONTEXT.md` **inline** as terms resolve — don't batch.

- **Challenge against the glossary.** When the user uses a term that conflicts with `CONTEXT.md`, call it out: "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"
- **Sharpen fuzzy language.** When a word is vague or overloaded, propose a precise canonical term: "You're saying 'account' — do you mean the Customer or the User?"
- **Discuss concrete scenarios.** Stress-test domain relationships with edge-case scenarios that force precision about boundaries between concepts.
- **Cross-reference with code.** When the user states how something works, check whether the code agrees. Surface contradictions: "Your code cancels entire Orders, but you just said partial cancellation is possible — which is right?"

`CONTEXT.md` is a glossary and nothing else — totally devoid of implementation details, specs, or scratch-pad content.

## Offer ADRs sparingly

Only offer to create an ADR when all three are true: **hard to reverse**, **surprising without context**, and **the result of a real trade-off**. If any is missing, skip it. Use the format and qualifying criteria in [../shared/references/adr-format.md](../shared/references/adr-format.md).

## Completion

The grill phase is done when the user is satisfied with the shared understanding — ambiguous terms pinned down, cardinality/lifecycle answered, ADR-worthy decisions recorded. Then tell the user:

> **Grill phase complete.** I've updated:
>
> - `CONTEXT.md` with <n> term(s): <list>
> - `docs/adr/` with <n> new ADR(s): <list>
>   *(or "no new ADRs — none of today's decisions met the hard-to-reverse + surprising + real-trade-off bar")*
>
> When you're ready, just confirm and I'll draft the spec, synthesizing what we discussed via `/specs`.

Do NOT start drafting the spec until the user confirms. Any response that signals approval counts — there's no exact phrase to wait for. The grilling conversation IS the design phase — the spec just transcribes its outcome.

Ultrathink.
