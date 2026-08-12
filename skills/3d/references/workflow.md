# 3D Design Workflow

Use this workflow for a new or continuing **3D print project**: one product directory containing adjustable source, printable exports, a final render, render configuration, and a product README.

## 1. Understand the part

Inspect the current repository, its context documentation, nearby model directories, root catalog, rendering tools, and project instructions before proposing files.
When the request identifies an existing project, read its source and README before asking questions.

Gather requirements conversationally in this order:

1. Establish the part's purpose, what it interfaces with, and how success will be judged.
2. Resolve every must-fit dimension, including its tolerance and source.
3. Ask only questions that can change geometry, material, or delivery: relevant mounting, printer, material, load, access, and appearance questions.

Do not dump a generic questionnaire.
Use reasonable, visible assumptions only when an answer cannot materially change the model.
Load [FDM design guidance](fdm-design.md) for measurement and print decisions.

## 2. Resolve the project and CAD engine

Derive the product name from the user's language.
Follow established repository conventions for the product directory, source basename, multipart suffixes, printable exports, final render, render configuration, and README.
When no convention exists, use a title-cased product directory directly under the current directory and a descriptive snake-case source basename.

Reuse an existing directory only when the request clearly continues that product.
When reuse is ambiguous, stop and ask whether to update it or choose another product name.
Never overwrite unrelated work.

For a new project, default to CadQuery and document every meaningful dimension in millimetres as a named parameter.
For an existing OpenSCAD project, continue with OpenSCAD.
Do not convert an existing project or silently switch CAD engines after a failure.

## 3. Verify the environment

Identify the repository's documented model, export, render, and validation commands before creating geometry.
Run every model-generation, export, render, and validation command with an explicit bounded timeout that follows the repository's documented timeout convention and is appropriate for the command's expected workload.
Never allow these commands to wait without a deadline.
Use the existing mise-managed toolchain and invoke tools directly.
Do not activate or recommend another version manager.

If a required CAD engine, exporter, renderer, or mesh validator is unavailable:

1. Report the missing capability and which planned evidence it blocks.
2. Propose a setup command compatible with the repository and mise-managed toolchain.
3. Wait for approval before installing dependencies.

Do not silently install tools, switch engines, skip renders, or describe an unrendered model as validated.

## 4. Build in reviewed checkpoints

Use two checkpoints for an ordinary part:

1. **Functional shape**: overall envelope, interfaces, attachment, feature placement, fit clearances, and print orientation.
2. **Final model**: finishing geometry, complete exports, computed validation, print plan, and remaining physical tests.

A simple, low-risk part can combine these checkpoints when you state why an early checkpoint adds no useful decision.
A complex, enclosed, multipart, or tight-tolerance part can add a feature checkpoint between them.
Record the reason for combining or adding checkpoints in the model review sheet.
Never remove review merely to save time.

For each checkpoint:

1. Generate the current source and exports.
2. Run the smallest relevant computed checks from [FDM design guidance](fdm-design.md).
3. Produce renders from useful angles and inspect them before presenting them.
4. Create or update a temporary **model review sheet** through [its contract](model-review-sheet.md).
5. Load `review-artifact` and request feedback or approval.
6. Apply feedback to the model, regenerate evidence, and update the same review sheet.
7. Continue only after explicit approval.

A known generation, export, render, or mesh-integrity failure blocks the checkpoint.
If a timeout expires, report it as an output failure, identify the affected output, and block the affected checkpoint until the command succeeds and its output evidence is regenerated.
Do not request ordinary final-model approval or deliver the project while a checkpoint is blocked.
Repair the cause, regenerate every affected output and its evidence, and rerun the relevant checks before clearing the blocked status.

If the browser workflow cannot start, report the fallback and conduct the same review in chat.
Closing, ending, disconnecting, or timing out is not approval.

## 5. Deliver the 3D print project

Every delivered project must include parameterized source, STL exports for every printable part, optional STEP exports when the engine supports them and they help later editing, both a final render and its render configuration, and a product README.
When repository conventions exist, use their names for both files and follow local filename conventions for the other outputs.
When no repository convention exists, name them `render.png` and `render.conf`, and name the product README `README.md`.

The product README is mandatory.
Follow the structure, headings, link style, image style, and terminology of the nearest comparable product README.
Include the applicable sections from this list:

- Product summary and final render.
- Source and export links.
- Critical dimensions and their provenance.
- Material and concise slicer settings.
- Print orientation, supports, and quantity.
- Bill of materials or hardware.
- Assembly and mounting instructions.
- Adjustable parameters and design rationale.
- Computed validation and remaining physical-validation limits.
- Repository license reference.

When the repository has a root product catalog, add or update the product entry with its render, summary, project link, source, exports, and README.
Preserve unrelated catalog content and local style.
When no root product catalog exists, do not create one unless the user asks.

Keep the final render and documentation in the product directory.
Delete temporary model review sheets and intermediate checkpoint renders by default, but retain them when the user asks for design history.
Do not delete pre-existing or user-authored files as cleanup.

At delivery, list every output, summarize computed evidence, name every unresolved physical test, and offer adjustments to the parameters a user is likely to change.
Never claim that successful software checks prove physical fit or strength.
