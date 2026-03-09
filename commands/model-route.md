---
name: model-route
description: Recommend the optimal Claude model (Haiku/Sonnet/Opus) for a task based on complexity, risk, and budget.
argument-hint: [task-description]
---

# Model Route

Analyze the task described in `$ARGUMENTS` and recommend a model tier.

## Decision Matrix

| Factor | Haiku | Sonnet | Opus |
|--------|-------|--------|------|
| Task complexity | Mechanical, deterministic | Standard implementation | Architectural, ambiguous |
| Risk level | Low (easily reversible) | Medium | High (hard to undo) |
| Files involved | 1-2 files | 3-10 files | 10+ files or cross-cutting |
| Reasoning depth | Pattern matching | Multi-step logic | Deep analysis, trade-offs |
| Examples | Rename, reformat, boilerplate | Bug fix, feature, refactor, tests | Design review, planning, complex refactor |

## Output Format

Respond with:

**Recommended model**: [Haiku / Sonnet / Opus]
**Confidence**: [High / Medium / Low]
**Rationale**: [1-2 sentences explaining why]
**Fallback**: [Next model up if the recommended one struggles]

## Rules

- Default to Sonnet when uncertain — it handles 90% of tasks well.
- Recommend Opus for anything involving architecture decisions, multi-system reasoning, or ambiguous requirements.
- Recommend Haiku only for truly mechanical tasks where speed matters more than reasoning.
- If the user provides no task description, ask for one.
