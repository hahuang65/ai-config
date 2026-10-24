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
- Record agreed domain knowledge and significant architecture choices as they become clear.
  Follow the documentation rule for context-file navigation, record contents, and decision criteria; preserve the history of superseded decisions.

Use an available structured-question tool to settle ambiguous terms or intent, with alternatives and their trade-offs.
Use ordinary chat when the tool is absent or unavailable.
Cancellation leaves the question unresolved.
Do not invent decisions or present unresolved proposals as agreed facts.
Create files only when there is useful content to record.
When another skill calls this one, apply the modeling discipline within its current conversation.
When called directly, work only on the requested domain scope and finish by identifying the files updated and any unresolved questions.
Use [work-log](../work-log/SKILL.md) for meaningful progress unless the calling skill already records the same outcome.
