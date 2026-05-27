---
name: handoff
description: Write a handoff document for another agent session, or resume work from the latest handoff when called without arguments. Use when an out-of-scope task surfaces, when a prototype needs its own focused context, when work needs to move between AI coding tools, or when starting a session that should continue prior handed-off work. Based on Matt Pocock's handoff skill.
argument-hint: "What will the next session focus on? (leave empty to resume latest handoff)"
model: sonnet
---

# Handoff

Two modes:

- **Write mode** (argument provided): summarise the current conversation into a handoff document so a fresh agent session can continue the work. Output is **disposable** — a working document, not permanent documentation.
- **Resume mode** (no argument): pick up the most recently written handoff document and start working on what it describes.

## Choosing the Mode

If `$ARGUMENTS` is non-empty, run **Write mode**. If `$ARGUMENTS` is empty, run **Resume mode**.

## When to Use Write Mode

- An out-of-scope task surfaces during the current session and you don't want to derail
- You want to prototype something without bloating the current context
- Work needs to move between different AI coding tools (e.g. from Claude Code to OpenCode)
- You want to keep the current session pure and focused

Unlike `/compact` (which summarizes the entire conversation for a *new* session of the same chat), `/handoff` selectively transfers context so two independent sessions can stay focused on their own concerns.

## Resume Mode

When invoked with no arguments, treat this as "pick up where the previous session left off."

1. **Locate the temp dir** the same way Write mode does: `$TMPDIR`, falling back to `/tmp` (Unix) or `%TEMP%` (Windows).
2. **List handoff documents.** Find files matching `handoff-*.md` in that directory, sorted newest-first by modification time. Cap the list at the 5 most recent.
3. **If no handoff documents exist**, tell the user:

   > No handoff documents found in `<temp dir>`. Run `/handoff <brief>` to create one.

   Then stop. Do not invent work.
4. **If one or more documents exist**, present them to the user as a numbered list:

   ```
   Recent handoff documents in <temp dir>:

   1. handoff-<slug>-<timestamp>.md — <purpose line from doc>
      (modified <relative time>)
   2. ...
   ```

   Pull the purpose from the doc's `# Handoff: <one-line purpose>` heading. Ask which one to pick up.
5. **Once the user picks one**, read it in full, then:
   - Briefly restate the purpose and any suggested skills so the user can confirm the routing.
   - Invoke the first suggested skill (if any) or otherwise begin executing on the purpose directly.
   - Treat pointer paths (PRDs, tasks files, ADRs) as the next things to read once work begins.
6. **Do not delete the handoff file** after picking it up — the user may want to re-read it or hand off again. It's in the temp dir; the OS will clean it up.

## Write Mode

The rest of this document describes Write mode — how to compose the handoff document. Resume mode reads what Write mode produces.

### Where the Handoff Document Lives

Write to the user's OS temporary directory — **not** the current workspace. Handoff docs are disposable; they should not pollute the repo.

Resolve the temp dir from `$TMPDIR`, falling back to `/tmp` on Unix or `%TEMP%` on Windows. Pick a name like `handoff-<short-slug>-<YYYYMMDD-HHMM>.md`.

Tell the user the absolute path so they can pass it to the next session.

### Document Structure

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

### Rules

1. **Reference, don't duplicate.** If a PRD already says X, link to the PRD. The handoff is a routing slip, not a copy.
2. **Tailor to the next session's purpose.** If `$ARGUMENTS` is provided, treat it as the brief for the next session and shape the document accordingly. Skip anything the next session won't need.
3. **Redact sensitive content.** API keys, passwords, tokens, PII — strip them. Even though the doc is in the OS temp dir, anyone with file-system access can read it.
4. **Suggest skills explicitly.** The next agent reads the handoff fresh. Naming the skills (`/grill`, `/prd`, `/tasks`, `/implement`, `/refactor`, `/improve-codebase`, `/prototype`) lets it spin up directly.
5. **Disposable, not durable.** Don't add the temp file to git. If something turns out to be worth keeping, it belongs in the PRD, an ADR, or a commit message — not the handoff.

### After Writing

Tell the user:

> Handoff document at `<absolute-path>`.
>
> Suggested next session: `<one-line summary>`.
> To pick it up in a new session, run `/handoff` (with no arguments) and select it from the list.

Do NOT continue work on the handed-off task in the current session — that defeats the purpose of the split.
