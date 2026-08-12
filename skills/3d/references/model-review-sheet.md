# Model Review Sheet Contract

A **model review sheet** is a temporary semantic HTML checkpoint surface.
It presents current model evidence for feedback or approval through `review-artifact`.
It is not a second model source and is not retained in the **3D print project** unless the user asks for design history.

## Location and assets

Create the sheet and checkpoint renders in a dedicated temporary directory.
Keep every referenced image, stylesheet, or script inside that directory because the browser review interface confines assets to the HTML file's directory.
Do not embed a hidden JSON model or copy model parameters into executable script.

Use `<product name> - Functional Shape Review`, `<product name> - Feature Review`, or `<product name> - Final Model Review` as the document title.
Use ordinary semantic HTML, stable section identifiers, plain language, and a responsive reading order.

## Required visible content

Place the information in this order:

1. Product name, checkpoint name, and current review status.
2. A dominant current render plus every additional angle needed to inspect interfaces, openings, underside geometry, multipart relationships, or print orientation.
3. Overall dimensions and critical adjustable parameters with units.
4. Provenance for must-fit dimensions, including user measurements and source links or document names.
5. Computed validation, listing each check and its actual result.
6. Physical validation still required, clearly separate from computed results.
7. Proposed material, orientation, supports, walls, infill, layer height, and quantity when known.
8. Project files that final delivery will retain.

For a functional-shape review, emphasize envelope, fit, mounting, clearances, feature placement, and orientation.
For a feature review, emphasize the specific mechanism, interface, or multipart relationship that made the extra checkpoint necessary.
For a final-model review, show finishing geometry, every printable part, complete computed evidence, print guidance, and unresolved physical tests.

## Evidence language

Use “passed” only for a check that ran and met a named condition.
Use “not checked” when tooling is absent or evidence was not collected.
Use “requires test print” for fit, strength, assembly feel, creep, environmental durability, and other physical claims.
Mark the current review status as blocked when generation, export, render, or mesh-integrity has a known failure.
A blocked sheet is for feedback and repair, not ordinary final-model approval.
Missing optional evidence may remain “not checked” when it does not prevent validation of the intended output; report the gap honestly without marking it as passed.
Do not use a confidence score as a replacement for evidence.

Make warnings visible through text and structure, not color alone.
Every render needs useful alternative text or a nearby caption that identifies its viewpoint and review purpose.
Keep keyboard reading order aligned with the visual order and maintain readable contrast in light and dark themes.

## Review loop

Before presenting the sheet, inspect every render and repair visible geometry or framing defects you can identify.
Then load `review-artifact`, open the sheet with an approval purpose, and poll in the foreground.
Apply each feedback batch to the model, regenerate affected exports and renders, and update the same HTML so the browser live-reloads current evidence.
Continue until explicit approval.

When the browser workflow is unavailable, report the fallback, show the same evidence through available image and chat tools, and require explicit chat approval.
A closed browser, ended review, disconnect, or timeout is not approval.

After approval, retain the final render in the product directory and remove only temporary sheet files and checkpoint renders created by the current workflow.
Never delete pre-existing files during cleanup.
