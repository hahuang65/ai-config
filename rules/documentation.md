# Project context and decisions

Read the project's `CONTEXT.md` for its shared terms and their meanings before using project-specific terminology.
If `CONTEXT-MAP.md` exists, use it to find the relevant context files rather than reading every context.
Check applicable project instructions deliberately; do not assume that context discovery is enabled.
Use these documented terms consistently in prose, tests, and code.
Explain a term when the intended reader may not know it, even if it is in the glossary.
Ask when a term's meaning is unclear or conflicts with the current documentation.

Keep `CONTEXT.md` as a concise glossary with agreed domain relationships and important domain rules, not a task log, specification, or copy of the source code.
Update it when the user settles a new or changed project term.
Create it only when there are useful terms to record.
Use `CONTEXT-MAP.md` only when the project has separate contexts that need a map.

An architectural decision record (ADR) explains an important decision and its trade-offs.
Read relevant records in `docs/adr/` before changing the decisions they describe.
Write a record when a decision is costly to reverse, has meaningful alternatives, and would otherwise be hard to understand later.
State the problem, decision, alternatives, reasons, and consequences in plain language.
Follow the project's naming convention; otherwise use a numbered Markdown file with a descriptive title.
Do not create a decision record for routine implementation choices.
Do not add a separate approval workflow, HTML artifact, or duplicate document just to record a decision.

In A5 projects, keep these files private as required by `a5.md`.
Do not introduce Confluence integration as part of this minimal setup.
