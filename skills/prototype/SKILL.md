---
name: prototype
description: Build throwaway runnable code to answer a logic, state, integration, real-data-density, or host-application question. Use when the user asks to prototype, sanity-check a model, test an interface in its real app, or says "prototype this" or "let me play with it"; visual-only design belongs to mockup.
argument-hint: [what to prototype]
---

# Prototype

A prototype is **throwaway code that answers a question**. The question decides the shape.

## Order Mockup from the Prototype Question

- **First** — Run `mockup` first when end-user interface design is the prototype subject or visual design is an imperative prerequisite.
- **Last** — When UI only presents logic, data exploration, manual processing, or state behavior, answer the primary question first and leave optional `mockup` work until last.
- **Skip** — When the prototype has no UI design question, skip `mockup`.

A runnable UI prototype stays grounded in the host application when integration, real data density, or state behavior cannot be judged in a standalone mockup.
It may consume the selected design, but mockup code and prototype shells remain non-production and are never silently promoted.
Validated portable logic can be absorbed only under production constraints and tests.

## Pick a Branch

Identify which question is being answered — from the user's prompt, the surrounding code, or by asking if the user is around:

- **"Does this logic / state model feel right?"** → [logic.md](references/logic.md). Build a tiny interactive terminal app that pushes the state machine through cases that are hard to reason about on paper.
- **"Does this UI work with the host application, real data density, or actual state behavior?"** → [ui.md](references/ui.md). Build a runnable throwaway UI in its real application context.
- **"What should this look like?"** when standalone HTML can answer it → use `mockup`, not a prototype.

The two prototype branches produce very different artifacts.
If the question is genuinely ambiguous and the user is not reachable, default to whichever branch better matches the surrounding code and state the assumption at the top of the prototype.

## Rules That Apply to Both

1. **Throwaway from day one, and clearly marked as such.** Locate the prototype code close to where it will actually be used (next to the module or page it's prototyping for) so context is obvious — but name it so a casual reader can see it's a prototype, not production. For throwaway UI routes, obey whatever routing convention the project already uses; don't invent a new top-level structure.
2. **One command to run.** Whatever the project's existing task runner supports — `pnpm <name>`, `python <path>`, `bun <path>`, etc. The user must be able to start it without thinking.
3. **No persistence by default.** State lives in memory. Persistence is the thing the prototype is _checking_, not something it should depend on. If the question explicitly involves a database, hit a scratch DB or a local file with a clear "PROTOTYPE — wipe me" name.
4. **Skip the polish.** No tests, no error handling beyond what makes the prototype _runnable_, no abstractions. The point is to learn something fast and then delete it.
5. **Surface the state.** After every action, and after every variant switch when variants exist, print or render the full relevant state so the user can see what changed.
6. **Delete or absorb when done.** Delete the prototype shell; either discard its answer or rewrite validated portable logic under production constraints and tests. Do not leave prototype scaffolding rotting in the repo.

## Place in the Pipeline

Prototyping happens **outside** the main `/build` pipeline when a question cannot be resolved through conversation or a standalone mockup.
The user invokes `/prototype` to run the focused experiment, captures the answer, then returns to the owning workflow with what was learned.

Pair with `/handoff` when the prototype needs its own focused session: hand off the prototyping question to a fresh session, build the prototype there, then capture the answer back into the parent session.

## When Done

The _answer_ is the only thing worth keeping from a prototype. Capture it somewhere durable (commit message, ADR, issue, or a `NOTES.md` next to the prototype) along with the question it was answering. If the user is around, that capture is a quick conversation; if not, leave the placeholder so they (or you, on the next pass) can fill in the verdict before deleting the prototype.

If the answer changes the project's ubiquitous language or crystallises a durable decision, load and follow [model-domain](../model-domain/SKILL.md).
Use it to update the applicable context files or offer an ADR under its qualification bar; do not write either directly from the prototype workflow.
