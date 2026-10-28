# 3D design workflow

A **3D print project** is one product directory containing adjustable source, printable exports, a final render, render configuration, and a product README.

## 1. Understand the part

Inspect the current repository, context documentation, nearby model directories, root catalog, rendering tools, and project instructions before proposing files.
For an existing product, read its source and README before asking questions.

Gather requirements conversationally:

1. Establish purpose, mating objects, and how success will be judged.
2. Resolve every must-fit dimension, including tolerance and source.
3. Ask only questions that can change geometry, material, or delivery: mounting, printer, material, load, access, and appearance.

Do not dump a generic questionnaire.
Use visible assumptions only when the answer cannot materially change the model.
Read [FDM design guidance](fdm-design.md) for measurement and print decisions.
Use [model-domain](../../model-domain/SKILL.md) for agreed domain terms and durable architecture decisions in local context documents.
Do not replace the product README with a domain document.

## 2. Resolve the project and CAD engine

Derive the product name from the user's language.
Follow repository conventions for the directory, source basename, multipart suffixes, exports, final render, render configuration, and README.
Without a convention, use a title-cased product directory under the current directory and a descriptive snake-case source basename.

Reuse a directory only when the request clearly continues that product.
Ask when reuse is ambiguous; never overwrite unrelated work.
For new work, default to CadQuery and document every meaningful dimension in millimetres as a named parameter.
For an existing OpenSCAD project, continue with OpenSCAD.
Do not convert existing work or silently switch engines after failure.

## 3. Verify the environment

Identify documented model, export, render, and validation commands before creating geometry.
Run every generation, export, render, and validation command with an explicit bounded timeout appropriate to the workload and repository conventions.
Never allow these commands to wait without a deadline.
Use the mise-managed toolchain and invoke tools directly; do not activate another version manager.

If a required CAD engine, exporter, renderer, or mesh validator is unavailable:

1. Report the missing capability and the planned evidence it blocks.
2. Propose a setup command compatible with the repository and toolchain.
3. Wait for approval before installing dependencies.

Do not silently install tools, switch engines, skip renders, or describe an unrendered model as validated.

## 4. Build in reviewed checkpoints

Use two checkpoints for an ordinary part:

1. **Functional shape**: envelope, interfaces, attachment, feature placement, fit clearances, and print orientation.
2. **Final model**: finishing geometry, complete exports, computed validation, print plan, and remaining physical tests.

A simple, low-risk part can combine checkpoints when an early review adds no useful decision.
A complex, enclosed, multipart, or tight-tolerance part can add a feature checkpoint.
Record the reason for combining or adding checkpoints in the review sheet.
Never remove review merely to save time.

At each checkpoint:

1. Generate current source and exports.
2. Run the smallest relevant computed checks from [FDM guidance](fdm-design.md).
3. Produce useful render angles and inspect them before presenting them.
4. Create or update a temporary [model review sheet](model-review-sheet.md).
5. Use [review-artifact](../../review-artifact/SKILL.md) for feedback or approval.
6. Apply feedback to the source, regenerate evidence, and update the same sheet.
7. Continue only after explicit approval of the current evidence.

A known generation, export, render, or mesh-integrity failure blocks the checkpoint.
A timeout is an output failure: identify the affected output and block its checkpoint until the command succeeds and evidence is regenerated.
Do not request ordinary final-model approval or deliver while a checkpoint is blocked.
Repair the cause, regenerate every affected output and its evidence, and rerun the relevant checks before clearing the block.

If browser review cannot start, report that limit and conduct the same evidence review in chat with explicit approval.
Closing, ending, disconnecting, or timing out is not approval.
Record approved design checkpoints through [worklog](../../worklog/SKILL.md), without duplicate entries.

## 5. Deliver the project

Every delivery includes parameterized source, STL exports for every printable part, optional STEP exports when supported and useful for editing, a final render and its render configuration, and a product README.
Follow local filenames; without a convention use `render.png`, `render.conf`, and `README.md`.

The product README is mandatory.
Follow the nearest comparable README's headings, link and image style, and terminology.
Include applicable sections:

- Product summary and final render.
- Source and export links.
- Critical dimensions and provenance.
- Material and concise slicer settings.
- Print orientation, supports, and quantity.
- Bill of materials or hardware.
- Assembly and mounting instructions.
- Adjustable parameters and design rationale.
- Computed validation and remaining physical-validation limits.
- Repository license reference.

If the repository has a root product catalog, update its entry with the render, summary, project link, source, exports, and README.
Preserve unrelated content and local style.
Do not create a catalog unless requested.

Keep the final render and documentation in the product directory.
Remove temporary review sheets and intermediate checkpoint renders created by this workflow unless the user requests design history.
Never delete pre-existing or user-authored files as cleanup.
At delivery, list every output, summarize computed evidence, name every unresolved physical test, and offer adjustments to key parameters.
Record final completion through [worklog](../../worklog/SKILL.md) only when delivery requirements are met; describe remaining physical tests honestly.
Never claim software checks prove physical fit or strength.
Do not commit or publish without an explicit request.
