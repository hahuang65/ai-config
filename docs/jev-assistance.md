# Optional Jev assistance

Jev supplies numeric review hints and additional scope objections.
It does not generate reviews, decide findings, or grant permission.
Both features are off by default and use pinned `typesafe/jev-1.14.0` through the existing Pi classifier and authentication APIs.
Herdr configuration is not involved.

## Review assistance

Add `--jev` only when the eligible review evidence may be shared with TypeSafe:

```text
review-change feature-branch --jev
review-change review local --repo /absolute/project --engine pi --intent 'Implement the requested validation' --jev --json
```

The Rust reviewer orchestrator supplies three kinds of supplemental information:

- A reading guide ranks at most twelve unchanged context files from a deterministic lexical shortlist.
- A focused checklist scores authorization, compatibility, concurrency, durability, input handling, and testing concerns.
- After normal finding validation, advisory checks score evidence support, introduction by the change, and limited same-file duplicate comparisons.

The reading guide is added to the restricted reviewer's prompt as labeled data.
It never removes changed-file coverage, required evidence reads, eligible snapshot files, or the reviewer's ability to inspect further evidence.
Low checklist scores never exempt code from review.

The retained JSON and HTML show assistance status, all checklist scores, context priorities, and per-finding assessments.
All original findings, severities, locations, and human controls remain intact, including findings with low support or high duplicate scores.
Missing evidence is not proof that a finding is wrong.
Rewording findings marks their assessments stale and clears their scores without changing source or removing findings.

Missing credentials, invalid responses, service failure, or an oversized request leave the full normal review in place.
User interruption is different: SIGINT or SIGTERM during assistance stops the review instead of triggering fallback.
Interrupted planning cannot start the reviewer, and interrupted finding assessment cannot save or open a report.
Partial finding assessment is explicit, with unavailable, input-limit, or time-budget status for unassessed findings.
Neither assistance nor a completed review authorizes repairs, commits, installation, delivery, or publication.
Existing human repair decisions and exact publication confirmation remain authoritative.

## Scope objections

A user can enable scope checks for a new native session with `AI_JEV_SCOPE=1`.
This is separate consent to share bounded recent user requests and proposed-action metadata with TypeSafe.
Do not enable it for private input that cannot be shared.
The package does not edit startup files or set this variable during installation or tests.

Existing deterministic guards run first.
A mandatory denial stays denied without calling Jev.
Claude's existing deterministic read-only permission shortcut also remains unchanged.
Known read tools, local Pi checklist operations, and native clarification tools do not need a classifier call.
Shell read exemptions apply only after checking syntax-tree redirections.
Git `diff`, `show`, and `log` always receive scope assessment because they can invoke configured external diff or text-conversion helpers.
This includes environment assignments, wrappers, and helper-disabling flags; the shortcut does not try to prove those display commands safe.
Ordinary Git metadata reads such as `status`, `rev-parse`, `ls-files`, and `ls-tree` retain their existing exemptions.
The `file` command exempts only known inspection forms, including brief and MIME-type output.
Compilation and unknown options require scope assessment, while `--` still marks following arguments as literal filenames.
File-opening output redirects, including redirect-only statements, require scope checks even when the executable looks read-only.
Literal descriptor copies and null-device output do not add classifier calls by themselves.
Parser refusals remain authoritative and never fall back to Jev.
Other actions are checked for departures such as restarting an application during a diagnosis-only request.

The classifier sees the tool name, working directory, target path, and shell command when present.
It does not receive structured write/edit bodies, tool results, assistant messages, or the complete conversation.
Shell commands can themselves contain private source or sensitive arguments.
This is a limited action check, not a semantic audit of unseen write contents or arbitrary scripts.

Pi reads user messages from its current native session branch.
Claude reads at most the final 256 KiB of its configured session transcript, verifies its session filename, and follows the recorded parent chain.
Compact summaries, meta messages, and WT continuation notices cannot establish new user intent.
Missing branch evidence requires clarification rather than guessing.
With the scope opt-in, Pi records successful owned clarification dialogs as native session entries, linked to their assistant tool-call entry.
Only matching current-branch native records contribute question/answer pairs, not tool-result text, structured tool output, assistant prose, or custom messages.
This trusts the native session channel and trusted extensions, as user-message evidence does; it is not cryptographic protection against session-storage tampering.
Records survive session reopening and follow branch navigation.
The scope reader examines at most 4096 current-branch entries and retains the last eight user requests and last eight subsequent clarification pairs.
Pairs identify their order relative to retained user requests and include a selected choice's displayed trade-off.
They count against the existing input budget and cache key, and changes during classification require clarification.
Malformed or orphaned native records fail closed.
Cancelled, unavailable, aborted, and older receipt-free tool answers supply no clarification evidence.
Native UI responses can come from an automated RPC client and never establish action authorization.
Neither transcript text nor classifier output is an authorization record.

