# Retire duplicate command wrappers

Claude Code registers every installed skill directly as `/<name>`.
Pi registers the same skill as `/skill:<name>` and can also select it from its description.
After oh-my-pi was retired, every file in `commands/` duplicated a same-named skill and no supported harness consumed the wrapper.

We retire the `commands/` primitive from this repository.
User-facing workflows live only in `skills/<name>/SKILL.md`, and each harness exposes that canonical skill through its native invocation syntax.
The installer no longer mirrors or deduplicates command files, and the authoring gate rejects any reintroduced `commands/` directory or command-consuming harness manifest.

## Consequences

- Workflow instructions have one canonical file-backed representation.
- Claude users invoke a skill as `/<name>`.
- Pi users invoke a skill as `/skill:<name>` or request the workflow naturally.
- Harness-specific programmatic commands remain implementation details of extensions and are not a shared authoring primitive.
- Historical ADRs remain unchanged as records of the command-consuming harnesses that existed when those decisions were made.

This ADR supersedes the active shared-command portions of ADR-0001, ADR-0005, ADR-0010, and ADR-0013.
