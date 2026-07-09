---
name: handoff
description: Write a handoff document for another agent session — summarise the current work so a fresh session (or a different AI tool) can continue it. Output is disposable, written to the OS temp dir. To resume a handoff, use /pickup. Based on Matt Pocock's handoff skill.
argument-hint: "What will the next session focus on?"
---

# Handoff

Summarise the current conversation into a handoff document so a fresh agent session can continue the work. The output is **disposable** — a working routing slip, not permanent documentation.

This is the **write** side of the handoff split. To **resume** a handoff in a new session, use **`/pickup`** (it reads what this skill produces).

## When to Use

- An out-of-scope task surfaces during the current session and you don't want to derail
- You want to prototype something without bloating the current context
- Work needs to move between different AI coding tools (e.g. from Claude Code to oh-my-pi)
- You want to keep the current session pure and focused

Unlike `/compact` (which summarizes the entire conversation for a *new* session of the same chat), `/handoff` selectively transfers context so two independent sessions can stay focused on their own concerns.

## Where the Handoff Document Lives

Write to **`/tmp/`** — a literal, OS-temp location that exists on Linux and macOS. Do not use `$TMPDIR` or any shell variable; a command containing shell expansion (`$VAR`, `${VAR}`, `$(...)`, backticks) can trip a harness's safety gate and force a permission prompt even when the surrounding pattern is allowlisted. Hardcoding `/tmp/` keeps `/pickup`'s listing command simple and prompt-free on any harness.

Pick a name like `handoff-<short-slug>-<YYYYMMDD-HHMM>.md` — so the full path is e.g. `/tmp/handoff-curl-jq-perms-20260527-1335.md`.

Handoff docs are disposable; they should not pollute the repo. The OS cleans `/tmp/` on its own schedule.

Tell the user the absolute path so they can pass it to the next session.

## Document Structure

See [references/handoff-template.md](references/handoff-template.md) for the document structure.

## Rules

1. **Reference, don't duplicate.** If a spec already says X, link to the spec. The handoff is a routing slip, not a copy.
2. **Tailor to the next session's purpose.** If `$ARGUMENTS` is provided, treat it as the brief for the next session and shape the document accordingly. Skip anything the next session won't need.
3. **Redact sensitive content.** API keys, passwords, tokens, PII — strip them. Even though the doc is in the OS temp dir, anyone with file-system access can read it.
4. **Suggest skills explicitly.** The next agent reads the handoff fresh. Naming the skills (`/grill`, `/specs`, `/tasks`, `/implement`, `/refactor`, `/improve-codebase`, `/prototype`) lets it spin up directly.
5. **Disposable, not durable.** Don't add the temp file to git. If something turns out to be worth keeping, it belongs in the spec, an ADR, or a commit message — not the handoff.

## After Writing

Tell the user:

> Handoff document at `<absolute-path>`.
>
> Suggested next session: `<one-line summary>`.
> To pick it up in a new session, run `/pickup` — with no argument it resumes this one (the most recent), or pass a slug/topic to target a specific handoff.

Do NOT continue work on the handed-off task in the current session — that defeats the purpose of the split.
