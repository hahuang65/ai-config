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
It validates targets before acquisition, snapshots local state, fetches mutable local branches only in isolation, or directly acquires an explicit GitHub repository without checkout.
It freezes the change to immutable commits, launches one foreground `pi` process as its AI backend, and remains read-only for every target.

```sh
review-change
review-change --intent "Preserve the public API while adding cache invalidation"
review-change feature/cache-invalidation --intent "Review this branch read-only"
review-change origin/feature/cache-invalidation --intent "Review the freshest branch descendant"
review-change main...HEAD --intent "Review this historical range read-only"
review-change pull/123 --intent "Validate the pull request against its stated intent"
review-change 123 --intent "Validate the pull request against its stated intent"
review-change 'https://github.com/acme/app/pull/123/changes?diff=split#discussion'
review-change gh:acme/app/pull/123
review-change https://github.com/acme/app/tree/feature/cache-invalidation
review-change gh:acme/app/tree/feature/cache-invalidation
review-change gh:acme/app/pull/123 --sandbox
review-change main...HEAD --provider openai --model gpt-5 --thinking high
```

With no target, the CLI requires a local Git repository, resolves its current branch pull request or branch point, then snapshots the current working state for review.
An explicit local target can be a local branch, `origin/<branch>`, or a Git range.
It can also be `pull/<number>` shorthand or a bare number from 1 through 2147483647; an exact local branch wins before either shorthand form.
Shorthand selects the GitHub origin, or the only GitHub remote when `origin` is not GitHub, and stops if no unique GitHub remote exists.
Remote discovery accepts only a documented GitHub SSH or HTTPS remote with no credentials, normalization-sensitive raw path segments, or a non-default port.
An explicit GitHub pull-request target can be a URL with an optional suffix, query, or fragment, such as `https://github.com/owner/repository/pull/59/changes?diff=split#discussion`, or the exact `gh:owner/repository/pull/59` identifier.
Every browser target requires the canonical GitHub HTTPS origin without credentials, a nonstandard port, or endpoint ambiguity.
An explicit GitHub branch target can be a `tree/<branch>` URL or the exact `gh:owner/repository/tree/feature/branch` identifier, including a slash-bearing branch name.
For a tree URL, Review change resolves the longest existing branch prefix before any repository path suffix; `gh:` identifiers reject URL suffixes, queries, and fragments.
A mutable local branch requires an isolated fetch from its configured matching remote, whose name it captures before isolation.
Review change reads that remote URL as one raw Git output record, removes only one terminator, and rejects every remaining C0, C1, or DEL control before URL normalization or fetch.
It configures the credential-safe URL in the workspace, selects the descendant of the local and fetched matching-remote tips, and uses the fetched repository default branch from that remote as its base.
Before child evidence, the parent materializes that exact selected local head in the disposable workspace and replays the source snapshot's captured tracked patch and untracked files.
Untracked replay rejects a symbolic link in every destination ancestor, verifies each existing parent resolves beneath the workspace, and uses no-follow exclusive file handles with replacement checks where Node permits.
It preserves only captured relative symbolic links whose lexical target stays inside isolation.
A replay conflict, unsafe symbolic link, path replacement, or unsafe untracked path stops with corrective cleanup instead of running stale evidence.
Explicit `origin/<branch>` continues to use `origin`; diverged tips or fetch failure stop resolution, while an immutable explicit range does not fetch, depend on origin availability, or rematerialize.
Every explicit GitHub pull-request or branch target directly acquires its named repository without checkout regardless of the current directory and therefore works outside a Git repository.
For a direct branch target, the parent strictly resolves read-only provider `id` and canonical `nameWithOwner` metadata before cloning.
After the no-checkout clone, it queries that immutable provider node ID for current canonical metadata plus selected and default branch OIDs, then requires exact equality with the clone's corresponding OIDs.
Git transport cannot attest clone repository node identity, so this is content equivalence, not cryptographic repository-ID binding.
An A→B→A name-reuse race is safe when both OID pairs match; any provider failure, malformed response, missing ref, ID mismatch, or OID mismatch fails closed and cleans only recorded paths.
The requested identity only selects acquisition, and post-acquisition canonical provider metadata supplies `headRepository`.
Direct-branch A5 classification occurs only after these checks.
The frozen range uses only the verified selected/default OIDs, and materialization receives only the exact selected OID, so unrelated clone refs cannot influence scope, trust, or execution.
A directly acquired remote change is Untrusted by default and remains unmaterialized and unexecuted.
`--trust-remote` explicitly trusts one direct GitHub target; A5 trust applies only when effective global or system Git configuration classifies the canonical SSH identity from immutable-ID provider metadata, and repository-local configuration cannot grant trust.
The parent runs A5 classification in a recorded base-independent temporary Git context outside the acquired repository and removes exactly that context.
`--sandbox` selects the documented sandbox route only when the standalone process already runs inside the documented sandbox.
The sandbox runtime must set `REVIEW_CHANGE_SANDBOX=review-change-gondolin-v1` and provide the immutable root-owned marker `/run/review-change/sandbox-v1` with the same version line.
The parent verifies the signal, marker ownership, permissions, exact path, and content before exact-OID materialization; the sandbox flag alone is not general trust outside that environment.
Every mode remains read-only.
Review-owned clones and worktrees live under `~/.review-orchard/`, separate from development worktrees under `~/.orchard/`.
Provider, model, and thinking overrides pass directly to `pi` as argument-array values rather than through a shell; the selected model also reaches mandatory Review change subagents.
In a sufficiently wide TTY, the CLI displays a color-coded left-right view: the pipeline occupies the left pane and the selected stage log occupies the right pane; narrow terminals retain the stacked layout.
Stage states and log outcomes use distinct terminal colors, with `NO_COLOR` support for monochrome output.
Each pipeline stage lists its purpose and recorded sub-stages vertically beneath it with a live or completed elapsed timer beside every sub-stage, shortening left-pane sub-stage labels to at most six words while retaining the bounded original telemetry text in the navigable, credential-redacted right-pane log alongside observable lifecycle actions, commands, durations, and outcomes.
Collected Findings, missing evidence, documentation issues, and similar results appear as one concise line per item beneath their sub-stage; successful completion text is not repeated in the sidebar.
The header keeps the isolated review worktree path, immutable scope, risk, and open Findings visible.
Resolve target and Create isolation use concise pipeline outcomes rather than repeating the GitHub URL, workspace path, report path, or untracked-file details already available in the header and selected-stage log.
Cleanup remains pending while the full-screen Summary keeps the isolated review worktree and full log available.
After dismissal, the parent restores the terminal, closes telemetry, removes exactly that worktree, and reports the final Cleanup outcome outside the Summary as `Removed` on success.
The parent validates ordered stage telemetry, shows each active sub-stage as the current operational intent, retains prior sub-stages as `STEP` log entries, owns cancellation through final Summary dismissal, latches interruption while initial Glow rendering is pending, restores terminal state after interruption, and uses plain status lines when output is redirected.
Vim-style `j`/`k` navigates stages, Ctrl-D/Ctrl-U scrolls the selected log, Enter expands or collapses lines, `f` resumes following the active stage, and Ctrl-C aborts an active run; no single-character key aborts or closes the review.
After validation, it opens the disposable HTML report in a new Firefox window on macOS (or the platform HTML viewer elsewhere) without waiting for browser closure and includes a copyable general review comment plus separately copyable inline Finding comments inside pull-request reports, with exact locations, a severity/action legend, inset copy icons, and persistent copied-state styling.
On a successful interactive run, the parent renders its own and the assistant’s Markdown through non-interactive Glow when available, forces color when terminal color is enabled, and selects a final Summary stage within the existing pipeline/log layout rather than replacing it with a full-screen summary.
That Summary rerenders after terminal-width changes.
Glow failure or a Summary pane narrower than 20 columns falls back to the built-in renderer, Ctrl-U and Ctrl-D scroll the final log, and Ctrl-C exits once the review is no longer running; `q`, `x`, and Escape do not dismiss it.
Redirected output prints the same summary normally.
Standalone Review change does not invoke `review-artifact`, poll for feedback, or require approval.
A disabled push URL plus the CLI-specific pi guard protect the original checkout and block structured writes, common direct mutation, staging, commits, pushes, and provider mutations.
Structured writes are allowed only inside a dedicated report directory whose resolved path is validated not to overlap the source checkout or clone.
Run `review-change --help` for all options, accepted inputs, trust controls, and terminal controls.

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

Pi uses the Catppuccin Mocha theme and gives successful `Edit` and `Write` tool rows a yellow background.
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
