# Harness contracts and implementation inventory

This is the source-level catalogue for Claude Code and Pi, beyond their model tools.
Use the [new-harness checklist](new-harness-checklist.md) to implement another harness.
The [tool inventory](tool-inventory.md) and [harness tool inventory](harness-tool-inventory.md) remain the detailed executable and host-tool catalogues from task #129.
This document completes the wider inventory requested by task #158; it does not authorize refactoring, feature changes, installation, or retirement.

## Evidence and authority

Inspected source: `cb683c00089ca721348362f66fb68fe73fc1669d`, on 2026-10-19.
The tables describe source and its verification suites, not a fresh audit of installed links or effective live settings.
The clarification and [session-checklist](session-checklist.md) entries reflect subsequent source changes checked against Pi 1.3.0.
The [native specialist](native-specialists.md) and verification-workflow entries reflect later source work with Pi 1.4.0 and synthetic child-model tests.
The earlier tool inventories retain explicitly dated pre-pruning observations; their historical executable names are not current entry points.
Pi's installed 1.3.0 extension, configuration, settings, skills, prompt, theme, SDK, and TUI documentation was also consulted.
The native WT contract records its original Pi 1.1.0 and Claude 2.1.296 API checks; this inventory does not claim a new live Claude smoke test.
No credentials, old Work log history, MCP services, or real language servers were inspected or contacted for this catalogue.

[README](../README.md), [baseline](../baseline.md), [manifest](../manifest.json), and current component contracts define the package today.
Historical ADRs explain trade-offs, not permission to restore retired designs.
In particular, ADR 0010's discovery-disable scheme is historical: ordinary discovery stays enabled, while dedicated reviewers are restricted.
The [context glossary](../CONTEXT.md) distinguishes a harness, Tool, agent-facing CLI, skill, command, advisory rule, and guardrail policy.

## Shared interfaces and legitimate differences

| Concern | Required shared outcome | Claude implementation | Pi implementation / limit |
| --- | --- | --- | --- |
| Instructions | Same small bootstrap and on-demand rules, resolved beside its absolute symlink target. | `~/.claude/CLAUDE.md`; Claude-only shell guidance. | `~/.pi/agent/AGENTS.md`; host discovers directory context files. |
| Ordinary discovery | Retain normal personal/project discovery and trust behavior; owned resources must not link into the sibling module. | Native commands, skills, agents, plugins, and project context. | Native skills, templates, extensions, themes, and context; project trust is host-owned. |
| Workflow invocation | Same intent and authorization boundaries, not identical slash syntax. | Native skill discovery/invocation; commands for compositions. | Automatic skill matching or `/skill:NAME`; `/deliver` and `/rebase` templates. |
| Model tools | Native read/edit/write/shell operations subject to guards; inventory conditional tools honestly. | Native tool identifiers and permission system. | Native lower-case identifiers; package adds `worktree_transition`, `lsp`, `ask_user_question`, `todo`, and the guarded `subagent` facade. |
| Enforcement | Same registry and detection core with native refusal semantics. | Tier B command hook plus static permissions. | Tier A in-process `tool_call` handler; bundled dependencies. |
| Task conversations | New carries, existing resumes, verified destination tools/context before edits. | `EnterWorktree`, keep-only `ExitWorktree`, WT hooks, native `/resume`. | Interactive `/wt` command uses `switchSession` and fresh context; model tool only prepares it. |
| Continuation | Exactly one destination turn after verified automatic transitions; no new authority. | Post-tool `additionalContext`; interactive `/resume` needs a manual `continue`. | Fresh-context `sendUserMessage`, no duplicate scheduling; print/RPC transitions unsupported. |
| Language servers | One catalogue, explicit provisioning, read-only client surface, explicit errors and trust limits. | Native `LSP` client with generated plugin. | Package stdio client, lazy query startup, disk synchronization, bounded transport. |
| Clarification | Requirements and preferences, never a replacement approval gate. | Native `AskUserQuestion` explicitly allowed; independent denials remain effective. | Model-only `ask_user_question`, native TUI/RPC select/input, explicit cancellation/unavailability, ordinary-chat fallback. [Contract](clarification.md). |
| Presentation | Catppuccin Mocha; two-row location/session and usage display without memory services. | Command status line; model/thinking right-aligned on row one. | TUI-only footer; model/thinking right-aligned on row two. |
| Specialist roles | Same trusted role intent; optional advice is not change-review evidence. | Native `Agent` can discover role files with read-only frontmatter. | Guarded `subagent` projects four canonical role bodies into read-only native children; `change-reviewer` stays restricted. [Limits](native-specialists.md). |
| Restricted review | Explicit caller-matching engine, frozen source evidence, read-only tools, no automatic engine fallback. | Independent safe/restricted subprocess, only `Read`, strict empty MCP config. | Ephemeral profile, ordinary discovery disabled, explicit snapshot-only reader and shared guard. |
| Human feedback | Same local browser review, revision-bound decisions, separate publication confirmation. | Native wake-up hooks attach and re-arm the shared queue; idle renewal can add maintenance turns. | Background native extension attaches the originating conversation, queues follow-ups, and acknowledges processing through the same helper. |
| Session progress | Optional current-task checklist, never a scheduler, competing specification, or approval record. | Prefer conditional native task-list tools; otherwise ordinary chat. | Model-only `todo`, read-only `/todos`, branch snapshots, bounded TUI widget, plain RPC/headless fallbacks. [Contract](session-checklist.md). |
| Work history | One append-only host-local Worklog store, project identity shared across worktrees. | Shared WL CLI, not native session task tools. | Same CLI/store, not session-tree entries or a scheduler. |

