---
description: Architectural code review — deepening opportunities via the architecture-reviewer agent, rendered as an HTML report with a grilling loop. No arguments = entire codebase; arguments = the area to review.
---
Load the review-code skill, then review: $ARGUMENTS

Follow the review-code skill workflow. Resolve the scope first: no arguments means the **entire codebase**; arguments name the **area** to review (when run as the final phase of /build, the scope is ONLY the feature's changes instead). Read `CONTEXT.md` and any relevant ADRs — domain vocabulary and recorded decisions frame the review — then dispatch the `architecture-reviewer` agent (via the Agent tool) with the scope. The agent walks the code, applies the deletion test, and returns structured deepening candidates; it never edits.

Render the candidates as a self-contained HTML report in the OS temp directory (NOT the workspace) using Tailwind via CDN and Mermaid via CDN. Each candidate gets a card with files, problem, solution, benefits in glossary terms (leverage/locality), a before/after diagram, and a recommendation badge (Strong / Worth exploring / Speculative). End with a Top recommendation section.

Use vocabulary from `language.md` for architecture (module, interface, depth, seam, adapter, leverage, locality) — never "component," "service," or "boundary." Use `CONTEXT.md` for domain names. After writing the report, ask the user which candidate to explore and drop into a grilling conversation. Update `CONTEXT.md` inline if new terms surface; offer ADRs only when a rejected candidate's reason is load-bearing. Hand execution to /refactor (scoped deepening) or /build (interface-changing).
