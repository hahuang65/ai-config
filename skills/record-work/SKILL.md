---
name: record-work
description: Create and transition Work log items or record meaningful checkpoints. Use when the user asks to add work to a task queue, task log, workload, or reminder list; when work starts, pauses, completes, or is abandoned; and when a workflow reaches a meaningful checkpoint.
argument-hint: [work-or-transition]
---

# Record Work

Write one semantic checkpoint to the universal, host-local **Work log** through the `work-log` agent-facing CLI.
The Work log is authoritative for work state across every configured harness and repository.

## Repository boundary

Before meaningful work, verify that the current directory belongs to a Git repository.
When it does not, ask the user to enter, select, or create the relevant repository, or explicitly continue without Work log capture.
Repository identity associates and filters work; it does not restrict access to the universal log.

## Workflow

1. Read the [shared Work log protocol](../shared/references/work-log.md).
2. Query `work-log open --json` and associate the request with one strong existing match when available.
3. Ask when several work items could match; never merge them silently.
4. Send one validated checkpoint request to `work-log record` using the [checkpoint schema](references/checkpoint-schema.md):

   ```bash
   work-log record <<'JSON'
   {"action":"plan","title":"Improve the installer","summary":"Retain this work for a later session."}
   JSON
   ```

5. Confirm an explicit capture request with the work-item identifier.
Keep successful automatic workflow checkpoints quiet.

Use `work-log correct <checkpoint-id>` for an ordinary factual correction.
Use `work-log purge <checkpoint-id> --confirm-sensitive-purge` only after the user explicitly authorizes physical removal of sensitive content.
Completed and abandoned work items are terminal; create a linked follow-up item for later work.
