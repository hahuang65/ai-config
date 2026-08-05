# Standalone Domain-Modeling Session

Use this workflow when `model-domain` is invoked directly rather than embedded in another skill.
The session builds or sharpens the project's ubiquitous language and the context files that record or locate it.

## Select the Mode

Resolve a mode from `$ARGUMENTS` and the existing files:

- **Build from scratch** — bootstrap a project that has no context files.
  Use this mode by default when neither `CONTEXT.md` nor `CONTEXT-MAP.md` exists.
- **Augment** — add missing concepts or sharpen a named area in an existing model.
  Use this mode when the user supplies a topic or asks to extend the model.
- **Audit and condense** — examine existing context files for bloat, ambiguity, duplication, drift, and missing domain relationships.
  Use this mode when the user asks to review, audit, clean up, or condense the model.

If existing context files are present and the mode is unclear, briefly offer **augment** or **audit and condense**, then wait for the choice.
Do not ask the user for facts that code, documentation, or existing ADRs can answer.
Explore those sources first and ask only for domain decisions.

## Build From Scratch

1. Inspect project documentation, code structure, public behavior, and ADRs for candidate concepts and context boundaries.
2. If one context clearly fits, use a root `CONTEXT.md`.
   If multiple contexts are already evident, propose a `CONTEXT-MAP.md` and the subordinate context files before writing them.
3. Present candidate terms and relationships in small dependency-aware rounds.
   Use concrete scenarios to resolve meaning, ownership, identity, cardinality, and lifecycle.
4. Write each resolved term or relationship immediately.
   Do not dump inferred code names into the glossary.

## Augment

1. Read `CONTEXT-MAP.md` when present, all context files relevant to the topic, applicable ADRs, and the matching code and documentation.
2. Identify missing concepts, overloaded terms, contradictions, and relationships that the current model does not explain.
3. Work through those findings with the user in dependency-aware rounds and update the applicable context artifact inline after each resolution.
4. Preserve unaffected definitions and the established ubiquitous language.

## Audit and Condense

1. Read `CONTEXT-MAP.md` when present and every context file in scope, then compare them with relevant code, product documentation, and ADRs.
2. Flag terms that are duplicated, contradictory, obsolete, implementation-specific, general programming vocabulary, overlong, or in the wrong context.
3. Flag missing relationships, unclear context ownership, and words used inconsistently outside the glossary.
4. Present proposed merges, removals, moves, and tighter definitions in dependency-aware rounds.
   Preserve domain meaning and ask the user to decide every semantic change.
5. Apply approved cleanup inline.
   A condensed file must remain opinionated and useful, not merely shorter.

## Completion

Finish when the selected scope has no unresolved findings and the user agrees that the model is accurate and concise.
Report the mode, context maps and files created or changed, terms added or changed, terms removed or moved, ambiguities resolved, and ADRs created.