Native spelling, UI placement, usage accounting, and client capability differences are legitimate when documented and tested.
Silent omission of a language, safety boundary, approval requirement, or failed operation is not parity.
No guard non-denial, available tool, workflow completion, or transition notice grants user authorization.

## Complete owned-resource catalogue

[manifest.json](../manifest.json) lists exact destinations; [the installer catalogue](../tools/install/manifest.jq) independently validates the owned set.
The routes below are descriptive, not instructions to create links manually.
The same source supplies both harnesses wherever two routes are listed.

| Resource source | Installed route or role |
| --- | --- |
| [baseline.md](../baseline.md) | `.claude/CLAUDE.md`, `.pi/agent/AGENTS.md`. |
| [Claude guard](../harnesses/claude/guard.ts) | `.claude/hooks/guard.ts`; [normalization/verdict](../harnesses/claude/guard-verdict.ts) and [read-only GitHub shortcut](../harnesses/claude/read-only-github.ts) are source-local support. |
| [Claude feedback](../harnesses/claude/review-feedback.ts) | `.claude/hooks/review-feedback.ts`; shares the source-local [feedback client](../harnesses/review-feedback-client.ts) with Pi. |
| [Claude WT](../harnesses/claude/worktree.ts) | `.claude/hooks/worktree.ts`; shares [WT client](../harnesses/worktree-client.ts) with Pi. |
| [Claude status](../harnesses/claude/statusline.ts) | `.claude/statusline.ts`. |
| [Claude theme](../harnesses/claude/themes/catppuccin-mocha.json) | `.claude/themes/catppuccin-mocha.json`; host-specific theme schema. |
| [Claude LSP plugin](../harnesses/claude/plugins/ai-local-lsp) | `.claude/plugins/ai-local-lsp`; generated language-server-only plugin. |
| [Pi guard bundle](../harnesses/pi/guard-policies.bundle.ts) | `.pi/agent/extensions/guard-policies.ts`; authored in [guard-policies.ts](../harnesses/pi/guard-policies.ts). |
| [Pi feedback bundle](../harnesses/pi/review-feedback.bundle.ts) | `.pi/agent/extensions/review-feedback.ts`; authored in [review-feedback.ts](../harnesses/pi/review-feedback.ts), using the source-local [feedback client](../harnesses/review-feedback-client.ts). |
| [Pi WT bundle](../harnesses/pi/worktree.bundle.ts) | `.pi/agent/extensions/worktree.ts`; authored in [worktree.ts](../harnesses/pi/worktree.ts). |
| [Pi footer bundle](../harnesses/pi/status-footer.bundle.ts) | `.pi/agent/extensions/status-footer.ts`; authored in [status-footer.ts](../harnesses/pi/status-footer.ts). |
| [Pi LSP bundle](../harnesses/pi/lsp.bundle.ts) | `.pi/agent/extensions/lsp.ts`; authored in [lsp.ts](../harnesses/pi/lsp.ts) and its [client modules](../harnesses/pi/lsp). |
| [Pi clarification bundle](../harnesses/pi/ask-user-question.bundle.ts) | `.pi/agent/extensions/ask-user-question.ts`; authored in [ask-user-question.ts](../harnesses/pi/ask-user-question.ts). |
| [Pi checklist bundle](../harnesses/pi/todo.bundle.ts) | `.pi/agent/extensions/todo.ts`; authored in [todo.ts](../harnesses/pi/todo.ts) and [state/view modules](../harnesses/pi/checklist). |
| [Pi specialist bundle](../harnesses/pi/specialists.bundle.ts) | `.pi/agent/extensions/specialists.ts`; authored in [specialists.ts](../harnesses/pi/specialists.ts), with pinned source-local engine data and installed SDK peers. |
| [Pi specialist policy](../harnesses/pi/specialists/policy.json) | `.pi/agent/extensions/subagent/config.json`; owned read-only engine configuration, not adoption of an existing personal file. |
| [Pi Worklog bundle](../harnesses/pi/worklog.bundle.ts) | `.pi/agent/extensions/worklog.ts`; authored in [worklog.ts](../harnesses/pi/worklog.ts), with [out-of-band capture contracts](worklog-capture.md). |
| [Pi theme](../harnesses/pi/themes/catppuccin-mocha.json) | `.pi/agent/themes/catppuccin-mocha.json`; same palette intent, different schema. |
| [Deliver](../commands/deliver.md) | `.claude/commands/deliver.md`, `.pi/agent/prompts/deliver.md`. |
| [Rebase](../commands/rebase.md) | `.claude/commands/rebase.md`, `.pi/agent/prompts/rebase.md`. |
| [Claude WT prompt](../harnesses/claude/commands/wt.md) | `.claude/commands/wt.md`; guidance, unlike Pi's executable `/wt` handler. |
| [WT executable](../tools/worktree/target/release/wt) | `.local/bin/wt`, `.local/bin/worktree`; [source contract](../tools/worktree/README.md). Opt-in `shell-init bash` prints functions that change the calling shell directory for plain `enter`, never the harness session; no startup-file installation. |
| [WT Bash integration](../tools/worktree/src/shell.bash) | `.local/share/ai-config/bash/wt.bash`; installer-owned functions for a guarded loader in separately managed Bash startup configuration; no startup-file rewrite. |
| [WT Bash completion](../tools/worktree/src/completion.bash) | `.local/share/bash-completion/completions/wt`, `.local/share/bash-completion/completions/worktree`; discovered by an existing `bash-completion` loader without startup-file edits. |
| [WL executable](../tools/worklog/target/release/wl) | `.local/bin/wl`, `.local/bin/worklog`; [CLI contract](../tools/worklog/docs/cli.md). |
| [Review executable](../tools/evaluation/target/release/review-change) | `.local/bin/review-change`; [review contract](review-change-cli.md). |

