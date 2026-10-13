---
name: model-domain
description: Clarify domain terms, relationships, and rules, and record agreed knowledge in local context files and significant architecture decisions in Markdown ADRs.
---

# Model domain

Read `rules/documentation.md` for the local file conventions, resolving it from the directory containing the absolute global instruction symlink target as the shared bootstrap requires.
Do not resolve it relative to the project or an installed configuration directory.
Read the relevant context files, ADRs, and code before changing the model.
Use the project's documented language consistently in conversation, tests, and code.

- Challenge ambiguous or conflicting terms and propose clear alternatives.
- Check relationships, identity, ownership, lifecycle, and important domain rules with concrete scenarios.
- Investigate contradictions between the user's description, documentation, and code.
  Ask which behavior is intended rather than silently treating one source as correct.
- Write agreed terms, relationships, and domain rules to `CONTEXT.md` as they become clear.
  Keep it concise; do not turn it into a specification, implementation guide, or transcript.
- Use `CONTEXT-MAP.md` only when separate domains genuinely need a map.
  Follow an existing map without reading every unrelated context.
- Write significant architecture choices to `docs/adr/` using the documentation rule's criteria.
  Include the problem, decision, alternatives, rationale, and consequences.
  Follow existing numbering and status conventions; preserve the history of superseded decisions.

Do not invent decisions or present unresolved proposals as agreed facts.
Create files only when there is useful content to record.
When another skill calls this one, apply the modeling discipline within its current conversation.
When called directly, work only on the requested domain scope and finish by identifying the files updated and any unresolved questions.
Use [work-log](../work-log/SKILL.md) for meaningful progress unless the calling skill already records the same outcome.
