# Model review sheet contract

A **model review sheet** is a temporary semantic HTML checkpoint surface for current model evidence.
Use [review-artifact](../../review-artifact/SKILL.md) for feedback or approval.
It is not a second model source and is retained only when the user requests design history.

## Location and assets

Create the sheet and checkpoint renders in a dedicated temporary directory.
Keep referenced assets inside that directory because browser review confines assets to the HTML directory.
Do not embed a hidden JSON model or copy parameters into executable script.
Use semantic HTML, inline styles, local renders, stable section identifiers, plain language, and responsive reading order.

Use `<product name> - Functional Shape Review`, `<product name> - Feature Review`, or `<product name> - Final Model Review` as the title.

## Required visible content

Present in this order:

1. Product, checkpoint, and current review status.
2. A dominant current render and additional angles needed to inspect interfaces, openings, underside geometry, multipart relationships, or print orientation.
3. Overall dimensions and critical adjustable parameters with units.
4. Provenance for must-fit dimensions, including user measurements and source links or document names.
5. Computed validation with each check, named condition, and actual result.
6. Physical validation still required, clearly separate from computed results.
7. Proposed material, orientation, supports, walls, infill, layer height, and quantity when known.
8. Project files that final delivery will retain.

For functional shape, emphasize envelope, fit, mounting, clearances, feature placement, and orientation.
For a feature checkpoint, emphasize the mechanism, interface, or multipart relationship requiring it.
For the final model, show finishing geometry, every printable part, complete computed evidence, print guidance, and unresolved physical tests.

## Evidence language

Use “passed” only for a check that ran and met a named condition.
Use “not checked” when tooling or evidence is absent.
Use “requires test print” for fit, strength, assembly feel, creep, environmental durability, and other physical claims.
Mark status blocked for known generation, export, render, or mesh-integrity failures, including timeouts.
A blocked sheet is for feedback and repair, not ordinary final-model approval.
Missing optional evidence can remain “not checked” only when it does not prevent validation of the intended output.
Report gaps honestly; do not replace evidence with confidence scores or fabricated CAD or printer results.

Make warnings visible in text and structure, not color alone.
Give every render useful alternative text or a caption identifying viewpoint and review purpose.
Align keyboard and visual reading order and maintain readable contrast in light and dark themes.

## Review loop

Before presenting, inspect every render and repair visible geometry or framing defects.
Use the local review skill's approval workflow and foreground polling.
Apply feedback to the model, regenerate affected exports and renders, and update the same HTML so the browser shows current evidence.
Continue until explicit approval of that version; a material change needs renewed review.

If browser review is unavailable, report the fallback, show the same evidence through image and chat tools, and require explicit chat approval.
A closed browser, ended review, disconnect, or timeout is not approval.

After approval, retain the final render in the product directory and remove only temporary sheet files and checkpoint renders created by this workflow, unless the user requests history.
Never delete pre-existing files during cleanup.