All 18 shared skill directories have explicit routes below.
Their references and assets stay with the source directory; they are not independently installed tools.

| Skill source | Installed routes | Observable workflow and authorization boundary |
| --- | --- | --- |
| [3d](../skills/3d) | `.claude/skills/3d`, `.pi/agent/skills/3d` | Parameterized physical design, exports and reviewed evidence; computed checks do not prove physical fit or safety. |
| [coach](../skills/coach) | `.claude/skills/coach`, `.pi/agent/skills/coach` | AI-written failing test, user-owned implementation and selected repairs; verify and review. |
| [code](../skills/code) | `.claude/skills/code`, `.pi/agent/skills/code` | One failing behavior test at a time, smallest implementation, checks and change review; no implied commit. |
| [commit](../skills/commit) | `.claude/skills/commit`, `.pi/agent/skills/commit` | Focused staged scope, user template, checks, explicit commit authority; no automatic task completion. |
| [grill](../skills/grill) | `.claude/skills/grill`, `.pi/agent/skills/grill` | Clarify an idea collaboratively; discussion does not authorize implementation. |
| [handoff](../skills/handoff) | `.claude/skills/handoff`, `.pi/agent/skills/handoff` | Selective private handoff outside Git; separate discovery and implementation identities, scoped evidence and next action; no transcript dump. |
| [mockup](../skills/mockup) | `.claude/skills/mockup`, `.pi/agent/skills/mockup` | Self-contained interactive design and browser feedback; design approval is not implementation authority. |
| [model-domain](../skills/model-domain) | `.claude/skills/model-domain`, `.pi/agent/skills/model-domain` | Local context files and Markdown ADRs for agreed terms, relationships and significant decisions; classification affects A5 privacy only. |
| [pickup](../skills/pickup) | `.claude/skills/pickup`, `.pi/agent/skills/pickup` | Select by implementation identity, verify target state and restate scope; discovery mismatch alone needs no confirmation, and pickup does not automatically resume work. |
| [plan](../skills/plan) | `.claude/skills/plan`, `.pi/agent/skills/plan` | Small verifiable tasks, dependencies and evidence; plan approval does not start implementation. |
| [prototype](../skills/prototype) | `.claude/skills/prototype`, `.pi/agent/skills/prototype` | Bounded marked experiment with explicit limits, not production implementation. |
| [resolve-conflicts](../skills/resolve-conflicts) | `.claude/skills/resolve-conflicts`, `.pi/agent/skills/resolve-conflicts` | Resolve and stage an already-running rebase, preserve both intents, continue and review; never start a merge/rebase. |
| [review-artifact](../skills/review-artifact) | `.claude/skills/review-artifact`, `.pi/agent/skills/review-artifact` | Local browser annotations, artifact approval, finding decisions, and human-confirmed PR publication remain distinct. |
| [review-change](../skills/review-change) | `.claude/skills/review-change`, `.pi/agent/skills/review-change` | Explicit scope/intent, current-harness restricted runner, immutable reports and selected repairs. |
| [spec](../skills/spec) | `.claude/skills/spec`, `.pi/agent/skills/spec` | Grounded HTML behavior/scope/testing specification and browser review; not an automatic implementation phase. |
| [visualize](../skills/visualize) | `.claude/skills/visualize`, `.pi/agent/skills/visualize` | Grounded self-contained explanation or comparison; not change review or implementation authority. |
| [work-log](../skills/work-log) | `.claude/skills/work-log`, `.pi/agent/skills/work-log` | Reminders, starts, synthesized progress and established outcomes in WL; no scheduling or old-history import. |
| [worktree](../skills/worktree) | `.claude/skills/worktree`, `.pi/agent/skills/worktree` | Verify native task entry before writes; cleanup needs explicit authority or successful authorized local delivery. |

