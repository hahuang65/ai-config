# Guarded native specialists

The owned Pi `subagent` tool consults one of four read-only specialists through pinned pi-subagents **0.83.0**.
It is ordinary task assistance, not the restricted snapshot reviewer or the standalone `consult` helper.
Claude continues using its own native `Agent` tool and the unchanged shared role files.
This describes package source, not a live installation or permission to call a model.

## Interface

The model supplies only `agent` and `task`:

```json
{ "agent": "api-designer", "task": "Explain the existing API contract and compatibility risks. Do not edit." }
```

The allowed names are `api-designer`, `database-reviewer`, `fact-checker`, and `frontend-architect`.
The task must be nonblank and at most 16,384 UTF-8 bytes.
Unknown fields and roles are rejected before delegation.
The tool is model-only and sequential, not callable from codemode.
Specialist calls do not create an unbounded parallel model fleet; check/review concurrency uses separate native subprocesses.
Delegation stays within the user's existing task and model-call authorization.
It is optional advice, never an automatic team or a required extra planning step.

Every launch is local, foreground, and fresh.
A fresh specialist receives the task plus inherited global/project instructions and the discovered skill catalogue, not the parent's full conversation.
The adapter reads the canonical role body without changing its Claude-style metadata.
It registers private runtime names prefixed with `ai-config-`, avoiding collisions with installed shared role files.
Those internal names may appear in engine artifacts.

The child receives only `read`, `grep`, `find`, and `ls`.
The interface grants no writing, shell execution, nested delegation, external machines, background execution, or package-managed worktrees.
The `change-reviewer` role is excluded.
Required change reviews still use `review-change`, its restricted runner, immutable evidence, and human finding decisions.

## Enforcement and configuration

The adapter uses the package's public runtime-agent, required-child-extension, and capability-ceiling APIs.
It requires the owned `guard-policies`, `worktree`, and `review-feedback` bundles for every runner.
Only local native children can meet that extension requirement.
It does not set `denyExtensions: true`, which would conflict with the required guards.
A failed host-floor registration leaves the tool unable to launch, even though native lifecycle errors can otherwise be reported without stopping a session.

The owned engine policy disables missions, schedules, auto-resume, slash commands, optional workflow/admin features, external-machine options, and coordination UI.
The public facade exposes no engine workflow or lifecycle controls.
A launch has a two-minute default deadline and a 30-second tool deadline.
The package also limits logical admissions per run and session.
The native engine supplies cancellation, child execution, and result handling rather than an owned replacement orchestration runtime.

Installation owns two resources:

- `~/.pi/agent/extensions/specialists.ts` links to the owned adapter bundle.
- `~/.pi/agent/extensions/subagent/config.json` links to the owned read-only engine policy.

Existing unrecorded files are refused, even when their bytes match.
Private model/authentication settings and unrelated extensions remain independently configured.
The adapter checks the runtime and policy at startup and before every delegation.
It refuses a missing or changed policy and does not quote malformed private configuration in errors.
Do not separately register the full upstream extension alongside this adapter.
No parent discovery allowlist is introduced.

## Build and host identity

`make build` restores locked library dependencies with lifecycle scripts and peer installation disabled.
It copies the pinned engine and runtime dependencies into ignored `target/pi-subagents/`, preserving the upstream layout and licenses.
The engine installer is not run.
Runtime peer links point to the already installed Pi SDK, agent core, AI, terminal, and TypeBox packages.
No second Pi client is installed or upgraded.
The owned adapter itself is bundled for the installed Node loader.

The runtime records its SDK root/version and refuses a different active host.
Rebuild this checkout after changing the Pi installation and restart an older client process.
An incompatible explicit subagent SDK override is rejected without changing the environment.
Native tests currently exercise Pi **1.4.0** with a synthetic, credential-free provider.
This does not certify every future SDK or platform.
`make build` does not install or retarget live resources.
Live installation still needs the explicit installer and separate authorization.

## Verification and review concurrency

At implementation completion, run source-producing build steps first.
Then overlap independent deterministic checks with the existing restricted review when the host supports safe concurrency.
Use bounded native subprocesses and separate logs, not shell-enabled specialist agents.
Respect the repository's existing test and browser concurrency limits.
Wait for both jobs before repairs or source edits, then verify that the checked and reviewed source is still current.
If checks rewrite source, serialize that work before freezing review evidence.
In this repository, run `make build build-evaluation-debug build-artifact-debug` first, then use `make test-prepared` for the complete assertion phase alongside review.
Its recipes are shared with normal `make test`, and a command-plan test checks identical coverage without source-generating preparation.
The normal gate and commit hook still build first.
Unsupported or unsafe concurrency remains serial and must be reported honestly.

A ten-minute test suite still takes about ten minutes.
Overlap can reduce the additional review wait, but resource contention can reduce that benefit.
No general wall-clock or model-quality improvement is established by synthetic tests.
The shared workflow tests check instructions, not model compliance with them.

Commits always run required checks, normally through their known pre-commit hook.
Delivery reuses only actual passing evidence for the same clean checkout, exact revision, commands, and relevant configuration/toolchain state.
Commit success alone is not sufficient proof.
A real rebase invalidates that evidence even if the file tree is unchanged.
Replacement checks run after rebase and before integration.
A no-op rebase preserves matching verification.
Delivery may perform a needed authorized review, without repeating a current review of the same source and intent.
There is no new verification cache, hook bypass, automatic repair, or publication authority.

## Evidence and limits

- `test/package-pi-specialists.test.ts` exercises the actual adapter, native child, role/context inheritance, tool declarations, guard refusal, and failed-startup containment.
- `test/package-install-specialists.test.ts` checks recorded upgrades, preference preservation, and unowned-resource refusal.
- Discovery tests retain ordinary personal/project resources.
- Shared workflow tests cover parallel completion guidance and nonduplicative delivery policy.

Read-only tools are not snapshot confinement or an operating-system sandbox.
Guard patterns are not exhaustive credential protection, and loaded extensions remain trusted code.
Native package sessions and artifacts persist under the agent's normal private state.
Real-provider quality, cost, RPC/TUI interaction, cancellation, reload/resume/compaction, crash recovery, and every other project's configuration are not established by the focused tests.
Keep WT lifecycle, restricted review, repair decisions, commits, installation, and publication under their existing separate authority.
