---
name: grill
description: Interactive grilling session that interviews the user about a feature in dependency-aware rounds and invokes model-domain to sharpen the ubiquitous language and record durable decisions. Use when the user wants to stress-test an idea before drafting a spec. Based on Matt Pocock's grilling and grill-with-docs skills.
argument-hint: [feature-description]
---

# Grill Phase

Interview the user relentlessly about every aspect of the feature idea until you reach a shared understanding.
Map the interview as a **design tree**: every decision branches into the decisions that depend on it.

## Work in Rounds

The **frontier** is every decision whose prerequisites are settled: the questions that can be answered now without guessing at an unresolved answer.
Ask the whole frontier in one round, then wait for the user's answers before asking another round.
Number each question and give your recommended answer using this format:

```text
❓ **Q1** - **<question title>**: <question body, which may include multiple paragraphs or choices>

➡️ <your recommended answer>
```

Each round reshapes the design tree.
After the user answers, update resolved terms and decisions inline, recompute the frontier, and ask the next round.
If one question depends on another question that remains open in the same round, defer the dependent question to a later round.
Batch only independent questions; never bundle a chain of dependent decisions into one round.

Finding *facts* is your job, never the user's.
When a frontier question needs a fact from the codebase or environment, investigate it with tools or dispatch independent exploration to a subagent rather than asking the user.
Do not block the rest of the frontier on that exploration.
Treat the unknown fact as an unsettled prerequisite, defer only its downstream questions, and ask the other ready questions now.
The *decisions* are the user's: put each one to them and wait for their answers.

## Invoke Model Domain

At the start, load and follow [model-domain](../model-domain/SKILL.md) throughout the interview.
Grill owns the dependency-aware interview; `model-domain` owns active domain modeling and its documentation discipline.

The **ubiquitous language** is the shared, canonical vocabulary used by domain experts, users, documentation, tests, and code.
`CONTEXT.md` records it, and consistent use gives the design one stable meaning from conversation through implementation.
Apply its full active-modeling and ADR workflow to every domain decision that the interview exposes.

## Place in the /build Pipeline

This is **Phase 1** of the `/build` pipeline.
See [the shared build pipeline](../shared/references/build-pipeline.md).
The output is not a feature-specific artifact.
It is project-wide domain documentation that accrues across many `/build` runs:

- The applicable **`CONTEXT.md`** files record the ubiquitous language.
- The root **`docs/adr/`** directory records qualifying project-wide Architectural Decision Records.

Do not put these inside the feature directory because they outlive any single feature.
When invoked standalone, `$ARGUMENTS` is the topic to grill on.
When invoked from `/build`, the orchestrator passes the feature description and this phase does not create the feature directory.

## Completion

The grill phase is done when the frontier is empty and the user is satisfied with the shared understanding.
Every branch has been visited, nothing is silently assumed, ambiguous terms are pinned down, cardinality and lifecycle are answered, and ADR-worthy decisions are recorded.
Then tell the user:

> **Grill phase complete.** I've updated:
>
> - `CONTEXT.md` with <n> term(s): <list>
> - `docs/adr/` with <n> new ADR(s): <list>
>   *(or "no new ADRs — none of today's decisions met the hard-to-reverse + surprising + real-trade-off bar")*
>
> When you're ready, just confirm and I'll draft the spec, synthesizing what we discussed via `/spec`.

Do not start drafting the spec until the user confirms.
Any response that signals approval counts; there is no exact phrase to wait for.
The grilling conversation is the design phase, and the spec transcribes its outcome.

Ultrathink.
