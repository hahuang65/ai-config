# Spec HTML Contract

Write one canonical `specs.html` file.
Do not create a Markdown companion or a hidden JSON source model.
The visible semantic HTML is both the review surface and the durable input to later phases.

## Document metadata

- Use `<feature title> - Spec` in `<title>` and use `Spec` in `<h1>`.
- Put `data-artifact-kind="spec"` and `data-artifact-version="1"` on the document's main content element.
- Use stable section IDs so feedback remains understandable after live reload.
- Keep styling and scripts self-contained except for optional visualization CDNs.
- Use semantic headings, lists, tables, sections, articles, and native controls.
- Write visible content in plain language, preferring the ubiquitous language from the applicable context files and then common technical terms the reviewer is likely to know.
- Define an unavoidable unfamiliar term beside its first use rather than assuming the reviewer knows it.

## Required visible sections

### Problem Statement

Describe the problem from the user's perspective.

### Solution

Describe the solution from the user's perspective.

### User Stories

Include an extensive numbered list.
Each story follows: “As an <actor>, I want <feature>, so that <benefit>.”
Cover the complete agreed scope, error paths, lifecycle, accessibility, security, and fallback behavior where relevant.

### Implementation Decisions

Record the modules and their interfaces, technical clarifications, ADR references, schema or protocol changes, and concrete interactions agreed during grilling.
Do not include file paths or implementation code because they go stale.
A small decision-rich state machine, schema, or type shape is allowed only when prose would be materially less precise.

### Testing Decisions

Describe tests through stable public interfaces rather than implementation details.
For every production module, identify whether it is tested directly, covered through a higher-level seam, or has no product test with a reason.
Name relevant prior art already present in the repository.
Do not defer test ownership back to the user.

### Out of Scope

List deliberate exclusions clearly enough that later phases do not reintroduce them.

### Further Notes

Include only durable context that does not belong in the required sections.

## Review behavior

Design the page for element and selected-text annotation through `review-artifact`.
After each feedback batch, edit this same HTML file and preserve stable IDs where possible.
An explicit approval event finalizes the spec.
