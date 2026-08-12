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
When you give an interim recap, read and follow the [session recap protocol](references/session-recaps.md) before you ask the next question or pause the session.
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

Apply its full active-modeling and decision-record workflow to every domain decision that the interview exposes.
Resolve and reuse its main-directory or linked-worktree documentation destination before the first round.

## Place in the /build Pipeline

This is **Phase 1** of the `/build` pipeline.
See [the shared build pipeline](../shared/references/build-pipeline.md).
The output is not a feature-specific artifact.
It is project-wide domain documentation that accrues across many `/build` runs:

- A local destination uses the applicable **`CONTEXT.md`** files and root **`docs/adr/`** directory.
- A Confluence destination uses the linked worktree's saved context document and decisions document.

Do not put local domain documentation inside the feature directory or duplicate Confluence documentation there because it outlives any single feature.
When invoked standalone, `$ARGUMENTS` is the topic to grill on.
When invoked from `/build`, the orchestrator passes the feature description and this phase does not create the feature directory.

## Completion

The grill phase is done when the frontier is empty and the user is satisfied with the shared understanding.
Every branch has been visited, nothing is silently assumed, ambiguous terms are pinned down, cardinality and lifecycle are answered, and qualifying decisions are recorded.
Then report the selected destination and updated context documentation and decision records.

Inside `/build`, return control to the orchestrator so it can determine mockup relevance and complete the Design→Spec gate through the applicable branch.
Do not ask for separate post-grill confirmation in a build that requires mockup approval.

When invoked standalone, tell the user:

> **Grill phase complete.** I used <local files / Confluence for this worktree> and updated:
>
> - <context file or context document link> with <n> term(s): <list>
> - <`docs/adr/` or decisions document link> with <n> new decision record(s): <list>
>   *(or "no new decision records — none of today's decisions met the hard-to-reverse + surprising + real-trade-off bar")*
>
> When you're ready, just confirm and I'll draft the spec, synthesizing what we discussed via `/spec`.

Do not start drafting the standalone spec until the user confirms.
The grilling conversation resolves product and domain decisions, and the Spec transcribes its outcome plus approved UI intent when present.
