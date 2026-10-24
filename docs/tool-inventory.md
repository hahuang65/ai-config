# Tool inventory

## Approved replacement — implementation in progress

The user selected a smaller executable surface after reviewing the baseline below.
Public commands remain symlinks to built binaries in the installed source, preserving visible provenance; private helpers remain in that source with no shell PATH aliases.

| Surface | Executable / source | Intended role |
| --- | --- | --- |
| `~/.local/bin/review-change` | `tools/evaluation/target/release/review-change`; [source](../tools/evaluation/src/change_main.rs) | Public source review via one optional subject; human publication is confirmed in the report. |
| Source-local `review-artifact` | `tools/artifact-review/target/release/review-artifact`; [source](../tools/artifact-review/src/main.rs) | Bundled-Pele SVG authoring, browser feedback, local repair decisions, and editable inline PR publication. |
| Source-local `consult` | `tools/evaluation/target/release/consult`; [source](../tools/evaluation/src/consult_main.rs) | Harness-invoked specialist advice, including before a change exists. |

WT and WL retain their existing alias pairs and targets listed below.
WT's Rust executable also prints manual [Bash completion setup](../tools/worktree/README.md#bash-completion) for `wt` and `worktree`, with read-only current-project task-name lookup.
Installation owns standard per-user completion entries for both names, discovered by an existing `bash-completion` loader without another installed executable or shell-startup ownership.
The agreed installer is `install.sh` alone, not a wrapper around a Rust/Python installer.
The `ai-config` executable has been removed and its fixture consumers now invoke the shell installer.
The separate WT Python installer has also been removed; component Makefiles still cannot install or uninstall package links.
The generic `evaluation` executable and Rust installation library are removed; the shared restricted runner remains internal, with a test-only process driver.
The user explicitly retired unrecorded legacy adoption; version-one and version-two recorded upgrades remain supported.
See [ADR 0041](adr/0041-retire-unrecorded-installation-adoption.md) and the [coverage migration](../test/installer-migration.md).
The current installation contract is [manifest.json](../manifest.json), validated by the shell installer and [JSON catalogue](../tools/install/manifest.jq).
`install.sh` now performs the transaction itself, using JSON-only filters under `tools/install/` rather than invoking an installer binary.
The platform prerequisites are mise, jq, GNU coreutils, make, Bash, iconv, and find; missing checked commands produce a clear error before provisioning or building.
Explicit installation runs `mise install` against active configuration, then `mise exec -- make build`; Cargo may fetch locked dependencies.
Build/test SDK lookup and footer bundling discover a pre-installed Pi on absolute PATH entries, skipping mise shims without executing them; Pi installation and updates remain outside this package.
Cargo-generated catalogue executables may have multiple hard links, but still require safe parents, regular non-symlink files, size bounds, and execute permission.
The shell installer uses an atomic lock directory and retains private recovery files when rollback cannot safely restore concurrent edits.
It is not crash-atomic, and its lock must not be bypassed or combined with stale Rust installation binaries retained in other checkouts.
Orchard, agentmemory, and the old review-publication service are selected for retirement, with cross-repository changes and protected live cleanup handled separately.
Existing worktrees, private histories, retained review formats, and publication reconciliation must be preserved.
Human CLI ergonomics use `review-change [SUBJECT]`; PR comments are edited and selected inline, then confirmed with one Publish action below the document.
See [ADR 0042](adr/0042-use-simple-review-subjects-and-browser-publication.md) for subject selection and [ADR 0043](adr/0043-separate-pr-publication-from-local-repairs.md) for publication.
The artifact helper links the review library for signed previews, locks, receipts and reconciliation; it does not introduce another executable or revive the retired publisher.
No live installation has been changed by this task.

## Baseline inventory

The following records the pre-pruning source and installation observations, not the final replacement surface.
Inventory alone was not approval to remove, install, enable, or consolidate anything.
It covers this package's executable entry points, installed aliases, model-callable tools, and the host and external surfaces that can be confused with them.
The [harness inventory](harness-tool-inventory.md) covers Claude, Pi, language servers, MCP, and resources that are not tools.
The broader [harness contracts catalogue](harness-contracts.md) and [new-harness checklist](new-harness-checklist.md) cover the non-tool surfaces and conformance requirements from that follow-up.

## Scope and evidence

Source baseline: `13cad372b1da00ad8c57025951065cecf0e56d63`, inspected on 2026-10-15.
At that baseline, `manifest.json` was checked by `tools/evaluation/src/configuration/package.rs` and `package_catalogue.rs`; those historical source files are now removed.
Source references below describe that checkout, not a promise that an existing executable was rebuilt from it.

