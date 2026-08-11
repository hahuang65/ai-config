# ai-config

Shared configuration for Claude Code and pi.
Skills, commands, agents, and rules are authored once and consumed by both harnesses.
The installer projects skills, commands, and agents into native paths; rules stay at their canonical source.

> Contributors: read [`AGENTS.md`](AGENTS.md) before changing a primitive.
> Run `make test` before every commit.

## Quick start

```sh
git clone <repo> ~/.dotfiles/ai
cd ~/.dotfiles/ai
./install.sh
```

Examples in this document use Claude Code's `/name` syntax.
In pi, request a skill naturally or use `/skill:name`.
The shared `/deliver` and `/rebase` prompts use `/name` in both harnesses.

## Build workflow

`build` is the primary feature-development workflow.
It has five phases and four approval gates.

```text
/build "feature"
  1. /grill                         domain decisions and ubiquitous language
     └─ /mockup when UI is relevant approved mockups.html
         ↓ Design→Spec
  2. /spec                          approved specs.html
         ↓ Spec→Tasks
  3. /todo                          approved vertical slices in tasks.html
         ↓ Tasks→Implement
  4. /code or /coach                vertical-slice TDD and verification
  5. /review-change                 evidence, Findings, and final report
         ↓ Review→Done
```

- `/code` lets the AI write tests and implementation.
- `/coach` makes the AI write one test at a time while the user writes implementation.
- Relevant UI runs through `/mockup`; otherwise post-grill confirmation clears the same Design→Spec gate.
- A prototype can use a mockup before or after a host application experiment, but it stays outside the build pipeline.
- No phase commits changes.

Project-wide context files record the ubiquitous language.
Project-wide ADRs live in `docs/adr/`.
Each build stores its canonical HTML feature artifacts under `docs/features/<YYYYMMDD-HHMM>-<slug>/`:

```text
mockups.html   # conditional approved UI intent
specs.html     # approved feature spec
tasks.html     # approved slices and completion state
```

There are no Markdown companions.
The final Review change report is disposable and lives in the operating-system temp directory.
See [`skills/build/SKILL.md`](skills/build/SKILL.md) for the complete workflow contract.

## Standalone Review change CLI

`./install.sh` links `review-change` into `~/.local/bin/`.
The CLI requires Node.js 22+ and pi.

```sh
review-change
review-change main...HEAD --intent "Preserve the public API"
review-change 123 --intent "Validate this pull request"
review-change main...HEAD --model gpt-5 --thinking high
```

With no target, the CLI resolves the current branch pull request when present; otherwise it reviews from the branch point through the current working state.
An explicit target can be a branch, local Git range, pull-request URL, or pull-request number.
The CLI reviews an immutable isolated snapshot, prints a terminal summary, and opens a disposable HTML report.
It does not edit the target, invoke `review-artifact`, post a provider review, or wait for approval.
Run `review-change --help` for all options and terminal controls.

## Capabilities

### Build and design

| Skill | Purpose |
|---|---|
| `build` | Run the complete five-phase workflow. |
| `grill` | Stress-test a feature in dependency-aware interview rounds. |
| `model-domain` | Build, augment, or audit the ubiquitous language and qualifying ADRs. |
| `mockup` | Approve a material browser or terminal UI before specification. |
| `spec` | Write and review canonical `specs.html`. |
| `todo` | Turn an approved spec into canonical vertical slices in `tasks.html`. |
| `code` | Implement approved slices with AI-driven vertical-slice TDD. |
| `coach` | Guide user-driven implementation one test at a time. |
| `review-change` | Validate a change against Authoritative intent. |

### Standalone workflows

| Skill | Purpose |
|---|---|
| `refactor` | Run a directed refactor or a scoped hygiene sweep. |
| `review-code` | Explore architectural deepening opportunities without editing code. |
| `prototype` | Build throwaway code to answer one logic, state, or integration question. |
| `handoff` / `pickup` | Move focused context between independent sessions. |
| `review-artifact` | Review local HTML with annotations, live reload, and explicit approval. |
| `visualize` / `visualize-diff` | Create self-contained technical visuals and visual diff reviews. |
| `orchard` | Manage reusable, branch-bound worktrees. |
| `commit` | Create one focused checkout-local commit. |
| `resolve-conflicts` | Resolve supported merge, rebase, or restoration conflicts. |

### Commands

- `deliver` routes managed worktrees through Orchard and ordinary branches directly through Git.
- `/rebase` composes Orchard rebasing with conflict resolution.

Maintainer-facing composition rules are in [`AGENTS.md`](AGENTS.md).

## Repository structure

