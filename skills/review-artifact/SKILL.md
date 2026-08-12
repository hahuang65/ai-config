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
node <skill-directory>/bin/review-artifact.mjs <html-file> --purpose <feedback|approval|decision> --reopen
node <skill-directory>/bin/review-artifact.mjs poll <html-file> --agent-reply "<brief reply>"
node <skill-directory>/bin/review-artifact.mjs end <html-file>
node <skill-directory>/bin/review-artifact.mjs stop
node <skill-directory>/bin/review-artifact.mjs --help
```

Omitting `--purpose` defaults to `feedback` for backward compatibility.
Do not call `lavish-axi`, `npx`, or any upstream runtime.
The implementation and its attribution ship inside this skill.

## Workflow

1. Open the existing artifact with the matching `--purpose`.
2. Immediately run `poll` in the foreground and leave it attached to the active turn.
3. If severe `layout_warnings` arrive, repair the artifact and let live reload re-audit it before asking the user to review.
4. Apply every feedback item to the canonical HTML, then poll again with a concise `--agent-reply`.
5. Repeat until the runtime returns `approved` or `ended`.
6. When a decision submission ends the session for requested changes, update the materially changed artifact and open its next decision round with `--reopen`.

Never use shell backgrounding, `nohup`, `disown`, or an untracked detached terminal for polling.
If polling is interrupted, run it again; queued events remain durable.
Do not reopen a user-approved or user-ended session unless the user requests another review or the artifact materially changed and requires renewed attention.
