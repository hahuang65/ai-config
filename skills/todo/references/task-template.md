# Tasks HTML Contract

Write one canonical `tasks.html` file.
Do not create a Markdown companion or duplicate hidden JSON model.
The visible semantic HTML is the approved task source consumed and updated by implementation.

## Document metadata

- Use `<feature title> - Tasks` in `<title>` and use `Tasks` in `<h1>`.
- Put `data-artifact-kind="tasks"` and `data-artifact-version="1"` on the main content element.
- Link visibly to the source `specs.html`.
- Show the dependency graph and the “can run unattended” / “needs you present” split near the top, with `AFK` / `HITL` only as secondary workflow metadata.
- Write visible content in plain language, preferring the ubiquitous language from the selected context documentation and then common technical terms the reviewer is likely to know.
- Define an unavoidable unfamiliar term beside its first use rather than assuming the reviewer knows it.

## Slice contract

Represent each slice with a semantic container carrying:

- `data-slice-id` — stable dependency-order identifier
- `data-status` — `pending`, `in-progress`, or `complete`
- `data-mode` — `AFK` or `HITL`
- `data-dependencies` — comma-separated slice IDs, empty when unblocked
- `data-stories` — comma-separated user-story numbers from the spec

Each slice visibly includes:

1. A short descriptive title.
2. Type and reason when HITL.
3. Blocking slices or “None.”
4. Covered user stories.
5. The stable public **Test surface** for the first RED test.
6. A concise end-to-end “What to build” description.
7. Acceptance criteria.

Each acceptance criterion has a stable `data-criterion-id` and `data-status` of `pending` or `complete`.
Use native, accessible visual status rather than relying on emoji alone.
Implementation changes both the metadata and visible status when work completes.

## Slice rules

- Number slices in dependency order.
- Each slice is a thin but complete path through every integration layer.
- A completed slice is independently demonstrable or verifiable.
- Prefer many thin AFK slices over a few thick HITL slices.
- Keep tests inside the slice rather than creating horizontal test-only tasks.
- Avoid implementation file paths and code snippets because they go stale.

## Review behavior

Design the page for element and selected-text annotation through `review-artifact`.
After each feedback batch, edit this same HTML file and preserve stable slice and criterion IDs where possible.
An explicit approval event finalizes the tasks.