Use the existing [domain terms](../CONTEXT.md#core-concepts): a **Tool** is a model-callable operation exposed by a harness; an **Agent-facing CLI** is an executable consumed through the shell tool.
A shell command, slash command, skill, hook, and model tool are not interchangeable categories.
An executable earns its place here when it implements an operation, state boundary, or reusable automation interface—not simply because a prompt mentions its name.

There are **four Rust crates producing six binaries**, **six installed CLI names pointing to four binaries**, and **one package-added ordinary Pi tool**.
The `evaluation` crate produces `evaluation`, `review-change-eval`, and `ai-config`; counting crates as executables misses two entry points.
The host tool set is version-, model-, configuration-, and session-dependent.
No provider model call, MCP connection, credential read, old Work log query, or live installation was used to collect this inventory.

## Installed agent-facing CLIs

All six names below are shell entry points available to either harness and to a human terminal.
They do not add six model tool declarations.
Paths in the executable column are relative to the selected package source.
Skills resolve the replacement-owned executable from their own absolute source rather than trusting an unrelated command on `PATH`.

| Installed name | Executable | Purpose and why a CLI | Invocation and source |
| --- | --- | --- | --- |
| `~/.local/bin/wt` | `tools/worktree/target/release/wt` | Git task-worktree lifecycle and integration checks need one harness-independent implementation. | Human shortcut: `wt list --json`; [Rust entry](../tools/worktree/src/main.rs), [contract](../tools/worktree/README.md). |
| `~/.local/bin/worktree` | `tools/worktree/target/release/wt` | Agent-facing spelling of the same operation, not another implementation or state store. | `worktree new TASK --json`; same WT executable and contract. |
| `~/.local/bin/wl` | `tools/worklog/target/release/wl` | Append-only task records and bounded queries need durable behavior outside a conversation. | Human shortcut: `wl list --state open --all --json`; [Rust entry](../tools/worklog/src/main.rs), [contract](../tools/worklog/docs/cli.md). |
| `~/.local/bin/worklog` | `tools/worklog/target/release/wl` | Agent-facing spelling of the same work log, not a second reminder system. | `worklog progress --task ID 'Summary' --json`; same WL executable and private store. |
| `~/.local/bin/artifact-review` | `tools/artifact-review/target/release/artifact-review` | Browser feedback, durable cursors, and revision-bound decisions require a runtime, not prompt prose. | `artifact-review open FILE`, then `artifact-review wait FILE --cursor N`; [Rust entry](../tools/artifact-review/src/main.rs), [contract](../tools/artifact-review/README.md). |
| `~/.local/bin/review-change-eval` | `tools/evaluation/target/release/review-change-eval` | Freeze source, run a restricted reviewer, retain evidence, and keep publication separate from review. | `review-change-eval --root SOURCE review local --repo REPO --intent TEXT --engine pi --json --no-browser`; [Rust entry](../tools/evaluation/src/change_main.rs), [contract](review-change-cli.md). |

### Operations and boundaries

| CLI | Operations | Effects and limits |
| --- | --- | --- |
| WT | `new`, `enter`, `list`, `clean`; adapter `session` protocol | `new` can fetch the configured integration branch and creates a task branch/worktree; `enter` only selects it; `list` observes Git inventory; `clean --check` checks eligibility, while `clean` can remove an integrated worktree and safely delete its local branch. Session operations store harness-specific conversation references, not transcripts. Neither shell entry point moves a running harness by itself. |
| WL | `note`, `start`, `progress`, `commit`, `complete`, `abandon`, `correct`; `list`, `history`, `projects` | Lifecycle commands append private records; queries derive state without rewriting history. No scheduler, background wakeup, or automatic import. The current store is distinct from retired Work log implementations; inventory work must not query or import their history. |
| artifact-review | `open`, `wait`, `poll`, `stop`; internal `_serve` | `open` starts/reconnects a local server and normally opens a browser; `--findings REPORT.json` binds finding decisions. `wait` renews transport holds indefinitely; `poll` is bounded compatibility behavior. `stop` stops serving without approval or event deletion. `_serve` is the internal daemon entry, not an ordinary workflow command. |
| review-change-eval | `review local`, `review range BASE..HEAD`, `review pr URL`; `post REPORT` | Review captures immutable source and invokes a selected restricted Pi or Claude engine; it does not execute reviewed source. `post` is a separate provider mutation requiring real human terminal confirmation. There is no automatic engine fallback or permission to publish from a review result. |

Artifact-review Accept authorizes only the corresponding repair; Reject and undecided findings authorize none.
Review completion, silence, and `stop` are not approval, commit, delivery, installation, or publication authority.
The two review executables are complementary: one produces findings from source; the other collects a human's revision-bound feedback and decisions.
Their shared browser presentation is not evidence that either can replace the other.

## Built but not installed as command aliases

These are shell interfaces for either harness or a human, but the manifest creates no `~/.local/bin/evaluation` or `~/.local/bin/ai-config` link.
They are not hidden model tools.

| Binary | Source | Invocation | Purpose and why executable code |
| --- | --- | --- | --- |
| `evaluation` | `tools/evaluation/src/main.rs` (removed) | `tools/evaluation/target/release/evaluation [--root SOURCE] reviewer --snapshot DIR --prompt TEXT [--engine pi\|claude]` | Low-level restricted runner over an existing snapshot; shared process isolation, bounded output, diagnostics, and provider selection. Usually reached through higher-level review. |
| `evaluation` | [consult.rs](../tools/evaluation/src/consult.rs), [specialists](specialists.md) | `tools/evaluation/target/release/evaluation --root SOURCE consult --agent ROLE --repo REPO --prompt TEXT [--engine pi\|claude]` | Read-only specialist consultation with a bounded snapshot and explicit trusted role. Not the required HTML change review, not an automatic team, and not permission to edit. Model calls need explicit approval. |
| `evaluation` | `configuration_install.rs` (removed) | `tools/evaluation/target/release/evaluation --root SOURCE native-install [explicit historical paths]` | Retained adoption/migration entry point, including `--check` with complete historical path groups. Unlike the ordinary installer, it can explicitly adopt exact legacy resources. Do not run it as a test or routine installation shortcut. |
| `ai-config` | `tools/evaluation/src/bin/ai-config.rs` (removed) | `tools/evaluation/target/release/ai-config --root CANONICAL_SOURCE install` | Narrow ordinary installer: validates the selected package and delegates owned link/settings changes to the shared Rust transaction. Separate live-home authorization required. |

Both reviewer-facing binaries accept explicit Pi or Claude selection; the default engine is Pi, not automatic detection of the caller.
The workflow supplies the caller's engine when required.
For reviewer tool restrictions, see the [restricted-runner inventory](harness-tool-inventory.md#restricted-reviewers).

## What is the “install tool”?

There is **no package-registered model tool named `install`**.
Several executable surfaces have installation-related names, with different ownership and effects:

| Surface | Owner/type | What it does | Relationship |
| --- | --- | --- | --- |
| `./install.sh` | Package Bash entry point; [source](../install.sh) | Builds its own canonical checkout with offline `make build`, then runs that checkout's `ai-config --root ... install` against inherited absolute `HOME`. Help does neither. | Supported human installation entry point; not a competing installer implementation. |
| `ai-config ... install` | Package Rust CLI | Validates resources, manages owned symlinks/settings and the installation record, refuses conflicts, and uses the shared transaction/rollback machinery. Does not provision dependencies or services. | Implementation behind `install.sh`; keep the build wrapper and ownership engine distinct. |
| `evaluation ... native-install` | Retained package Rust migration CLI | Fresh/repeat installation plus explicit historical adoption and adoption preflight. | Real overlap with `ai-config`, but additional migration authority and compatibility tests make deletion a separate decision. |
| `tools/worktree/install.py` | Former Python reference installer; `tools/worktree/install.py` (removed) | Can create/remove only its own Python `wt` launcher link and refuses unrelated entries. | Not in the package manifest; retained with Python parity/reference code, not the production Rust installer. Not run for this inventory. |
| `make install` / `make uninstall` in WT or WL | Unsupported component targets; [test](../test/cli-links.test.ts) | Component Makefiles intentionally cannot install or remove Rust-owned links. | Not alternatives to the package installer. |
| `pi install SOURCE` | Upstream Pi package-manager command | Installs npm/Git/local Pi packages and changes user or project package declarations. | Not this repository's cross-harness installer, not a default model tool, and not permission to switch live links. |
| `claude install` | Upstream harness installation command | Installs/manages Claude Code itself according to its CLI. | Not ai-config resource ownership; do not confuse installing the harness with configuring it. |
| System `install`, package managers, or language installers | External shell programs | Copy files or provision software when explicitly invoked. | Shell dependencies, not extra model tools supplied by this package. |

The installer is justified because a collection of `ln -s` commands cannot express its ownership/conflict/settings-preservation contract.
The shell wrapper is justified because it builds the chosen checkout before invoking that contract.
A future consolidation could reduce installer entry points, but must preserve adoption authority, conflict refusal, rollback, and the live-home approval boundary.
This task makes no such change.

## Other executable support, not ordinary model tools

| Surface | Harness / invocation | Source and purpose | Why not count it as another tool |
| --- | --- | --- | --- |
| Guard adapters | Claude hook: `bun ~/.claude/hooks/guard.ts`; Pi extension load | [Claude](../harnesses/claude/guard.ts), [Pi](../harnesses/pi/guard-policies.ts), shared [policy registry](../guard/policy-registry.ts) | Event-driven enforcement around calls; no model-callable operation is registered. |
| WT Claude adapter | Claude lifecycle hooks: `bun ~/.claude/hooks/worktree.ts` | [Source](../harnesses/claude/worktree.ts), [transition contract](worktree-transitions.md) | Adapts native `EnterWorktree`/`ExitWorktree`; does not register another Claude tool. |
| Status displays | Claude status-line command; Pi extension load | [Claude](../harnesses/claude/statusline.ts), [Pi](../harnesses/pi/status-footer.ts) | Host-rendered session information, not a callable read/query tool. |
| Build script and Make targets | Developer shell: `make build`, `make lint`, `make test`, focused test targets | [Makefile](../Makefile), [tools/build-status-footer.mjs](../tools/build-status-footer.mjs), [tools/build-guard-parser.mjs](../tools/build-guard-parser.mjs) | Build/verification support, including locked local parser assets; not installed agent-facing CLIs or live installation. |
| Python WT implementation | Test/reference shell: `tools/worktree/bin/wt`; parity runner uses bounded workers | [Launcher](../tools/worktree/bin/wt), [reference package](../tools/worktree/wt/cli.py), [verification](../tools/worktree/docs/testing.md) | Compatibility oracle retained alongside Rust, not the installed WT implementation. |
| Fake providers, browser harness, test launchers | Disposable test homes and bounded test processes | [Test guide](../test/README.md) | Test-only executables; no ordinary installation or provider authority. |

## Installation observations, not source guarantees

Read-only observations on 2026-10-15:

- All six installed CLI links resolve into the primary source at `~/.dotfiles/ai`, not this task worktree.
  Across the full manifest, 67 links match their declared primary targets; the declared `~/.claude/commands/wt.md` link is missing.
  The `/wt` Claude prompt is therefore source-declared, not verified installed.
- The existing primary `artifact-review --help` lists `open`, `poll`, and `stop`, but not `wait`; `open --help` lacks `--findings`.
  The delivered source contains both features, so the existing release executable is behind the source contract described above.
- Symlinked Markdown, adapters, and checked-in bundles can change as primary source advances; already-built Rust binaries do not rebuild merely because Git advances.
  “Delivered locally” must not be read as “every live resource is on one rebuilt version.”
- No installed source link, settings file, release binary, service, or private store was changed to reconcile that difference.
  Building this task checkout is not installation; rebuilding the live source can replace binaries already targeted by live links and is not an inventory operation.
- An independent `~/.local/bin/orchard` exists outside this manifest; WT explicitly does not require it or adopt its worktrees.
  Existence is not proof it is unused elsewhere.

## Candidates for a later pruning decision

| Candidate | Evidence / recommendation | What must be checked before any change |
| --- | --- | --- |
| `evaluation native-install` versus `ai-config install` | Highest-value entry-point consolidation candidate: both reach shared installation code, but only the former carries explicit legacy adoption options. | Decide whether migration remains supported; preserve safety tests and ownership compatibility or explicitly retire them. |
| Python WT CLI and installer | Duplicate implementation is intentional compatibility evidence, not ordinary runtime dependence. | Decide when the parity oracle is no longer needed; retain regression coverage before deleting it. |
| `wt`/`worktree`, `wl`/`worklog` | Harmless alias pairs, not duplicate state or algorithms. Prefer keeping the human/agent spellings unless the user wants fewer names. | Update skills, manifests, validators, fixtures, and external callers together if removing an alias. |
| Public low-level `evaluation reviewer` versus higher-level review CLI | Shared runner is necessary; exposing two ways to start it may be optional. `consult` has a separate purpose. | Check independent consumers and diagnostic/test workflows; do not remove the shared restriction boundary. |
| Browser review versus source review | Keep both responsibilities; apparent overlap is presentation rather than authority. | Any unification must preserve source snapshots, durable human decisions, and separate publication. |
| Host task/planning/annotation features versus shared workflows | Potential workflow overlap, not proven implementation redundancy. Several Claude alternatives are already disabled. | Decide desired behavior across harnesses first; native session tasks are not the cross-project append-only work log. |
| Independent Orchard, legacy agentmemory configuration, unused cached plugins | Outside package ownership; presence alone proves neither active use nor redundancy. | Ask the owning configuration/user, inspect safely, and obtain separate removal authorization. Never start legacy services just to justify deletion. |

## Keeping the inventory honest

When adding a CLI alias, executable, registered tool, or tool-affecting integration, update the relevant row and source reference.
The package test checks manifest CLI coverage, the current Rust executable source layout, literal Pi registrations, and bare Claude denials; it is not proof of every dynamic host or MCP tool available in every project.
Use source/manifest evidence for owned surfaces, versioned host documentation for host tools, and clearly labelled local observations for installed state.
Never treat an absent observation or an uncontacted service as evidence that a tool can safely be removed.
