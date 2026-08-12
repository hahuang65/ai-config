# Decision Record Format

Format reference for durable decisions created by the `model-domain` skill.
The selected worktree documentation destination determines the native format.

## Local ADRs

Local Architectural Decision Records (ADRs) live in `docs/adr/` and use sequential numbering: `0001-slug.md`, `0002-slug.md`, and so on.
Create the directory lazily, only when the first ADR qualifies.

### Template

```md
# {Short title of the decision}

{One short, concrete, plain-language scenario that exposed the problem.}

{1-3 sentences: what is the context, what did we decide, and why.}
```

The scenario is additive; it does not replace the context, decision, or rationale in the following paragraph.
Keep the scenario in the opening prose rather than adding a section heading.
Use a separate scenario section only when several scenarios need detailed explanation.
Apply this format to new records; do not rewrite previous ADRs only to add scenarios.
That is enough for most local ADRs.
The value is in recording that a decision was made and why, not in filling out sections.

Add these optional sections only when they add genuine value:

- **Status** frontmatter (`proposed | accepted | deprecated | superseded by ADR-NNNN`) when a decision can be revisited.
- **Considered Options** when rejected alternatives are worth remembering.
- **Consequences** when non-obvious downstream effects need to be explicit.

Scan `docs/adr/` for the highest existing number and increment it by one.

## Confluence Decisions Document

The saved Confluence decisions document replaces local ADR files for that worktree.
It is also the only Confluence destination for contracts.
Never create a Confluence page for a contract or an individual decision.
Do not use “ADR” or workflow-specific vocabulary on the page.
Use **Contracts**, **Decisions**, **Decision details**, and **design session** so the document uses language that co-workers share.

### Contracts

Write every contract to the saved decisions document, never to the context document or a separate page.
A contract records an agreement that one context, system, or team relies on another to honor; it does not need to meet the decision-record threshold.
If **Contracts** does not exist, create that section while preserving the page's unrelated content and existing section order.
Update an existing matching contract in place; otherwise append the new contract to that section.
Keep each contract as one visually cohesive card:

1. Add a short contract heading outside the panel so other Confluence content can link to its anchor.
2. Immediately follow it with one `panel-note` panel containing the complete contract.
3. Use the panel's background color to distinguish the contract as one unit without introducing decorative color variation between contracts.
4. Put concise blocks for the parties, guarantee, conditions, failure behavior, and compatibility or versioning constraints that apply inside the same panel.

Preserve an established equivalent card structure when one exists.
Do not split one contract across cards or nest tables, expands, or another panel inside its note panel.
Never create a page for a contract.

### Decision List

Confluence decision-list items are inline-only.
Add one line per decision in this format:

```text
YYYY-MM-DD — D-NNN: <short decision statement> (<design session>, <who>)
```

Make the `D-NNN` text a link to the matching `#D-NNN` detail heading.
Keep the statement short enough to scan on one line.
Scan both the list and detail headings for the highest `D-NNN` identifier and increment it by one.
Never reuse a missing or retired identifier.

### Decision Details

If **Decision details** does not exist, create it as the final section of the page.
If it already exists, append there without moving the section or any content around it.
Append each record as one visually cohesive unit:

1. Add an `h3` heading containing only `D-NNN`.
2. Keep that heading outside the panel so `#D-NNN` remains a working link target.
3. Immediately follow it with one `panel-note` panel containing the complete record.
4. Start the panel with a bold title line containing the short title, date, design session, and decision makers.
5. Add concise **Context**, **Scenario**, **Decision**, **Alternatives rejected**, and **Consequence** blocks inside the same panel.
6. In **Scenario**, give one short, concrete, plain-language example of the scenario that led to this decision.
   Describe what happened or could happen and why the choice matters without repeating the other blocks or relying on technical jargon.

Do not nest tables, expands, or another panel inside the note panel.
Use the Confluence-safe HTML read, whole-body update, identifier preservation, and verification rules in [context-format.md](context-format.md).

## When to Offer a Decision Record

All three conditions must be true:

1. **Hard to reverse** — changing the decision later has meaningful cost.
2. **Surprising without context** — a future reader will reasonably ask why this choice was made.
3. **The result of a real trade-off** — genuine alternatives existed and were rejected for specific reasons.

If a decision is easy to reverse, not surprising, or has no real alternative, do not create a record.

Typical qualifying decisions include:

- Architectural shape.
- Integration patterns between contexts.
- Technology choices that carry lock-in.
- Boundary and scope decisions.
- Deliberate deviations from the obvious path.
- Constraints not visible in code.
- Rejected alternatives whose rejection is non-obvious.
