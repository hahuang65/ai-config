# Handoff Document Structure

Use this structure for the handoff document written to `/tmp/`.

```markdown
# Handoff: <one-line purpose>

## Purpose of the next session

<2-3 sentences. Crisp. What is the next session being spun up to do?>

## Relevant context from this session

<Bullets or short paragraphs. Only what the next session needs to know.
Do NOT duplicate content from PRDs, plans, ADRs, issues, commits, or diffs
— reference them by path or URL instead.>

## Suggested skills

<Skills the next session should invoke, in the order they make sense.
Example:
- /grill — to refine domain terminology around X before drafting
- /prd — once the design is settled
- /implement — once tasks are approved>

## Pointers (not duplicated content)

- PRD: docs/features/<slug>/prd.md
- Tasks: docs/features/<slug>/tasks.md
- ADRs touched: docs/adr/0007-...
- Recent diff: git log -p <sha>..<sha>
- External references: <URLs>
```
