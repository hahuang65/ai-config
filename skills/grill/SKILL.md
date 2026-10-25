---
name: grill
description: Work through an idea collaboratively before implementation, using focused questions, recommendations, and local domain and architecture records.
---

# Grill

Understand what the user wants and investigate the relevant code and documentation.
Find facts yourself; ask the user to settle intent and trade-offs.

Ask a small group of focused questions at a time, with a recommendation and its main reason for each.
Settle foundational choices before questions that depend on them.
Use concrete scenarios to challenge assumptions and expose missing behavior.
Do not keep interviewing once the important choices are clear enough to proceed.
Use a session checklist only when an agreed investigation has several meaningful steps, not for every question.
Prefer available native task-list tools, otherwise a concise list in ordinary chat; the list does not authorize implementation.
Prefer an available structured-question tool for one decision at a time, with brief trade-offs and a free-text alternative.
Use ordinary chat when the tool is absent or unavailable.
Respect cancellation without assuming an answer or reopening the question automatically.

Use [model-domain](../model-domain/SKILL.md) within this conversation, not as a second interview.
Write agreed domain knowledge to local context files and significant architecture decisions to Markdown ADRs as they become clear.
Distinguish current behavior from proposed behavior.

Suggest a mockup, prototype, or specialist review when it would answer a real open question.
Explain the question it would answer; do not make it a prerequisite or silently import the old agent catalog.

Finish with a concise summary of agreements and any open questions.
Use [work-log](../work-log/SKILL.md) for one meaningful-progress entry when the discussion has advanced a task or project, not for every answer.
Discussion does not itself start implementation or a queued task.
Suggest a spec only when a written description would help; never automatically start another workflow.
