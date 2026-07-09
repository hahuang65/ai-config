---
description: Interactive grilling session — interview the user about a feature, refine CONTEXT.md and ADRs inline
---
Load the grill skill, then grill on: $ARGUMENTS

Follow the grill skill workflow. Read existing `CONTEXT.md` (or `CONTEXT-MAP.md` for multi-context repos) and `docs/adr/` first. Then interview the user one question at a time, proposing a recommended answer for each. Challenge terminology against the existing glossary; sharpen fuzzy language; stress-test domain relationships with concrete scenarios; cross-reference claims with the codebase. Update `CONTEXT.md` inline as terms get resolved — do not batch. Offer ADRs only when a decision is hard-to-reverse, surprising without context, and the result of a real trade-off. If a question can be answered by exploring the code, do that instead of asking the user.

The grill phase ends when the user says they're satisfied with the shared understanding. Then tell them to say "draft the spec" and stop.
