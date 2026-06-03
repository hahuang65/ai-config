---
description: Survey an area of the codebase for deepening opportunities (shallow → deep modules) and propose them as an HTML report
---
Load the improve-codebase skill, then survey: $ARGUMENTS

Follow the improve-codebase skill workflow. Read `CONTEXT.md` and any relevant ADRs first — domain vocabulary and recorded decisions inform the suggestions. Then use the Agent tool with `subagent_type=Explore` to walk the codebase organically, noting friction: shallow modules (interface nearly as complex as implementation), leakage across seams, tightly-coupled clusters, code that's untested or hard to test through its current interface. Apply the deletion test to anything you suspect is shallow.

Write a self-contained HTML report to the OS temp directory (NOT the workspace) using Tailwind via CDN and Mermaid via CDN. Each candidate gets a card with files, problem, solution, benefits in glossary terms (leverage/locality), a before/after diagram, and a recommendation badge (Strong / Worth exploring / Speculative). End with a Top recommendation section.

Use vocabulary from `language.md` for architecture (module, interface, depth, seam, adapter, leverage, locality) — never "component," "service," or "boundary." Use `CONTEXT.md` for domain names. After writing the report, ask the user which candidate to explore and drop into a grilling conversation. Update `CONTEXT.md` inline if new terms surface; offer ADRs only when a rejected candidate's reason is load-bearing.
