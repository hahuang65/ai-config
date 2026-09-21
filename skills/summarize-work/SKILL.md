---
name: summarize-work
description: Query and summarize the universal Work log as Open work, a chronological timeline, a period summary, or one work item's history. Use for status, standup, completed-work, reminder, and resumption requests.
argument-hint: [open|timeline|summary|history]
---

# Summarize Work

Read the universal, host-local **Work log** through its packaged DuckDB views.
Repository identity is a filter, not an access boundary.

## Workflow

1. Read the [view contract](references/views.md).
2. Select the smallest view that answers the request.
3. Run the corresponding `work-log` command.
4. Present every returned work item once and preserve its canonical state.
5. State the date range or repository filter when one applies.

Do not infer priority or execution order from the display order of **Open work**.
Verify current Git or artifact facts before treating checkpoint evidence as proof that an external state still exists.
