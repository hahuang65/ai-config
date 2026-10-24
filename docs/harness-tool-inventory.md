# Harness and external tool inventory

Companion to the [package tool inventory](tool-inventory.md).
Most entries retain the pre-pruning harness baseline; see that document's approved-replacement section for the implementation now in progress.
The Pi LSP row and language-server section describe the subsequent shared-catalogue source change, not a verified live installation.
The clarification rows reflect the current package source, checked against Pi 1.3.0, not a live installation or Claude tool declaration.
This records tool identity, purpose, source, invocation, and configuration status—not a cross-harness parity specification.
The current [harness contracts catalogue](harness-contracts.md) adds resources, settings, lifecycle, workflows, safety boundaries, conformance evidence, and a new-harness checklist without replacing this dated tool evidence.
A **Tool** below is a named model-callable operation; the model invokes its runtime-defined arguments, not a shell command with the same spelling.
Commands and resources that merely guide, wrap, or observe tools are listed separately.

## Evidence and limits

Inspected on 2026-10-15 with Pi **1.1.0** and Claude Code **2.1.296** installed.
Pi evidence is its installed `@earendil-works/pi-coding-agent` documentation: `docs/cli.md`, `extensions.md`, `settings.md`, `mcp.md`, `codemode.md`, and `packages.md`.
Corresponding [upstream docs](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs) can advance beyond this observation.
Claude names and purposes come from the [official tools reference](https://code.claude.com/docs/en/tools-reference), retrieved on the inspection date, with this package's [manifest settings](../manifest.json) applied as configuration intent.
The Claude table is not a captured live Claude session tool declaration or proof that every conditional tool is active.

Local settings inspection selected only tool/resource/plugin configuration metadata; no authentication values, environment values, headers, private history, or customer data are included.
No MCP server was contacted, no language server was started, and no provider model was invoked.
Dynamic remote MCP tool names and effective tool sets in other projects remain unverified; ordinary project discovery is intentionally not disabled.

## Pi

All ordinary built-ins in this table are upstream Pi code, not reimplementations in ai-config.
The package adds the separate WT, LSP, and clarification rows below.
Local Pi settings contained no `defaultTools`, extra `packages`, or `extensions` selection; there was no user `mcp.json` or project `.pi/mcp.json` in this checkout.
The actual declarations in this inventory conversation were `read`, `bash`, `edit`, `write`, and `worktree_transition`, plus the call wrapper described below.

| Invocation / name | Purpose and why a tool | Status and source |
| --- | --- | --- |
| `read` | Return file text or supported images directly to the model. | Active default; Pi `dist/core/tools/read.js`. |
| `bash` | Execute commands that cannot be represented as file operations, including package CLIs. | Active default; Pi `dist/core/tools/bash.js`; package guards apply to calls. |
| `edit` | Apply exact, checked text replacements rather than rewrite a whole file. | Active default; Pi `dist/core/tools/edit.js`. |
| `write` | Create a file or deliberately replace its complete contents. | Active default; Pi `dist/core/tools/write.js`. |
| `grep` | Structured content search without a general shell command. | Optional upstream built-in; not declared in this session; Pi `dist/core/tools/grep.js`. |
| `find` | Structured glob/path search. | Optional upstream built-in; not declared here; Pi `dist/core/tools/find.js`. |
| `ls` | Structured directory listing. | Optional upstream built-in; not declared here; Pi `dist/core/tools/ls.js`. |
| `powershell` | Windows-native command execution. | Platform-specific upstream built-in; not declared in this macOS session; Pi `dist/core/tools/powershell.js`. |
| `codemode` | Execute sandboxed JavaScript that composes other tools and filters output before returning it to the model; also reaches supported classifier/image models. | Upstream built-in extension, off by default; not declared here. `docs/codemode.md`; enabling it is a separate configuration decision. |
| `tool_search` | Discover undeclared tools and activate matches. | Upstream built-in extension, off by default; not declared here. `docs/cli.md`; MCP can activate it for deferred tools. |
| `mcp__SERVER__TOOL` | Invoke an external server's schema-defined operation. | Conditional runtime registration by upstream MCP support; no servers configured in the inspected Pi files. Names and exposure depend on the server. |
| `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource` | Discover and read resources from connected MCP servers. | Conditional upstream MCP tools, absent here; `docs/mcp.md`. |
| `worktree_transition` with `action` and optional `task` | Prepare the privileged native session transition that a shell `cd` cannot perform. | Package-owned, active; [harnesses/pi/worktree.ts](../harnesses/pi/worktree.ts), installed as its bundle. Actions: `new`, `enter`, `leave`, `clean`; a human submits the prepared `/wt` command before transition. |
| `lsp` with `operation`, `path`, and optional position | Query hover, definitions, references, symbols, or diagnostics from an on-demand language server. | Package-owned [harnesses/pi/lsp.ts](../harnesses/pi/lsp.ts), installed as a bundle; [shared catalogue and limits](language-servers.md). Not active in the original inventory session. |
| `ask_user_question` with `question` and optional `options` | Clarify one requirements or preference decision with trade-offs and a free-text alternative. | Package-owned [harnesses/pi/ask-user-question.ts](../harnesses/pi/ask-user-question.ts), installed as a bundle; native TUI/RPC dialogs, model-only, hidden without UI. [Results and approval limits](clarification.md). Not active in the original inventory session. |
| `multi_tool_use.parallel` | Submit independent calls together through the session's execution wrapper. | Present in this conversation's tool interface, not registered by this package or an installed CLI. Do not mistake it for a second package orchestration implementation. |

Pi's [extension contract](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md) distinguishes a model tool (`registerTool`) from a slash command (`registerCommand`).
The WT extension registers one model tool and one `/wt` command, not two interchangeable tools.
The LSP and clarification extensions each add a separate model tool.
Guard and status-footer extensions register no tools.
The [review-feedback extension](../harnesses/pi/review-feedback.ts) also registers no model tool.
Its `/review-feedback` command resumes saved feedback after interruption; background native messages use the existing conversation and shared Rust queue.
Pi has no package-installed native subagent tool; specialist files alone do not add that capability.

MCP tools default to codemode exposure in this Pi version, not direct declaration.
`codemode`, `deferred`, `direct`, and `hidden` exposure differ; not seeing a tool in the current declarations does not generally prove it is unreachable.
The absence here is based on both the inspected configuration and this session's declarations, not on declaration count alone.

## Claude Code

Source for every upstream row is the official tools reference linked above; invocation is the exact model tool identifier in the first column.
“Not denied by this package” means only that the manifest does not deny the tool by name; permission rules, hooks, host eligibility, and the user's authorization still apply.
No runtime availability is inferred merely because a name appears in a deny rule.

| Invocation / name | Purpose and why a tool | Package configuration / host qualification |
| --- | --- | --- |
| `Read`, `Edit`, `Write` | Read source, perform exact replacements, or create/replace files. | Ordinary host tools; path/content guards and native permissions apply. |
| `Bash` | Run shell commands and agent-facing CLIs. | Ordinary host tool with command guards and manifest allow/ask/deny patterns. |
| `Glob`, `Grep` | Structured path and content search. | Upstream docs say absent by default on macOS/Linux/WSL; available under documented tool selection or read-only subagent conditions. Shared role frontmatter names them, but the restricted runner below grants only `Read`. |
| `PowerShell` | Run native PowerShell commands. | Host/platform-dependent; not a package-added tool. |
| `WebFetch`, `WebSearch` | Fetch a URL or search the web. | Host/provider-dependent; not denied by name in this manifest. External input is untrusted. |
| `Agent` | Delegate a task to a separate context. | Native Claude subagent operation; shared role files supply instructions, not another delegation engine. |
| `Skill` | Load and execute a file-backed workflow in the main conversation. | Native Claude tool; one skill file is not one additional tool declaration. |
| `LSP` | Definitions, references, types, symbols, implementations, and call hierarchy from language servers. | Enabled through the selected plugins below; actual operation needs a provisioned server. |
| `EnterWorktree`, `ExitWorktree` | Move the native session into or out of a worktree. | Host tools coordinated by the [WT hook adapter](../harnesses/claude/worktree.ts); `/wt` provides workflow guidance. Cleanup still requires explicit authority. |
| `TaskCreate`, `TaskGet`, `TaskList`, `TaskUpdate` | Create, inspect, and update the host session's task list. | Model/setting-dependent, not denied by name; not the cross-project append-only work log. |
| `TodoWrite` | Manage the older session checklist. | Upstream compatibility alternative, disabled by default in favor of task tools where available. Not a package workflow. |
| `TaskStop` | Stop a running host background task/agent. | Not denied by name; process control, not work-log task completion. |
| `TaskOutput` | Former background-output retrieval. | Upstream docs mark removed in 2.1.277; current workflow reads output files with `Read`. Do not count it as active merely because older documentation names it. |
| `Monitor` | Run a bounded background command or WebSocket watch and deliver events. | Host-conditional, not denied by name; not a replacement for durable revision-bound artifact review or indefinite logical waiting. |
| `ToolSearch` | Find and load deferred tools. | Conditional host discovery, including MCP tools. |
| `WaitForMcpServers` | Wait for still-connecting servers. | Conditional when tool search is disabled; not an MCP server itself. |
| `ListMcpResourcesTool`, `ReadMcpResourceTool` | Discover/read external MCP resources. | Conditional on server configuration and connection. |
| `mcp__SERVER__TOOL` | Invoke a server-defined operation. | Independently configured; concrete names and connection status not verified in this inventory. |
| `AskUserQuestion` | Present structured choices for clarifying requirements and preferences. | Explicitly allowed by the package; independent deny rules can still block it. This does not replace revision-bound artifact approval, finding decisions, or publication confirmation. |
| `EnterPlanMode`, `ExitPlanMode` | Enter a host planning mode and present its approval boundary. | Explicitly denied; do not confuse these with the shared `plan` skill. |
| `NotebookEdit` | Modify notebook cells as structured data. | Explicitly denied. |
| `SendMessage` | Message another agent or session. | Explicitly denied. |
| `ListAgents` | Discover agents/sessions that could receive messages. | Conditional on cross-session messaging; not denied by name. Its presence would not override the `SendMessage` denial. |
| `PushNotification` | Send a desktop/remote-device notification. | Explicitly denied; Remote Control is also disabled. |
| `RemoteTrigger` | Manage hosted routines. | Explicitly denied. |
| `ReportFindings` | Submit structured findings for host rendering. | Explicitly denied; package change review retains its own immutable report and decisions. |
| `CronCreate`, `CronDelete`, `CronList`, `ScheduleWakeup` | Schedule, cancel, inspect, or reschedule host-session prompts. | Explicitly denied; the work log is not a scheduler. |
| `Artifact` | Publish HTML/Markdown to a hosted artifact page. | `disableArtifact=true`; different ownership/privacy behavior from local artifact-review. |
| `Workflow` | Run a host dynamic workflow over subagents. | `disableWorkflows=true`; not the shared skills' execution mechanism. |
| `SendFeedback` | Draft product feedback for later human submission. | Host/version-dependent; not denied by name; not artifact-review feedback. |
| `SendUserFile` | Deliver a file to a connected client/device. | Host/cloud/Remote Control-dependent; Remote Control is disabled by this package. |
| `ShareOnboardingGuide` | Upload an onboarding guide and return a share link. | Subscription-dependent; not denied by name; publication needs separate authorization. |
| `SubagentHandback` | Return a subagent report through the host's auto-mode review. | Restricted host conditions; not a package specialist runner. |
| `EndConversation` | End the current session under the host's narrow conditions. | Model/surface-dependent host safeguard; upstream says ordinary tool deny rules cannot remove it while other tools remain. Not part of our workflow machinery. |
| `DesignSync` | Defensive denied identifier, not an established current tool. | Present in manifest denial; no corresponding entry in the inspected official tool reference. Its implementation/purpose is unverified, not invented here. |

The package also disables bundled skills, Claude.ai connectors, and Remote Control.
Disabling Claude.ai connectors does **not** establish that all independently configured MCP servers are disabled.
The manifest does not disable ordinary user/project discovery.
The [review-feedback hook](../harnesses/claude/review-feedback.ts) adds no model tool or MCP server.
It uses native `asyncRewake` listeners and maintenance turns, with a short synchronous completion hook to avoid reply races at prompt boundaries.
Synthetic native-client tests verify this source change without claiming live installation or provider eligibility.

## Language-server integrations

Eight shared server definitions now back Claude's single `LSP` tool and Pi's single `lsp` tool; they are not eight additional model tools.
The canonical [language-server catalogue](../language-servers.json) covers Python, Ruby/ERB, Lua, Go, Shell, Terraform, TypeScript/JavaScript, and Rust.
The [integration contract](language-servers.md) lists their exact invocations, mise provisioning, native-client differences, and future-harness conformance requirements.
Claude uses one generated [ai-local-lsp plugin](../harnesses/claude/plugins/ai-local-lsp/.claude-plugin/plugin.json); Pi imports the same catalogue into its bundled client.
The manifest disables the four previously managed upstream Lua, Go, Shell, and Terraform plugins to avoid duplicates, without removing caches or changing unrelated plugin choices.

An enabled plugin entry or a cached plugin directory does not prove that its server can run.
Client tests use disposable fake servers and do not establish live provisioning, project readiness, or equivalent diagnostics from every native client.

## Restricted reviewers

The [Rust runner](../tools/evaluation/src/reviewer.rs) intentionally exposes a narrower interface than ordinary development sessions.
Pi launches with ordinary discovery and built-in tools disabled, then the explicit [review-scope adapter](../harnesses/pi/review-scope.ts) activates only `read` for regular allowed snapshot files.
Claude launches restricted/safe with `--tools Read`, empty strict MCP configuration, no session persistence, and explicit trusted instructions.
Neither runner receives shell execution, edits, WT operations, normal skills, or project-discovered tools.
The source snapshot is evidence, not instructions to execute.

All five [role files](../agents/) declare `Read`, `Grep`, and `Glob` for ordinary Claude role use; that declaration does not widen the dedicated runner's actual one-reader interface.
`api-designer`, `change-reviewer`, `database-reviewer`, `fact-checker`, and `frontend-architect` are role definitions, not five new model tools.
Pi's installed role files do not by themselves provide an ordinary native subagent tool.

## Independently configured surfaces

These are observations of external configuration, not resources adopted by this package.
The Claude MCP rows come from the global `mcpServers` entries in `~/.claude.json`; server commands' environment values, endpoint URLs, and credentials are deliberately not reproduced.
Concrete MCP tool names, schemas, and live availability would require a separately bounded discovery step against the owning servers.
A configured server entry alone is not proof that the service is reachable, useful, or safe to delete.

| Surface | Source / harness / invocation | Purpose and classification | Observed limit |
| --- | --- | --- | --- |
| TypeSafe | Independent `~/.agents/skills/typesafe-ai`, discovered through Claude and Pi skill links; normal skill loading | Guidance for typed AI judgments and application integration; a skill, not a registered MCP tool. Upstream Pi can optionally call classifier models through codemode. | No TypeSafe endpoint/model call or configuration change; codemode was not active here. |
| Herdr | Independently managed `~/.pi/agent/extensions/herdr-agent-state.ts`; Pi lifecycle events | Terminal workspace/agent-state integration; event observer, not a model-callable tool. | Source inspection found no tool registration; no Herdr settings or sessions changed. |
| `snowflake` MCP entry | Independent Claude user configuration; stdio launcher via `uvx`; potential `mcp__snowflake__...` calls | Externally configured server intended for Snowflake access, not installed by this manifest. | Server not launched; exact exports, policy, and connectivity unverified. |
| `agentmemory` MCP entry | Independent Claude user configuration; stdio launcher via `npx`; potential `mcp__agentmemory__...` calls | Retained external memory integration, not the package's work log and not a package-enabled service. | Not launched and no historical data queried; presence is not evidence of active use. |
| `atlassian` MCP entry | Independent Claude user configuration; HTTP; potential `mcp__atlassian__...` calls | External Atlassian integration; the name is not evidence of a particular current tool list. | Endpoint, credentials, remote schemas, and service data not disclosed or contacted. |
| Project extensions, plugins, MCP, and CLI tools | Normal host discovery and shell `PATH` | Can add or change operations for a particular repository; not a fixed global package catalogue. | No project MCP/settings override found in this checkout; no claim about unrelated repositories or ancestor/managed configuration. |

## Resources that are not separate tools

| Resource | Source / harness / invocation | Why it exists, and why not another tool |
| --- | --- | --- |
| Shared skills | [skills/](../skills/), manifest links into both harnesses; automatic discovery, Claude skill invocation, Pi `/skill:NAME` | Workflow instructions loaded through host facilities. The 18 installed package skills do not add 18 tool APIs. |
| `/deliver`, `/rebase` | [commands/](../commands/); Claude commands and Pi prompt templates | Explicit workflow composition/shortcuts, not executable handlers or additional authorization. |
| `/wt` | [Claude prompt](../harnesses/claude/commands/wt.md); [Pi handler](../harnesses/pi/worktree.ts) | Source-declared Claude guidance for native worktree tools; its live prompt link was missing at inspection. Pi's command context performs native session replacement. Neither is the standalone WT binary. |
| Baseline, rules, role files, themes | [Manifest](../manifest.json), [baseline](../baseline.md), [rules](../rules/), [agents](../agents/) | Instructions, role constraints, and presentation data—not callable execution boundaries. |
| Git, `gh`, shell/file utilities, mise-managed language tools, browser | Runtime or workflow dependencies selected by their owning environment | Used through shell tools or child processes; not owned model tools. `gh` supports bounded GitHub queries/publication paths; a browser hosts local human feedback. |

Use the [pruning candidates](tool-inventory.md#candidates-for-a-later-pruning-decision) to decide subsequent work.
No rows here imply authorization to disable host features, remove aliases, connect a service, install dependencies, or alter TypeSafe/Herdr.