A drift probability of at least 0.2 requires clarification.
Invalid, unavailable, cancelled, oversized, or changed intent also requires clarification.
A lower score returns no additional objection, never an allow decision.
Successful identical judgments can be reused for the exact same user requests and action, with at most 64 cached entries per Pi extension instance.
Claude hooks are short-lived and do not share that cache.
Agents must not change the opt-in setting or rewrite the supplied intent to work around an objection.
Native clarification and ordinary chat remain available when the classifier fails.

## Data and execution limits

Requests are limited to 32 KiB and 64 boolean questions.
Known high-confidence credential literals are rejected locally using the same patterns as the existing credential guard.
Those patterns cannot recognize every secret or confidential value.
Privacy exclusions and consent are still necessary.
No credential files, source payloads, or provider error bodies are added to classifier logs.
Pi resolves provider authentication internally rather than exposing keys to the Rust orchestrator.

Review planning samples at most 32 changed paths for lexical terms, the first 4096 after-tree paths, and 1 MiB of unchanged-file text.
It sends at most 2048 bytes of intent, 4096 bytes of patch, 32 changed path names, and twelve 768-byte context excerpts before JSON overhead.
These are assistance limits, not snapshot or review-coverage limits.
Finding checks use batches of up to three findings, bounded before/after excerpts, and at most two same-file duplicate comparisons per finding.
The 18-second finding-assessment budget can leave later findings unassessed.

Scope state is limited to 12 KiB and at most eight recent user requests.
Pi's in-process Jev calls have a five-second cancellation deadline.
Claude runs discovery, SDK import, initialization, and classification in a separate worker with a five-second parent-owned deadline.
A stalled synchronous probe cannot block the hook's event loop or defer its clarification denial until the host timeout.
The worker uses bounded stdin/stdout and suppresses raw diagnostics.
A separate supervisor keeps the process-group leader alive until the caller stops the whole group.
Worker exit and inherited output streams do not release ownership before helpers in that group stop.
A separate owner pipe stops the supervisor's group if the caller dies, with a six-second supervisor fail-safe.
Timeout and cancellation still use the caller's five-second deadline.
It starts outside the project with runtime preload options and automatic Bun project configuration disabled.
The Rust CLI retains its separate six-second bridge-process timeout and 64 KiB result limit.
The bridge uses the installed Pi SDK without creating an agent session, loading project extensions, enabling tools, or refreshing model metadata over the network.
It makes only the requested classifier call.
SDK discovery honors source exclusions for resolved Pi launchers, followed wrapper targets, SDK roots, and SDK entry points.
Claude derives a canonical source root from the native working directory and its nearest Git metadata ancestor without executing Git.
It merges that root with inherited exclusions only in the worker's environment, never by changing global process state.
Invalid workspace or exclusion context requires clarification before SDK discovery.
Excessive launcher chains fail rather than executing an unchecked remainder.
CLI and Claude use existing native Pi provider configuration, not providers registered only by an ordinary extension.
Missing SDK support is unavailable, never an implicit download.

## Verification and measurement limits

`test/package-jev-client.test.ts` covers numeric validation, pinned requests, cancellation, input limits, and credential-literal rejection.
Its native bridge case uses a loopback TypeSafe-compatible service, synthetic evidence, a temporary Pi home, and a fake key.
`test/package-jev-discovery.test.ts` covers reviewed-source aliases, launcher chains, SDK entry symlinks, and excluded standalone SDK caches.
`test/package-jev-hook-deadline.test.ts` exercises the actual Claude hook against stalled discovery, blocked import, synchronous initialization, termination, and a loopback success.
`test/package-jev-process.test.ts` checks worker input/output bounds, malformed judgments, and parent cancellation.
It also covers helpers that outlive worker exit with inherited or closed streams, incomplete worker output, and abrupt caller death.
`test/package-jev-scope.test.ts` covers both adapters, deterministic precedence, clarification availability, branch changes, and non-authorizing low scores.
`test/package-jev-redirections.test.ts` checks file redirects, redirect-only statements, safe near misses, and parser precedence through both harnesses and the generated Pi bundle.
`tools/evaluation/tests/cases/change_jev.rs` exercises CLI assistance, unavailable fallback, unchanged snapshot access, retained findings, and stale assessments.
Its synthetic signal tests verify SIGINT and SIGTERM during planning and finding assessment without continuing the workflow.

Reports retain successful-call counts, reported token usage, and classifier process time.
Failed calls can incur unreported usage and time.
Main conversation-model session accounting does not necessarily include these classifier calls.
Synthetic provider responses verify wiring and boundaries, not semantic accuracy, live token costs, or end-to-end savings.
No cost saving or reduction in missed defects is established by this implementation.
A live evaluation of private source needs separate data-sharing approval and a measured comparison.
