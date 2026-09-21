# Work log checkpoint schema

`work-log record` reads one JSON object from standard input.
The CLI generates the checkpoint identifier, timestamp, repository identity, branch, harness, and session identifier.

## Actions

- `plan` creates a planned work item.
- `start` creates an active work item or transitions an existing item to active.
- `pause` transitions an existing item to paused.
- `checkpoint` records meaningful progress without changing state.
- `complete` records successful terminal completion.
- `abandon` records terminal abandonment.

`plan` and `start` can omit `work_item_id` to create a work item.
Every other action requires an existing `work_item_id`.
For an existing item, `start` follows planned or paused, `pause` follows active, `complete` follows active or paused, and `checkpoint` or `abandon` follows any open state.
Completed and abandoned items reject every later checkpoint; create a linked follow-up instead.

## Input fields

- `action` is required.
- `title` is required when creating a work item and omitted for later checkpoints unless it needs correction.
- `summary` is required and states the durable outcome in concise plain text.
- `work_item_id`, `parent_work_item_id`, and `follows_work_item_id` are optional stable relationships where applicable.
- `decisions`, `blockers`, `files`, `commits`, and `tickets` are optional arrays of strings.
- `next_action` is optional concise text.
- `due_at` is an optional ISO 8601 timestamp and does not schedule a notification.

Example:

```json
{
  "action": "plan",
  "title": "Package the Work log query views",
  "summary": "Retain the missing DuckDB packaging work for a later session.",
  "tickets": [],
  "due_at": null
}
```

## Content boundary

Record synthesized facts only.
Never include raw prompts, transcripts, command output, diffs, secrets, credentials, personal data, customer data, or artifact URLs.
File activity is evidence for a checkpoint, not a work item by itself.
