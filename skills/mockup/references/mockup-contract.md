# UI Mockup Contract

Write one canonical `mockups.html` file in the Feature directory.
Do not create a Markdown companion, hidden data model, or production component source.
The visible semantic HTML is both the review surface and the durable design input to later pipeline skills.

## Ground the design

Read the applicable context files, relevant ADRs, approved grilling decisions, and the existing interface area.
Use the project's component library, design tokens, typography, spacing, navigation, content density, and interaction conventions where they exist.
Use realistic content rather than placeholder text so hierarchy and density can be judged.

## Document contract

- Use `<feature title> - UI Mockup` in `<title>` and use “UI Mockup” in `<h1>`.
- Put `data-artifact-kind="mockup"` and `data-artifact-version="1"` on the main content element.
- Use stable section identifiers so annotations remain understandable after live reload.
- Keep styling and interaction scripts self-contained.
- Use semantic HTML and native controls.
- Treat all form values and other reviewer input as untrusted, and never interpolate them into executable code or markup.

## Design count

Present one recommended interactive design by default.
Add two or three alternatives only when grilling leaves an unresolved design fork that requires visual judgment.
Alternatives must be structurally different in layout, information hierarchy, or primary action rather than minor changes to color or copy.

## Decision and approval order

1. Before any approval review, visibly select one recommended design and state its rationale.
2. If alternatives remain unresolved, use a `review-artifact` feedback or decision interaction to settle the selection before requesting approval.
3. After the selection settles, update the same `mockups.html` with a visible decision record that names the selected design, its rationale, and every rejected alternative; show “None” when no alternative was rejected.
4. Only after that decision record is complete, start or resume the approval review.

Explicit approval remains the Design→Spec signal.
An approval event cannot settle an unresolved design fork.

## Required visible content

- Name the affected surfaces and state what user goal each supports.
- Show realistic content and the important states needed to judge the feature, including loading, empty, error, success, disabled, or permission states when relevant.
- Demonstrate responsive intent at representative narrow and wide widths without shrinking whole screens into unreadable thumbnails.
- Demonstrate accessibility behavior, including semantic structure, keyboard order, visible focus, control names, status announcements, and contrast where relevant.
- Label the design properties that are Authoritative intent and those that remain directional.
- Include a visible decision record with the selected design, its rationale, and rejected alternatives after the decision settles.

The authoritative properties are information hierarchy, interaction behavior, important states, responsive intent, and accessibility behavior.
Exact dimensions and decorative styling remain directional unless the artifact explicitly marks them as required.
