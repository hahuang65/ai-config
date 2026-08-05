---
name: review-artifact
description: Open an existing local HTML artifact in a browser feedback surface, collect element/text annotations and messages, apply feedback with live reload, and receive explicit approval. Use whenever an HTML artifact is shown to request feedback, a decision, or approval.
argument-hint: "[html-file] [--purpose feedback|approval|decision]"
compatibility: Requires Node.js 22+ and a local browser.
---

# Review Artifact

Present an existing HTML file as a durable local review session.
This skill reviews artifacts; it does not generate them.

Read the shared [review artifact protocol](../shared/references/review-artifact.md) before starting.

## Runtime

Resolve `bin/review-artifact.mjs` relative to this `SKILL.md`, then invoke it with Node.js:

```text
node <skill-directory>/bin/review-artifact.mjs <html-file> --purpose <feedback|approval|decision>
node <skill-directory>/bin/review-artifact.mjs poll <html-file> --agent-reply "<brief reply>"
node <skill-directory>/bin/review-artifact.mjs end <html-file>
node <skill-directory>/bin/review-artifact.mjs stop
```

Omitting `--purpose` defaults to `feedback` for backward compatibility.
Do not call `lavish-axi`, `npx`, or any upstream runtime.
The implementation and its attribution ship inside this skill.

## Workflow

1. Confirm the input is an existing HTML artifact that is asking for feedback, a decision, or approval and that its `<title>` follows `<document title> - <document intent>`.
2. Open it with the matching `--purpose`: `feedback` or `approval` starts in Annotate mode; `decision` starts in Explore mode.
3. Immediately run `poll` in the foreground and leave it attached to the active turn.
4. If severe `layout_warnings` arrive, repair the artifact and let live reload re-audit it before asking the user to review.
5. Apply every feedback item to the canonical HTML, then poll again with a concise `--agent-reply`.
6. Repeat until the runtime returns `approved` or `ended`.
7. Treat only `approved` as approval; `ended`, browser close, disconnect, and timeout never clear a gate.

Never use shell backgrounding, `nohup`, `disown`, or an untracked detached terminal for polling.
If polling is interrupted, run it again; queued events remain durable.
Do not reopen a user-approved or user-ended session unless the user requests another review or the artifact materially changed and requires renewed attention.

## Fallback

If the runtime or browser cannot start, report the failure briefly and use the invoking workflow's chat review path.
Preserve the same explicit-approval semantics in chat.
Do not silently skip review.
