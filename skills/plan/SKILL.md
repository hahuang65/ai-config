---
name: plan
description: Turn a clear request, issue, spec, or existing plan into small verifiable tasks with dependencies, acceptance criteria, and test evidence; create HTML only when useful.
---

# Plan

Start from a clear request, issue, spec, or existing plan and the current code and context.
No spec or fixed sequence of design steps is required.
Resolve missing intent before turning an assumption into a task.
Use [model-domain](../model-domain/SKILL.md) when shared terms or durable architecture decisions need clarification.

Choose the smallest useful planning format.
A short ordered list in the conversation can be enough; HTML tasks are optional.
Do not create an artifact just to satisfy a workflow.

For each task, describe:

- Its goal, scope, and observable acceptance criteria.
- Dependencies on other tasks or unresolved decisions.
- The public interface or other observable surface to verify.
- The first useful failing behavior test and expected test evidence, including important failure cases.
- Any human decision, operational permission, or unavailable prerequisite that blocks execution.

Prefer small independently verifiable changes and keep their tests with them.
A task should touch only the layers its behavior needs, not necessarily every layer of the application.
Do not split tests into a later cleanup task or make artificial end-to-end slices for local changes.
Ground file and interface references in the current code; do not promise they will remain unchanged.
Separate observed evidence from planned checks and proposed work from completed work.

When a reviewable document helps, write one semantic `tasks.html` using the project's artifact convention, otherwise `docs/features/<feature-name>/tasks.html`.
Give tasks stable visible identifiers, status, dependencies, acceptance criteria, and test evidence fields.
Link the authoritative intent rather than copying it; do not create a Markdown companion or hidden duplicate task model.
Use [review-artifact](../review-artifact/SKILL.md) for HTML feedback and approval, updating the same file.
Report an unavailable review tool instead of claiming approval.

Summarize task order, unresolved choices, and the chosen planning location.
Plan approval does not authorize implementation, merging, or publication.
The user can request [code](../code/SKILL.md) or [coach](../coach/SKILL.md); do not start either automatically.
Record meaningful planning progress once through [work-log](../work-log/SKILL.md).
