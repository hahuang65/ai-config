# Project shared commands as harness-native prompts

ADR-0027 supersedes this ADR's decision to keep delivery in a skill and restores `deliver` as an Orchard-oriented prompt composition.
ADR-0029 supersedes the decision to keep `rebase` as a thin alias and composes it with conflict resolution while Orchard retains lifecycle ownership.

Some explicit slash workflows benefit from concise harness-native prompt shortcuts.
Skills remain discoverable capability packages, while prompt templates are explicit parameterized user-message shortcuts.
A prompt is not required solely to make a skill's Claude Code slash spelling available in pi because pi can resolve matching requests from advertised skill metadata and provides `/skill:<name>` for forced invocation.

We restore `commands/*.md` as shared prompt entry points and project them through each harness manifest.
Claude Code installs them into `~/.claude/commands/`, while pi installs the same files into `~/.pi/agent/prompts/`.
Commands and skills may not share a name.
A command must either be a thin alias to a differently named skill or a concise composition of multiple skills without reproducing their implementations.

We evaluated the existing workflows against that distinction.
`build` remains a skill because it is a substantial reusable capability package with approval invariants and supporting references.
`deliver` is one skill because commit-if-needed, mandatory synchronization, local integration, and A5 pull-request creation are cases of one delivery intent.
It reuses the standalone `commit` and `orchard` skills without reproducing their policies.
A separate `deliver` prompt would add only spelling parity, so it stays retired.
The `rebase` command remains a thin `orchard` alias because it gives one specific Orchard suboperation a useful direct shortcut.
Every other workflow remains a skill because it owns a discoverable capability rather than a user-message alias or concise cross-skill sequence.

## Consequences

- Claude Code and pi consume the same curated command sources, while skill invocation follows each harness's native discovery surface.
- Commands and skills have zero same-name overlap and no duplicated delegated behavior.
- Pi prompt installation shares `~/.pi/agent/prompts/` with unrelated and package prompts without deleting them.
- Harness manifests declare their native `command_target`, keeping path differences outside shared content.
- The authoring and installation gates enforce command frontmatter, the curated command set, no same-named skills, source-path independence, and both native destinations.

This ADR supersedes ADR-0024's retirement of commands while preserving its requirement that duplicate workflow bodies stay retired.
