---
name: handoff
description: Compact the current conversation into a handoff document for another agent session to pick up. Use when an out-of-scope task surfaces, when a prototype needs its own focused context, or when work needs to move between AI coding tools. Based on Matt Pocock's handoff skill.
argument-hint: "What will the next session focus on?"
model: sonnet
---

# Handoff

Write a handoff document summarising the current conversation so a fresh agent session can continue the work. The output is **disposable** — a working document, not permanent documentation.

## When to Use

- An out-of-scope task surfaces during the current session and you don't want to derail
- You want to prototype something without bloating the current context
- Work needs to move between different AI coding tools (e.g. from Claude Code to OpenCode)
- You want to keep the current session pure and focused

Unlike `/compact` (which summarizes the entire conversation for a *new* session of the same chat), `/handoff` selectively transfers context so two independent sessions can stay focused on their own concerns.

## Where the Handoff Document Lives

Write to the user's OS temporary directory — **not** the current workspace. Handoff docs are disposable; they should not pollute the repo.

Resolve the temp dir from `$TMPDIR`, falling back to `/tmp` on Unix or `%TEMP%` on Windows. Pick a name like `handoff-<short-slug>-<YYYYMMDD-HHMM>.md`.

Tell the user the absolute path so they can pass it to the next session.

## Document Structure

```markdown
# Handoff: <one-line purpose>

## Purpose of the next session

<2-3 sentences. Crisp. What is the next session being spun up to do?>

## Relevant context from this session

<Bullets or short paragraphs. Only what the next session needs to know.
Do NOT duplicate content from PRDs, plans, ADRs, issues, commits, or diffs
— reference them by path or URL instead.>

## Suggested skills

<Skills the next session should invoke, in the order they make sense.
Example:
- /grill — to refine domain terminology around X before drafting
- /prd — once the design is settled
- /implement — once tasks are approved>

## Pointers (not duplicated content)

- PRD: docs/claude/<slug>/prd.md
- Tasks: docs/claude/<slug>/tasks.md
- ADRs touched: docs/adr/0007-...
- Recent diff: git log -p <sha>..<sha>
- External references: <URLs>
```

## Rules

1. **Reference, don't duplicate.** If a PRD already says X, link to the PRD. The handoff is a routing slip, not a copy.
2. **Tailor to the next session's purpose.** If `$ARGUMENTS` is provided, treat it as the brief for the next session and shape the document accordingly. Skip anything the next session won't need.
3. **Redact sensitive content.** API keys, passwords, tokens, PII — strip them. Even though the doc is in the OS temp dir, anyone with file-system access can read it.
4. **Suggest skills explicitly.** The next agent reads the handoff fresh. Naming the skills (`/grill`, `/prd`, `/tasks`, `/implement`, `/refactor`, `/improve-codebase`, `/prototype`) lets it spin up directly.
5. **Disposable, not durable.** Don't add the temp file to git. If something turns out to be worth keeping, it belongs in the PRD, an ADR, or a commit message — not the handoff.

## After Writing

Tell the user:

> Handoff document at `<absolute-path>`.
>
> Suggested next session: `<one-line summary>`.
> To pick it up in a new session, point that session at the file.

Do NOT continue work on the handed-off task in the current session — that defeats the purpose of the split.
