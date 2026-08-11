---
name: mockup
description: Create and review a canonical UI mockup before the Spec when a feature adds or materially changes an end-user browser or terminal interface.
argument-hint: [feature-description-or-directory]
---

# UI Mockup

Create canonical `mockups.html` in the Feature directory for a material end-user interface change.
Use the applicable context files and agreed feature scope to keep the design grounded in the project's ubiquitous language.

Run for a new or materially changed layout, interaction flow, information hierarchy, responsive behavior, or visual state in a browser or terminal interface.
Skip internal changes, exact copy replacements, mechanical styling repairs, and small defect fixes that require no design decision.
Ask about relevance only when the agreed scope and existing interface leave it genuinely ambiguous.

## Resolve the Feature Directory

After relevance confirms that a mockup is needed, resolve its output location deterministically:

- If `$ARGUMENTS` names a path under `docs/features/`, reuse it as the supplied Feature directory.
- Otherwise, treat `$ARGUMENTS` as a feature description and follow the [shared Feature directory conventions](../shared/references/build-pipeline.md#file-conventions) to derive `docs/features/<YYYYMMDD-HHMM>-<slug>/`.

Create the resolved directory if needed before writing `mockups.html`.

Read and follow the [UI mockup contract](references/mockup-contract.md) to inspect the existing interface and generate the canonical artifact.

## Process

1. Read the agreed feature scope, applicable context files, relevant ADRs, and the existing interface area.
2. Apply the relevance test above; when no mockup is relevant, report why and return to the invoking workflow without creating an artifact.
3. Generate or update `mockups.html` through the artifact contract. Before any approval review, one recommended design must be visibly selected with its rationale.
4. When unresolved alternatives remain, load `review-artifact` and use a feedback or decision interaction to settle the selection. Do not request or accept approval while the selection is unresolved.
5. After the selection settles, update the same `mockups.html` with a visible decision record that names the selected design, its rationale, and the rejected alternatives.
6. Only after the decision record is complete, start or resume the approval review through the [shared review protocol](../shared/references/review-artifact.md).
7. Apply approval feedback to the same live artifact, and keep the decision record current.
8. Continue only after explicit approval; it is the Design→Spec signal, and ending or closing review is not approval.

When feedback changes or exposes a domain concept, load and follow [model-domain](../model-domain/SKILL.md) before continuing.