All five role sources and their routes are listed below.

| Role source | Installed routes |
| --- | --- |
| [api-designer](../agents/api-designer.md) | `.claude/agents/api-designer.md`, `.pi/agent/agents/api-designer.md` |
| [change-reviewer](../agents/change-reviewer.md) | `.claude/agents/change-reviewer.md`, `.pi/agent/agents/change-reviewer.md` |
| [database-reviewer](../agents/database-reviewer.md) | `.claude/agents/database-reviewer.md`, `.pi/agent/agents/database-reviewer.md` |
| [fact-checker](../agents/fact-checker.md) | `.claude/agents/fact-checker.md`, `.pi/agent/agents/fact-checker.md` |
| [frontend-architect](../agents/frontend-architect.md) | `.claude/agents/frontend-architect.md`, `.pi/agent/agents/frontend-architect.md` |
Read-only frontmatter for ordinary role discovery is not the dedicated runner's frozen-snapshot boundary.
See [specialists](specialists.md) for source-local `consult` and explicit model-call approval.

Other source-local support is not an installed destination: [advisory rules](../rules), [guard core](../guard/guard-core.ts), [policy registry](../guard/policy-registry.ts), [parser assets](../guard/vendor), [server catalogue](../language-servers.json), [reviewer instructions](../reviewer.md), and [Pi review scope](../harnesses/pi/review-scope.ts).
The source-local `review-artifact` and `consult` binaries have no PATH aliases.
Build scripts, JSON filters, test providers and Python WT parity code are development support, not more ordinary model tools.

## Complete managed-settings catalogue

These are manifest-owned paths, not a claim that all other settings are absent.
Value ownership replaces only the declared key; array-entry ownership preserves unrelated entries.
The exact permission patterns remain in the [manifest](../manifest.json) and [permissions catalogue](../tools/install/permissions.json), not a second hand-maintained copy here.

