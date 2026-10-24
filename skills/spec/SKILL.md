---
name: spec
description: Write a concise HTML specification grounded in the discussion and code, then review its behavior, scope, and testing approach in the browser.
---

# Spec

Use a spec when a written description will help; small changes do not require one.
Read the relevant local context files, ADRs, and code.
Suggest grilling, a mockup, or specialist consultation when it would resolve important uncertainty, but do not require these for every spec.
Ask targeted questions when essential intent is missing.
Use an available structured-question tool for requirements choices, with trade-offs, a recommendation, and a free-text alternative.
Use ordinary chat when the tool is absent or unavailable.
These answers are clarification, not whole-document approval.
Use [model-domain](../model-domain/SKILL.md) if the discussion exposes a domain ambiguity or significant architecture choice.

Write one semantic HTML file using the project's artifact convention, otherwise `docs/features/<feature-name>/spec.html`.
The HTML is the spec; do not maintain a Markdown companion or hidden duplicate model.
Use plain language and a readable layout with clear headings and stable section identifiers.
Include only what helps the reader:

- The problem, goal, and expected behavior.
- Important examples and acceptance criteria.
- Scope exclusions and remaining questions.
- Module boundaries and interfaces where they matter.
- How public behavior and failure cases will be tested.
- References to relevant context and ADRs instead of copying them.

Keep examples and file paths when they clarify the design.
Do not bury uncertainty or make unsupported promises.
Use [review-artifact](../review-artifact/SKILL.md) for element feedback, general comments, and explicit whole-document approval.
Apply feedback to the same file so the open view stays current.
If the review tool is unavailable, report that limit and do not claim a browser review or approval occurred.

Approval covers the reviewed spec, not automatic implementation, task creation, or delivery.
After review, summarize its outcome and use [work-log](../work-log/SKILL.md) for meaningful progress without marking implementation complete.
