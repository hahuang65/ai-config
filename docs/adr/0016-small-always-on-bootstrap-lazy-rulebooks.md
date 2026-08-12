# Small always-on bootstrap with one shared lazy rulebook

Pi has no native rules-directory loader, while Claude Code recursively injects
Markdown files from `~/.claude/rules/`. The previous configuration therefore
made pi's six advisory rules lazy but made the same rules always-on in Claude.
That difference cost roughly 2,700 tokens in every Claude turn and also hid an
important gap in pi: before loading the commit skill, pi did not know that work
belongs on a feature branch named with the user's initials.

The agents also repeated a long harness-specific paragraph explaining three
possible rule locations. The content was redundant and made isolated agent
prompts larger without changing which rules each agent needed.

## Decision

Install one small, harness-neutral bootstrap, `baseline-prompt.md`, as the
global context file for both harnesses:

- pi: `~/.pi/agent/AGENTS.md`
- Claude Code: `~/.claude/CLAUDE.md`

The bootstrap contains only the critical cross-task baseline, the shared rulebook location, and concise load triggers.
Branch naming stays always-on so it is available before the first branch is created, and Git-write ownership stays always-on so unrelated workflows do not stage, commit, push, or deliver.
Mise ownership stays always-on so tool invocations use the correct environment.
Engineering-quality priorities, the context-files and ubiquitous-language definitions, user-facing prose guidance, confirmation semantics, HTML routing, and Markdown sentence formatting also stay always-on because they apply across planning, documentation, and implementation.
Detailed Git policy loads only before staging, preparing a commit message, or committing.

Keep one canonical lazy rulebook at `~/.dotfiles/ai/rules/`. Pi and Claude read
needed files directly from that location; neither receives another rules
mirror. Oh-my-pi keeps its native `~/.omp/agent/rules/` symlinks because its
`rule://<name>` mechanism requires files in its config root.

Agent `Project Rules` sections list only the specific bare rule names they need.
The global bootstrap resolves those names for pi and Claude; oh-my-pi resolves
them through its native rulebook. Hard safety enforcement continues to live in
the shared guard core and therefore does not consume prompt tokens.

## Consequences

- Pi and Claude pay only for the small bootstrap on every turn; detailed rules consume context only when relevant.
- Skills rely on the bootstrap for universal language, formatting, confirmation, HTML-routing, and Git-write behavior instead of repeating those contracts locally.
- All agents refer to the same canonical rule names without embedding
  harness-specific lookup instructions.
- Claude's old repo-managed symlinks under `~/.claude/rules/` and the interim
  `~/.claude/rulebook/` are removed during installation. Pi's old
  `~/.pi/agent/rules/` links are removed too. Unrelated user files remain.
- A rule's `description` remains a load trigger for oh-my-pi's native rulebook,
  while the bootstrap provides equivalent routing hints to pi and Claude.
- `baseline-prompt.md` is intentionally distinct from the repo-root
  `AGENTS.md`, which remains this repository's authoring contract and is never
  installed globally.
- This supersedes ADR-0014's Claude-always-on comparison and extends its lazy
  pi decision to Claude Code. ADR-0013 remains historical and superseded for
  rule delivery.