| Destination | Owned paths | Intent and difference |
| --- | --- | --- |
| `.claude/settings.json` | `hooks.PreToolUse` | Array entries: WT verification (15s) and shared guard command (10s). |
| `.claude/settings.json` | `hooks.PostToolUse` | WT entry/exit verification and continuation, matcher `EnterWorktree\|ExitWorktree` (15s), synchronous feedback workspace focus (10s), plus asynchronous feedback attachment/listening (3600s). |
| `.claude/settings.json` | `hooks.SessionStart`, `hooks.Stop` | Synchronous SessionStart workspace focus (10s), asynchronous feedback listening with native wake-up on delivery or 55-minute renewal (3600s hook limit), and a synchronous Stop reply before the next user prompt (10s). |
| `.claude/settings.json` | `hooks.UserPromptSubmit`, `hooks.SessionEnd`, `hooks.StopFailure` | Abandon interrupted feedback claims without marking them answered (10s). |
| `.claude/settings.json` | `hooks.WorktreeCreate`, `hooks.WorktreeRemove` | WT creation (120s), block native cleanup (15s). |
| `.claude/settings.json` | `theme` | `custom:catppuccin-mocha`. |
| `.claude/settings.json` | `statusLine.type`, `statusLine.command` | Command renderer via Bun; no transcript or memory-service reads. |
| `.claude/settings.json` | `disableArtifact`, `disableBundledSkills`, `disableClaudeAiConnectors`, `disableRemoteControl`, `disableWorkflows` | All true; prefer owned local artifacts/workflows without disabling ordinary resource discovery. |
| `.claude/settings.json` | `enabledPlugins.lua-lsp@claude-plugins-official`, `enabledPlugins.bash-language-server@claude-code-lsps`, `enabledPlugins.terraform-ls@claude-code-lsps`, `enabledPlugins.gopls-lsp@claude-plugins-official` | All false; avoid duplicates of the shared plugin, do not delete caches or unrelated plugins. |
| `.claude/settings.json` | `env.CLAUDE_CODE_PLUGIN_DIRS` | `~/.claude/plugins/ai-local-lsp`; shared catalogue projection. |
| `.claude/settings.json` | `permissions.deny` | Entries cover destructive/cloud/deploy/shell writes, Git push/publish, credentials, and selected host features; native restrictions can exceed shared guards. |
| `.claude/settings.json` | `permissions.ask` | Git clean and environment/key-file access patterns; an ask rule never overrides a shared refusal. |
| `.claude/settings.json` | `permissions.allow` | Declared context/ADR/feature reads, edits, Git message read, and native `AskUserQuestion`; not action authorization or artifact approval. |
| `.claude/settings.json` | `permissions.additionalDirectories` | `~/.claude`, `~/.config`, `~/.dotfiles`, `~/Projects/a5`, `/tmp`; access scope is not action approval. |
| `.pi/agent/settings.json` | `theme` | `catppuccin-mocha`; no package-owned model, auth, tool-selection, MCP, or trust settings. |

Claude's denied host identifiers are fully listed in the [tool inventory](harness-tool-inventory.md#claude-code), including the unverified defensive `DesignSync` name.
Disabling Claude.ai connectors does not disable all independent MCP servers.
Pi does not emulate each Claude feature flag; absence of a package-installed equivalent is not a host-wide prohibition.
Neither harness's login, chosen model/thinking, saved conversations, project trust, personal keybindings, or independent integrations are adopted by this package.

## Safety contracts and policy coverage

The normalization interface is [ToolCall](../guard/guard-core.ts): tool identity, command, path, glob pattern, changed content, working directory, and safely resolved home.
Map every new tool's relevant fields before claiming coverage; matching a familiar name alone is insufficient.
Claude emits `permissionDecision: deny`; Pi returns `block: true`.
Claude's syntax-checked read-only GitHub shortcut runs only after shared evaluation and is not publication authority.
The shell parser fails closed without a text fallback; [command guard limits](command-guards.md) define syntax budgets, cleanup exceptions, and intentional gaps.

Every registry policy currently has violation and benign-near-miss checks through both native adapters in `test/package-guard.test.ts`.
The matrix is a readable index of that evidence, not proof against arbitrary same-user code.
A = Pi's programmable adapter; B = Claude's command-hook adapter.
Both pass those representative probes even for the two non-floor policies today.
This is adapter-probe coverage, not proof that every native tool schema forwards every required field.

