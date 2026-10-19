# New-harness implementation checklist

Use this with the [harness contracts catalogue](harness-contracts.md), not as authorization to change the live configuration.
A harness implementation is ready only when each applicable item has source and verification evidence.
Mark unsupported behavior explicitly with its user-visible fallback; do not silently mark it equivalent.
An unimplemented mandatory safety boundary blocks admission.

## 1. Establish scope and host evidence

- [ ] Record the host name/version, supported operating systems and modes, native config root, instruction discovery, tool schema, event API, session API and UI API.
- [ ] Read version-matched host documentation and the smallest relevant checked examples before designing adapters.
- [ ] Distinguish package-owned surfaces from conditional host features and independently configured resources.
  Do not infer availability from a tool name in a deny list or a role file.
- [ ] Enumerate every row in the [shared interface table](harness-contracts.md#shared-interfaces-and-legitimate-differences) as implemented, legitimately different, unsupported, or blocked.
  Record evidence and a manual fallback for each limitation.
- [ ] Establish a named task worktree and starting revision before any repository writes.
  Do not switch installed links, rebuild the live source, provision tools, or adopt personal files as part of a test.

## 2. Preserve shared resources and normal discovery

- [ ] Add the small shared `baseline.md` under the host's native instruction filename.
  Verify on-demand rule resolution uses the absolute installed bootstrap source, not project-relative or another configuration's paths.
- [ ] Project the curated shared skills, useful commands and trusted role files through native discovery.
  Preserve relative skill references/assets and document exact skill/command invocation syntax.
- [ ] Keep shared skills/rules harness-neutral and avoid duplicate same-purpose command wrappers.
  Add host-only guidance under the new module only when genuinely needed.
- [ ] Keep ordinary user/project discovery and trust behavior enabled.
  Verify a disposable user resource and project resource are discovered alongside owned resources.
- [ ] Verify owned destinations contain only curated shared sources or this harness's module, never sibling-module links.
  This installer isolation is not an ordinary runtime discovery allowlist or OS sandbox.
- [ ] Document native subagent support honestly.
  If role files are inert without an executor, say so; do not add an automatic agent team to fill the gap.

## 3. Enforce the shared safety boundary

- [ ] Classify enforcement as tier A (programmable), B (command hook), C (declarative), D (sandbox), or E (guidance).
  All mandatory registry policies need A/B/C/D enforcement; guidance-only hosts must be sandboxed or rejected.
- [ ] Normalize native calls into shared `ToolCall` fields: tool, command, requested path, glob pattern, changed content, cwd and safe home.
  Include every equivalent read, search, edit, write and execution tool rather than mapping names alone.
- [ ] Reuse the guard core rather than copying policy detection into the adapter.
  For hosts unable to execute it, document and test the alternative enforcement for every registry policy.
- [ ] Map refusals to the host's actual block/deny protocol before execution.
  Preserve native permissions; a shared non-denial must not override host restrictions or user authorization.
- [ ] Ship the pinned local shell parser/runtime/licenses and test missing assets, malformed input, inspection limits, unsafe home and initialization failure.
  No runtime download, text-parser fallback, or retry that silently reenables a failed guard.
- [ ] Extend registry-driven conformance to the new native adapter: each violating example is denied and each benign near miss passes that policy.
  Test source and installed bundle/loading boundaries, including path aliases and changed-content fields.
- [ ] Update the policy coverage matrix with tier, evidence and every non-floor gap.
  Document alternate-tool, MCP, script, race and same-user limitations rather than claiming sandbox protection.

## 4. Implement native task conversations

Follow the complete [WT transition contract](worktree-transitions.md).
A child shell `cd`, printed path, or new subprocess does not move the current harness session.

- [ ] Reuse the shared WT CLI/client and exact managed task identity; do not introduce another lifecycle manager.
- [ ] Implement new-task carry and existing-task resume through the host's native parent-session transport.
  Save only harness-specific conversation references in Git administrative metadata, never transcripts or converted histories.
- [ ] Preserve the selected branch and compaction history on carry; resume the exact saved conversation on entry.
  Never replace a saved task conversation with the incoming session.
- [ ] Verify actual host cwd, session cwd, repository, named task branch and selected conversation before allowing destination writes.
  Refresh destination tools/context through native lifecycle, not manual instruction copying.
- [ ] Refuse dirty source state, branch drift, invalid/missing references, explicit Git locks and wrong destinations without stash/move/reset workarounds.
  Saved references are not exclusive session ownership; do not add PID claims, heartbeats or session locks.
- [ ] Implement leave as verified native return carrying the current conversation without cleanup.
  Implement authorized cleanup only after safety check, verified return to primary and repeated safety check.
  Report integration, return, worktree removal and local branch removal separately on partial failure.
- [ ] Reuse `[WT continuation v1]` exactly once after successful verification, using either the active native loop or a fresh destination turn, never both.
  No continuation on preparation, cancellation, failure, no-op, ordinary startup, manual restore or history replay.
- [ ] Prove cleanup precedes any bundled-cleanup continuation and failed cleanup schedules none.
  Do not synthesize terminal input or let a success notification stand in for an actual destination model turn.
- [ ] Document supported modes, task-name syntax and manual fallbacks for missing native APIs.
  A host unable to initiate verified continuation must state the exact resume/continue step instead of claiming automatic support.
- [ ] Add bounded native-runtime tests with disposable repositories, histories and synthetic providers.
  Inspect actual destination requests, instructions, tools, history and continuation counts for new/enter/leave/clean plus failure/replay cases.
  List human-only smoke checks separately.

## 5. Supply language and presentation integrations

- [ ] Consume every entry in `language-servers.json` directly or through a parity-checked native projection.
  Preserve commands, arguments, extensions and language IDs; never independently select languages or install a missing server on demand.
- [ ] Prefer a native LSP client; otherwise document lazy start, disk/buffer synchronization, capabilities, errors, timeouts, cancellation, output/document bounds and idempotent process cleanup.
- [ ] Retain path/read guards, reject server-directed mutations, protect logs, and explain that server internals may execute trusted workspace configuration.
  Restricted reviewers must not load language servers.
- [ ] Test catalogue parity and actual loader discovery, then queries, malformed protocol, missing server, stale diagnostics, cancellation and shutdown with fake servers where the package owns the client.
  Record native-client limits and real-server smoke evidence separately; do not promise identical diagnostics.
- [ ] Translate the Catppuccin Mocha palette to the host's supported schema without changing shared semantic colors.
- [ ] Implement the two-row location/branch/session and token/cache/cost/context display using native data.
  Document model/thinking placement, missing values and accounting differences rather than inventing parity.
- [ ] Sanitize terminal controls, fit narrow/wide-character widths, test theme validity and avoid secret/history/service reads.
  Keep terminal UI mode-specific; unsubscribe listeners and close processes on reload, session replacement and shutdown.

## 6. Preserve workflows, review and authority

- [ ] Route planning, specifications, mockups, coaching, implementation, commits, handoffs, domain documentation, Worklog and review through the existing shared skills.
  Preserve each artifact's scope-specific approval, not a new global approval gate or resurrected build pipeline.
- [ ] Expose explicit deliver/rebase compositions with their current authorization boundaries.
  Never turn delivery/rebase into implicit publication, provider review, push or unsafe cleanup.
- [ ] Use WL's existing private store and project identity across worktrees; no native-task substitution, old-history import, automatic scheduling or store switch after an empty query.
- [ ] Use local context files and Markdown ADRs in every project and linked worktree, following the [documentation rule](../rules/documentation.md).
  Preserve A5 classification from effective global/system configuration and keep A5 documentation private under the [A5 rule](../rules/a5.md).
  Do not let project-local configuration self-grant A5 status or introduce external documentation destinations.
- [ ] Add a genuinely independent restricted reviewer engine for the new host if required by its shared review workflow.
  Do not silently use Pi/Claude credentials or select their engines as a fallback.
  Until supported, report review unavailable and incomplete.
- [ ] Freeze source evidence and expose only regular allowed snapshot reads, with ordinary skills/context/plugins/MCP and execution disabled inside that reviewer only.
  Treat reviewed content as evidence, never trusted instructions to execute.
- [ ] Test real native restricted loading with a synthetic provider, required evidence reads, tool exclusions, provider errors, timeout/interruption, bounded credential-safe diagnostics and invalid completion evidence.
  A zero exit is not automatically a successful review.
- [ ] Invoke source-local review/artifact/consult helpers through their existing interfaces and explicit scope/intent.
  Preserve immutable reports, current revision/digest checks and new reports after selected repairs.
- [ ] Keep artifact approval, local finding Accept/Reject and PR publication separate.
  Human Publish confirms exact editable selected text, verified destinations, account and PR; model tools never synthesize it.
  Preserve COMMENT-only posting and same-report reconciliation after uncertain results.
- [ ] Preserve foreground event-driven waits without an inactivity cutoff, saved cursors, replay safety and explicit interruption reporting.
  Do not claim the host can wake a turn that has already ended.

## 7. Integrate ownership, build and verification

- [ ] Update `manifest.json`, `tools/install/manifest.jq`, relevant JSON catalogues, source, build steps and disposable fixtures together for each owned resource/setting.
- [ ] Retain `install.sh` as the only installation implementation, with recorded ownership, conflict refusal, settings preservation, transaction lock and safe handled-failure rollback.
  Test repeat installation, upgrade, unrelated settings, redirection/hardlink refusal and rollback without live state.
- [ ] Keep model/authentication choices, saved sessions, project trust, TypeSafe, Herdr and independent resources untouched.
  Do not enable a legacy service or absorb a personal file to make tests pass.
- [ ] Bundle host adapters as required by the real installed loader and verify generated/source parity.
  Build task-local artifacts with locked dependencies; never provision tools or upgrade a harness as a test side effect.
- [ ] Add tests to the complete gate automatically, with focused commands documented in `test/README.md`.
  Keep native runtimes and browser cases bounded, disposable and synthetic; report required platform skips as limits.
- [ ] Run focused RED/GREEN checks, `make build`, `make lint` and `make test` as applicable, then the authorized restricted change review.
  Report missing review authorization or unavailable tooling as a blocker rather than claiming completion.
- [ ] Update this checklist, the resource/settings catalogue, tool inventories and conformance evidence links.
  Distinguish source coverage, automated results, human smoke tests and unverified installed state in the final report.
- [ ] Obtain separate explicit authorization for staging/committing, delivery, live provisioning/installation, source switching, cleanup outside delivery and publication.
  Completion of this checklist grants none of them.
