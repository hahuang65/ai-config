---
name: mockup
description: Create and review a self-contained HTML mockup for a browser or terminal interface when layout, interaction, or visual states need a concrete design.
---

# Mockup

Start from the user's design question, relevant context, and the existing interface.
No spec or implementation workflow is required.
Clarify only uncertainty that would change the design.
For a visual-only question, use a mockup; use [prototype](../prototype/SKILL.md) when runnable host behavior is the question.
Neither is a prerequisite for the other.

1. Inspect nearby screens, terminology, constraints, and existing components.
   Identify the users, actions, important states, responsive behavior, and accessibility needs.
2. Write one self-contained HTML file with inline styles and representative synthetic content.
   Follow the project's artifact location convention; otherwise use `docs/features/<feature-name>/mockup.html`.
   Use semantic structure, readable contrast, keyboard-accessible controls, and stable section identifiers.
   Show relevant loading, empty, error, disabled, and success states, not only the happy path.
   Show terminal layouts as clearly labeled simulations, not functioning terminals.
3. Keep assets local or embedded; do not fetch external resources or connect to production services.
   Escape any source text included as HTML.
   Use only minimal local interaction needed to explain the design, and label simulated behavior.
   Do not maintain a hidden duplicate model or a second canonical mockup.
4. State the recommended design and its known trade-offs.
   Show alternatives only when they help settle a real decision; never invent approval or rationale.
5. Use [review-artifact](../review-artifact/SKILL.md) for feedback and explicit approval.
   Apply feedback to the same HTML file.
   A material revision needs review again; closing the browser is not approval.
   If the review tool is unavailable, report the limit and ask how to proceed without claiming browser approval.

Use [model-domain](../model-domain/SKILL.md) when the design exposes an unresolved domain term or agreed durable decision.
Report the artifact path, review outcome, and unresolved questions.
Record meaningful progress once through [worklog](../worklog/SKILL.md).
Approval accepts this design; it does not authorize implementation or start another skill.