| Policy ID | Mandatory floor | Claude | Pi |
| --- | --- | --- | --- |
| `no-uninspectable-shell` | Yes | B | A |
| `no-secret-access` | Yes | B | A |
| `no-review-publication-credential-access` | Yes | B | A |
| `no-hardcoded-secret` | Yes | B | A |
| `no-shell-write` | No | B | A |
| `no-html-transform` | No | B | A |
| `no-git-destructive` | Yes | B | A |
| `no-curl-pipe-shell` | Yes | B | A |
| `no-broad-rm` | Yes | B | A |
| `no-recursive-delete` | Yes | B | A |
| `no-sudo` | Yes | B | A |
| `no-cloud-destroy` | Yes | B | A |
| `no-deploy` | Yes | B | A |
| `no-db-mutation` | Yes | B | A |
| `no-dd-disk` | Yes | B | A |
| `no-unsafe-termination` | Yes | B | A |
| `no-host-shutdown` | Yes | B | A |
| `no-disk-format` | Yes | B | A |
| `no-broad-chmod` | Yes | B | A |

A future harness must enforce the floor at tier A/B/C/D or be sandboxed or rejected.
Tier E guidance alone is not enforcement; non-floor gaps must be explicit and reviewed.
Native static permissions are defense in depth, not a complete translation of the registry.
New MCP operations, alternate tools, scripts and language-server internals are not automatically covered by shell/path matching.
The guard, resource ownership, and project trust are not operating-system sandboxes.

## State, workflows, and approval boundaries

