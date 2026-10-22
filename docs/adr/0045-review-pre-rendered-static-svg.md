# Review pre-rendered static SVG

## Problem

Diagram evaluations preferred Pele's appearance, but the review sanitizer removed both Pele and Mermaid SVG output.
Raster conversion preserved appearance but lost vector scaling and selectable diagram text.
Running a diagram library inside an approval document would also change the document-script boundary.

## Decision

Allow a restricted subset of pre-rendered inline SVG through the existing Ammonia sanitizer.
Keep the script-disabled iframe, Content Security Policy, source size limit, and revision-bound approval unchanged.
Do not install or embed Pele or Mermaid JavaScript as part of SVG support.
Prefer Pele when a renderer is available, while checking category retention and readable layouts rather than assuming the renderer fixes them.

Support shapes, groups, text, descriptions, markers, local clipping, and gradients.
Keep known SVG presentation attributes and restricted inline declarations, including CSS variables used by Pele themes.
Only local fragment URLs may appear in SVG paint, clipping, or marker attributes and inline declarations.
Remove scripts, handlers, embedded HTML, SVG images, use elements, animation elements, and metadata.
SVG title elements remain removed with HTML title metadata, so authors must use aria-label and visible captions.
The existing safe GitHub PR link policy also applies to anchors inside SVG.
Because sanitizer attribute callbacks expose local names rather than namespaces, HTML and SVG anchors share the restricted paint-value guard while retaining ordinary HTML link layout declarations.

Existing inline stylesheet handling does not change.
Content Security Policy blocks external resources even if a retained stylesheet refers to them.
This is not a general CSS sanitizer or a guarantee against CSS animation already expressible in ordinary artifact HTML.
SVG image files and data:image/svg+xml remain unsupported as img sources.

## Alternatives

- Keep raster-only diagrams: rejected because sharp scaling and selectable text are useful review capabilities.
- Enable document JavaScript: rejected because static diagrams do not need executable artifact content.
- Allow arbitrary SVG: rejected because embedded HTML, resource references, and active SVG features exceed the review boundary.
- Replace the HTML sanitizer: unnecessary for this explicitly limited subset and its namespace checks.

## Consequences

Pre-rendered diagrams can retain native vector text and graphics without changing approval authority.
Unsupported SVG elements or styles may disappear, so the sanitized view must be checked before approval.
Authors must use unique IDs, visible captions, and layouts that keep labels and all chart categories readable.
Natural-size scrolling or simpler diagrams are preferable to scaling dense diagrams into unreadable text.

Process tests cover geometry, themes, local references, removed active content, and geometry-only revision changes.
Bounded Firefox tests cover actual rendering, annotation targets, safe PR links, script isolation, and blocked external resource requests.
The renderer evaluation remains a separate prototype, not a production dependency or a passing compatibility gate.