```text
.
├── commands/               Shared explicit aliases and compositions (deliver, rebase)
├── skills/                 Shared workflow capabilities and guides
├── agents/                 Shared specialist subagents
├── rules/                  7 on-demand advisory rules
├── harnesses/              Claude Code and pi modules
├── shared/                 Guardrail policy registry and detection core
├── harness-system-prompt.md
├── docs/adr/               Architectural decisions
├── docs/features/          Per-feature canonical HTML artifacts
├── test/ and scripts/      Validation and self-tests
└── install.sh              Harness-neutral installer
```

The dated Markdown files already under `docs/features/` are historical development records.
Current pipeline artifacts are `mockups.html`, `specs.html`, and `tasks.html` with no Markdown companions.
Optional informational visuals can live beside them.
The [`example/`](example/) directory is also a clearly labeled legacy sample.

## Harness support

| Aspect | Claude Code | pi |
|---|---|---|
| Config root | `~/.claude/` | `~/.pi/agent/` |
| Skills | `~/.claude/skills/` as `/<name>` | `~/.pi/agent/skills/` as `/skill:<name>` |
| Commands | `~/.claude/commands/` | `~/.pi/agent/prompts/` |
| Agents | `~/.claude/agents/` | `~/.pi/agent/agents/` |
| Rules | Canonical `~/.dotfiles/ai/rules/` | Canonical `~/.dotfiles/ai/rules/` |
| Guardrails | Tier-B command-hook adapter | Tier-A in-process extension |

Pi uses the Catppuccin Mocha theme and gives successful `Edit` and `Write` tool rows an amber background.
Other successful tools stay green, and failures stay red.

`./install.sh` reads each module manifest, installs shared primitives into native paths, removes dangling links, links `review-change`, and configures this repository's pre-commit hook.
Detailed installation behavior lives under [`harnesses/`](harnesses/).

## Rules and guardrails

Rules (7 advisory files) guide behavior and load only when relevant.
They do not enforce policy.

| Rule | Guidance |
|---|---|
| `coding-style` | Maintainable source structure and naming. |
| `testing` | Behavior-focused TDD and test isolation. |
| `performance` | Measurement, caching, pagination, and timeouts. |
| `cli-ergonomics` | Bounded, deterministic Agent-facing CLIs. |
| `git-commit` | Commit format, staging, and integration. |
| `mise` | Mise-managed toolchains. |
| `security` | Input, output, authorization, and logging safety. |

The shared guard core mechanically blocks unsafe operations in both harnesses.
The mandatory floor covers secret access and writes, unsafe Git operations, Orchard worktree branch rebinding, privilege escalation, destructive infrastructure or database commands, deploys, raw-disk writes, and broad deletion or permission changes.
`no-shell-write` also blocks shell-redirection file writes.
See [`shared/policy-registry.ts`](shared/policy-registry.ts) for the authoritative policy list and run `make test/guard` to verify conformance.

## Development

Run `make` to list developer tasks.
Run `make test` before every commit.
It validates content, installation behavior, guardrail conformance, and the validation pipeline's self-tests.

SourceHut CI mirrors the repository to GitHub on push.

## Acknowledgements

- [Boris Tane's workflow](https://boristane.com/blog/how-i-use-claude-code/) inspired the original research-first pipeline and review discipline.
- [Matt Pocock's skills-TDD pipeline](https://www.aihero.dev/skills-tdd) and [skills repository](https://github.com/mattpocock/skills) inspired the grill, spec, todo, TDD, handoff, prototype, review-code, model-domain, and `resolve-conflicts` workflows.
- [nicobailon/visual-explainer](https://github.com/nicobailon/visual-explainer) is the source of the `visualize` skill.
- [kunchenguid/no-mistakes](https://github.com/kunchenguid/no-mistakes) inspired Review change's independent reviewer/fixer roles and evidence-first Findings.
- [kunchenguid/lavish-axi](https://github.com/kunchenguid/lavish-axi) inspired the local browser review loop; see [`skills/review-artifact/ATTRIBUTION.md`](skills/review-artifact/ATTRIBUTION.md).
- [kunchenguid/axi at revision 93c5f334](https://github.com/kunchenguid/axi/tree/93c5f334d6ec074c29ca8d74fa629530dd298a43) inspired the `cli-ergonomics` rule.
- [everything-claude-code](https://github.com/affaan-m/everything-claude-code) informed several rules and specialist agents.
- [oh-my-pi](https://github.com/can1357/oh-my-pi) informed the earlier guardrail architecture before its retirement.
- [pi](https://pi.dev) is the second supported harness.

See individual `ATTRIBUTION.md` files and ADRs for implementation-specific history.

## License

MIT — see [LICENSE](LICENSE).