| Boundary | Contract and canonical detail |
| --- | --- |
| Repository edits | Named task branch and verified task worktree; no stash/move/copy workaround for dirty state; keep the `~/.dotfiles` parent on main. The narrow direct-checkout exception needs the user's up-front choice to edit one self-contained change. Direct-checkout edit approval does not authorize staging or commits. Commit authorization is separate and may come later. [Baseline](../baseline.md). |
| WT persistence | Separate per-harness saved conversation references in Git administrative metadata, not transcripts, PID ownership or session locks. Respect explicit Git locks. Verify cwd, branch, repository and conversation. [Native transitions](worktree-transitions.md). |
| Return and cleanup | Leave carries the current conversation without removal. Cleanup follows a verified native return and repeated WT safety checks. No automatic cleanup at task end; local integration proof controls local branch deletion. [WT contract](worktree-transitions.md#saved-references-and-recovery). |
| Delivery | Explicit `/deliver` authorizes its selected commit/rebase/check/integration and safe post-local-integration cleanup, never an implied push. A needed authorized review may run without duplicating a current review. Commits always check; exact current commit verification is reusable, while a real rebase requires fresh checks before integration. Local default, explicit `wt.delivery` override, A5 GitHub default. [Command](../commands/deliver.md). |
| Rebase | Exact verified local integration tip; no implicit fetch/push/integration/cleanup. Existing conflicts use the rebase-only skill. A needed provider review requires scope-specific approval if not already authorized. [Command](../commands/rebase.md). |
| Worklog | `~/.worklog/` shared across projects/worktrees; `WL_ROOT` is an explicit alternate store, never an empty-query workaround. Append corrections, do not edit history. Log established outcomes and continue authorized work. Empty [skill](../skills/work-log/SKILL.md), bare `wl`, and Pi `/worklog` list all incomplete work; `/worklog REQUEST` uses the existing Jev classifier to capture clear reminders without a conversation-model turn or extra completion. Other requests and uncertain classifications go to the skill after current work. [Capture contract](worklog-capture.md). |
| Handoffs | Private files outside Git; [version-two metadata](../skills/handoff/references/format.md) separates discovery provenance from intended implementation identity and checkout state. Pickup by path, topic, or newest eligible match uses the implementation identity without a redundant discovery-project confirmation. Genuine target/checkout/branch mismatches, uncertain metadata, reference origins, and current authority remain checked; version one retains its single-project rules. Historical approval is not new authorization. [Handoff](../skills/handoff/SKILL.md), [pickup](../skills/pickup/SKILL.md). |
| Domain documentation | Every project and linked worktree uses local context files and Markdown ADRs. A5 projects keep these files private and never stage the protected documentation paths. A5 status requires effective global/system Git configuration, never repository-local self-classification. [Model-domain](../skills/model-domain/SKILL.md), [documentation rule](../rules/documentation.md), [A5 rule](../rules/a5.md). |
| Restricted review | Whole-task scope from recorded start, explicit intent, no executing reviewed code, current-host engine, immutable evidence/report, failed/unavailable review is incomplete. Consultation is separate optional advice. [Review CLI](review-change-cli.md), [specialists](specialists.md). |
| Artifact approval | Local HTML review; current rendered revision and supported image evidence are checked. Native background delivery returns control while review remains open; closed conversations retain feedback, and claimed events retain revision checks. Never manufacture approval. [Artifact skill](../skills/review-artifact/SKILL.md), [runtime contract](../tools/artifact-review/README.md). |
| Local repair decisions | Accept authorizes that exact retained finding only, with revision/digest/source checks. Reject, undecided, all-decided, and whole-document approval do not grant wider repair/commit authority. New changed-state review gets a new immutable report. [Finding contract](review-change-cli.md#finding-decisions-and-repairs). |
| PR publication | No repair controls. Human selects/edits verified inline comments and clicks Publish after inspecting exact content, destinations, account and PR. COMMENT only; uncertain attempts reconcile the same report without resubmission. Never simulate confirmation. [Publication contract](review-change-cli.md#retained-reports-and-publication). |
| Installation | `install.sh` alone owns provisioning/build, manifest validation, links/settings, private ownership record, lock and handled-failure rollback. No unrecorded adoption, automatic lock breaking, or silent concurrent-edit overwrite. Live-home installation and source switching need separate approval. [Install guide](../README.md#install). |

Review records default to `~/.local/state/ai-config/change-reviews`; installation ownership is separate at `~/.local/state/ai-config/installation.json`.
Signatures and local browser capabilities prevent ordinary mistakes but cannot prove human presence against arbitrary same-user programs.
No wrapper, browser decision, skill approval, checkpoint, or successful commit widens the authorized task.

## Lifecycle, packaging, and presentation guidelines

Use native host facilities for context, discovery, tool dispatch, session replacement and UI.
Keep shared policy and workflow intent outside harness adapters; adapters normalize transport, not duplicate business rules.
Prefer one shared skill over same-purpose command wrappers; reserve commands for useful aliases/compositions or privileged host operations.
A shared role file is not an invented subagent runtime.

Keep production CLIs in Rust and host adapters in their native integration language.
Bundle Pi extensions whose local imports the installed Node loader cannot resolve; edit source, then regenerate and verify bundles.
Keep loader-provided SDK dependencies external where required and ship guard parser assets/licenses locally.
Resolve source-local helpers from the installed skill/configuration source, never arbitrary PATH programs or a task checkout selected by reviewed input.

Initialize long-lived services only when needed, not merely because an extension factory loads.
Language servers start lazily; shutdown/reload/session replacement must release resources idempotently.
Pi footer rendering is TUI-only and disposes its branch listener.
WT transitions require interactive native transport; a shell cwd change is never proof of session entry or return.

Both displays sanitize untrusted terminal text and fit visible columns, including wide characters and narrow terminals.
Claude emits exactly two occupied rows with no trailing newline and reserves its existing four-column margin.
Host-owned footer badges remain outside that renderer.
Claude uses host status payloads, including effort/thinking state and fallback cache counts; Pi sums the selected conversation branch and uses native context usage.
The shared semantic display is not identical token accounting or billing evidence.
No memory service or transcript reading is needed for the Claude status line.

Provision fixed tools explicitly through mise; builds/tests never install or upgrade Pi.
Pi SDK discovery uses a pre-installed CLI on absolute PATH entries, skipping mise shims without invoking candidate programs.
Build only the task checkout during development; rebuilding the live source can replace binaries already targeted by installed links.
TypeSafe, Herdr, independent MCP/plugin resources and private histories remain separately owned.
Do not connect, adopt, delete, or enable them merely to demonstrate parity.

## Conformance evidence and known limits

The [test guide](../test/README.md) gives exact setup and bounded process/browser execution rules.
Run focused checks during iteration, then `make lint` and `make test`; `make build` is their explicit build surface, not installation.
These suite references identify checks to run, not a claim that every future environment has passed them.

| Contract | Existing evidence | What it does not establish |
| --- | --- | --- |
| Resource/settings ownership and installer isolation | `test/package-install-*.test.ts`, `test/cli-links.test.ts`, `test/package-agents.test.ts` | Live-home consistency, authority to install, or absence of independent resources. |
| Bootstrap, workflows and rule routing | `test/package-bootstrap.test.ts`, `test/package-instruction-routing.test.ts`, `test/package-skills.test.ts`, `test/package-commands.test.ts`, `test/resolve-conflicts.test.ts` | Model compliance with advisory prose. |
| Ordinary host discovery | `test/package-pi-discovery.test.ts`, `test/package-claude-discovery.test.ts` | Every conditional host/MCP tool or every other project's resources. |
| Guard boundary and bundle parity | `test/package-guard.test.ts`, `test/package-dangerous-commands.test.ts`, `test/package-guard-execution.test.ts`, `test/package-guard-parser*.test.ts`, `test/package-github-guard.test.ts` | An OS sandbox or exhaustive interpretation of scripts, aliases, external languages and races. |
| WT protocol and hooks | `tools/worktree/tests/cli.rs`, bounded Rust/Python parity, `test/package-worktree-client.test.ts`, `test/package-claude-worktree.test.ts` | Actual model continuation from a hook notification alone. |
| Native task runtime | `test/package-worktree.test.ts`, `test/package-claude-worktree-runtime.test.ts` | Automatic Claude interactive `/resume`; native interactive `/branch` and `/resume` still require human smoke checks. |
| Status and theme | `test/package-claude-statusline.test.ts`, `test/package-pi-footer.test.ts`, discovery and manifest tests | Identical host billing, native badge placement, or every terminal's rendering. |
| Clarification | `test/package-pi-questions.test.ts`, `test/package-install-pi-questions.test.ts`, Claude installer questions, discovery and shared-skill tests | Live tool availability, real keyboard/RPC rendering, human presence, or action authorization. |
| Session checklist | `test/package-pi-checklist.test.ts`, `test/package-install-checklist.test.ts`, native worktree carry and shared-skill checks | Live rendering, RPC client display, verified task completion from a status alone, or action authority. |
| Native specialists | `test/package-pi-specialists.test.ts`, `test/package-install-specialists.test.ts`, ordinary discovery | Snapshot confinement, malicious-extension isolation, real-provider quality, every SDK/platform, or live installation. |
| Language catalogue and clients | `test/package-claude-lsp.test.ts`, `test/package-pi-lsp.test.ts`, `test/package-pi-lsp-transport.test.ts`, native discovery | Provisioned real servers, identical diagnostics, or Windows process-tree cleanup. |
| Restricted review and diagnostics | `test/reviewer-runtime.test.ts`, `test/package-claude-reviewer.test.ts`, `tools/evaluation/tests/runners.rs`, `tools/evaluation/tests/change.rs` | Reviewer execution of project checks or automatic clean results after a runner failure. |
| Artifact decisions, feedback and publication | `tools/artifact-review/tests`, `tools/evaluation/tests/feedback_response.rs`, native feedback runtime tests, serial bounded browser suite | Same-user tamper resistance, automatic publication authority, closed-client wake-up, or live-provider eligibility. |
| Worklog | `tools/worklog/tests`, `test/package-pi-worklog.test.ts`, `test/package-install-worklog.test.ts` | Scheduling, long-term backlog semantics, old-store migration, live terminal/RPC rendering, or Herdr notification behavior. |
| Inventory completeness | `test/package-tool-inventory.test.ts`, `test/package-harness-contracts.test.ts` | Semantic correctness of every statement; human source review remains necessary. |

Known source discrepancies remain explicit rather than being repaired by inventory work:

- Pi and WT accept 1–64 ASCII letters/digits/underscores/hyphens; Claude's `WorktreeCreate` hook currently accepts lower-case letters/digits/hyphens only.
  Do not claim full task-name parity or broaden either adapter implicitly.
- The shared rebase prompt still says to stop when another session owns the worktree.
  WT references are not ownership locks; the prompt does not establish a session-ownership mechanism.
  Existing explicit Git locks and unrelated changes remain real blockers.
- The Pi guard forwards `content` or `new_string`, but not the current native edit tool's `edits[].newText` payloads.
  The hardcoded-secret probe exercises forwarded content, not that edit schema; do not infer full edit-content coverage from the matrix.
  This inventory records the mapping gap without changing the adapter.
- Restricted engines are currently only Pi and Claude.
  A new ordinary harness needs its own explicit restricted engine or must report review unavailable; installing role files is insufficient.
- Dated installed-state gaps in the earlier inventories are historical observations, not current live checks.
  Source delivery, rebuild, installation, runtime discovery, and real-service readiness are separate evidence levels.

Update this catalogue and the [checklist](new-harness-checklist.md) when owned resources, settings, adapters or workflow boundaries change.
Keep detailed subsystem rules in their linked canonical documents instead of creating a competing implementation specification here.
