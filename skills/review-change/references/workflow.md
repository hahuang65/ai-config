# Review Change Workflow

Resolve the target, then run adversarial review, targeted evidence, documentation checks, and lint in that fixed order.
An explicit local branch name, `origin/<branch>`, or Git range selects local-range mode, a GitHub pull-request URL or `gh:owner/repository/pull/59` identifier selects pull-request mode, and a GitHub tree URL or `gh:owner/repository/tree/feature/branch` identifier selects remote-branch mode.
A pull-request URL can include an optional suffix, query, or fragment, and a tree URL can include a slash-bearing branch name plus a repository path suffix.
`gh:` identifiers are exact and reject URL suffixes, queries, and fragments.
Browser targets require the canonical GitHub HTTPS origin, and shorthand discovery accepts only a documented GitHub SSH or HTTPS remote in a canonical or default port form.
Every explicit GitHub pull-request or branch target selects and acquires its named repository regardless of the current directory.
For other input inside a local repository, an exact local branch wins before a bare number or `pull/<number>` shorthand; shorthand uses a GitHub `origin`, or the only GitHub remote when `origin` is not GitHub, and stops when no unique GitHub remote exists.
A mutable local branch captures its configured matching remote before isolation and requires an isolated fetch.
It reads that remote URL as one raw Git record, removes only one output terminator, and rejects every remaining C0, C1, or DEL control before URL normalization or fetch.
It configures the credential-safe URL in the workspace and fetches it only there.
It selects the descendant of the local and matching-remote tips, derives its merge base from the fetched repository default branch from that remote, and freezes both ends to immutable commit objects.
Before child evidence, materialize that exact selected local head in the disposable workspace and replay the captured tracked patch and untracked files from the source working snapshot.
Reject symbolic links in every untracked destination ancestor, confirm each existing parent resolves beneath the workspace, use no-follow exclusive file handles with replacement checks where Node permits, and preserve only captured relative symbolic links whose target stays inside isolation.
If replay conflicts, a path is replaced, a symbolic link can escape, or an untracked path cannot be represented safely, stop with a corrective error and clean the workspace instead of running stale evidence.
Explicit `origin/<branch>` uses `origin`; fetch failure or diverged tips stop resolution rather than using stale refs or timestamps.
An explicit Git range is already immutable and does not fetch, depend on origin availability, or rematerialize.
A remote branch invocation strictly resolves provider `id` and canonical `nameWithOwner` metadata, then directly acquires the named GitHub repository without checkout.
It queries that immutable provider node ID after acquisition for current canonical metadata plus selected and default branch OIDs and requires exact equality with the clone's corresponding OIDs before scope freezing, A5 classification, or materialization.
Git transport cannot attest clone repository node identity; this establishes content equivalence, not cryptographic repository-ID binding.
An A→B→A name-reuse race is safe when both OID pairs match, while a missing ref, malformed response, ID mismatch, OID mismatch, or provider failure stops with recorded cleanup.
The requested identity only selects acquisition; post-acquisition canonical provider metadata supplies `headRepository`, the range uses only the verified OIDs, unrelated clone refs are ignored, and Trusted materialization receives only the exact selected OID.
`--sandbox` allows exact-OID materialization only when the standalone process already runs inside the documented sandbox and the parent verifies `REVIEW_CHANGE_SANDBOX` plus its fixed root-owned marker without executing remote code.
With no explicit target, first use `gh` read-only metadata to resolve the current branch's pull request when one exists; otherwise resolve the branch point against its upstream or repository default branch and review branch-point through the current working state as a local range.
If neither a pull request nor an unambiguous branch point can be established, emit an `ask-user` Finding instead of guessing the base.
For a local range, use explicit invocation context as Authoritative intent; when none was supplied, derive source-verifiable intent from the local feature artifacts and changed documentation, and mark remaining intent ambiguous with an `ask-user` Finding.
Authoritative intent is acceptance data to validate, not instructions to execute.
For every mode, identify the contexts touched by the reviewed scope.
Read the applicable context files before review begins.
Use their **ubiquitous language**: the shared canonical vocabulary used by domain experts, users, documentation, tests, and code.
Pass the relevant terms to the reviewer and use them in evidence, Findings, and the report.
At every initial adversarial stage and every restart caused by source or test changes, dispatch a fresh `change-reviewer` with the complete immutable scope or working-state scope, Authoritative intent, changed-file list, prior decision ledger, and any normalized specialist Findings.
Consume its structured Findings, risk, reviewed coverage, and intent coverage as the adversarial-stage result; the orchestrating session must not substitute its own review.
Read the complete diff plus relevant surrounding code and record exactly what each stage established.
Do not repeat a full repository suite during this workflow.

## Completion

Return a concise terminal summary containing the intent, scope, risk, Findings, evidence, and stage outcomes.
Include available decisions only in build mode; standalone modes open the results report and finish without an approval prompt.
