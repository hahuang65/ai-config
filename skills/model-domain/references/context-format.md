# CONTEXT.md Format

Context-file format reference for the `model-domain` skill.

## Context Files and Ubiquitous Language

**Context files** are `CONTEXT.md` and `CONTEXT-MAP.md` files collectively.
They record or locate the project's **ubiquitous language**: the shared, canonical vocabulary that domain experts, users, documentation, tests, and code use to describe the project's domain.
The files are the durable record of that language, not the language itself.
A term becomes ubiquitous only when people and artifacts use it consistently with the same meaning.

## Structure

```md
# {Context Name}

{One or two sentence description of what this context is and why it exists.}

## Language

**Order**:
{A one or two sentence description of the term}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request

**Customer**:
A person or organization that places orders.
_Avoid_: Client, buyer, account
```

## Rules

- **Be opinionated.** When multiple words exist for the same concept, pick the best one and list the others as aliases to avoid.
- **Flag conflicts explicitly.** If a term is used ambiguously, call it out in "Flagged ambiguities" with a clear resolution.
- **Keep definitions tight.** One or two sentences max. Define what it IS, not what it does.
- **Show relationships.** Use bold term names and express cardinality where obvious.
- **Only include terms specific to this project's context.** General programming concepts (timeouts, error types, utility patterns) don't belong even if the project uses them extensively. Before adding a term, ask: is this a concept unique to this context, or a general programming concept? Only the former belongs.
- **Group terms under subheadings** when natural clusters emerge. If all terms belong to a single cohesive area, a flat list is fine.
- **Write an example dialogue.** A conversation between a dev and a domain expert that demonstrates how the terms interact naturally and clarifies boundaries between related concepts.

## Single vs multi-context repos

**Single context (most repos):** One `CONTEXT.md` at the repo root.

**Multiple contexts:** A `CONTEXT-MAP.md` at the repo root lists the contexts, where they live, and how they relate to each other:

```md
# Context Map

## Contexts

- [Ordering](./src/ordering/CONTEXT.md) — receives and tracks customer orders
- [Billing](./src/billing/CONTEXT.md) — generates invoices and processes payments
- [Fulfillment](./src/fulfillment/CONTEXT.md) — manages warehouse picking and shipping

## Relationships

- **Ordering → Fulfillment**: Ordering emits `OrderPlaced` events; Fulfillment consumes them to start picking
- **Fulfillment → Billing**: Fulfillment emits `ShipmentDispatched` events; Billing consumes them to generate invoices
- **Ordering ↔ Billing**: Shared types for `CustomerId` and `Money`
```

The skill infers which structure applies:

- If `CONTEXT-MAP.md` exists, read it to find contexts
- If only a root `CONTEXT.md` exists, single context
- If neither exists, create a root `CONTEXT.md` lazily when the first term is resolved

When multiple contexts exist, infer which one the current topic relates to. If unclear, ask.

## Confluence Context Document

The saved Confluence context document is the native equivalent of local context files.
Do not create a local Markdown companion.
Keep the same tight definitions, opinionated canonical terms, avoided aliases, relationships, and example dialogue as the local format.

Use the Confluence page title as the context name and organize its body with native headings:

- An opening paragraph defines the context and why it exists.
- **Language** contains the terms, grouped under section headings only when natural clusters emerge.
- Each term is one visually cohesive entry: a canonical-term heading followed immediately by one `panel-note` panel.
- Set each term heading one level below its containing **Language** or group heading; use deeper levels beneath groups or context subsections instead of forcing every term to `h3`.
- Keep the term heading outside the panel so other Confluence content can link to its anchor.
- Put the complete entry in that one panel: the one or two sentence definition, an italic **Avoid** line when aliases exist, and any concise relationship or cardinality notes specific to the term.
- Do not split one term across several panels or nest tables, expands, or panels inside its note panel.
- **Flagged ambiguities** records unresolved conflicts only while they remain active.
- **Relationships** states ownership, direction, and cardinality when those facts matter.
- **Example dialogue** shows domain experts and developers using the terms naturally.

For multiple contexts, first follow any existing page structure or links to subordinate context pages.
If the supplied page is the complete context document, add a **Contexts** section whose context subsections each contain their description and language, followed by one project-wide **Relationships** section.
Do not invent or require extra Confluence pages.

## Confluence-Safe Updates

Use the available Confluence integration to fetch and update the page with `contentFormat: "html"`.
Markdown round trips can destroy task lists and Confluence-local identifiers.
An update replaces the entire page body, so start from a fresh HTML read and preserve all unrelated content.
Preserve every existing `data-local-id` attribute exactly and omit `data-local-id` on new nodes.
Preserve the page title unless the user explicitly changes it.
After the update, fetch the page again in HTML and verify the changed definitions, links, and surrounding content.
