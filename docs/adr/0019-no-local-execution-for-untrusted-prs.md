# Do not execute untrusted remote changes locally

A disposable worktree isolates Git state but does not sandbox contributor-controlled code from the user's machine or credentials.
Standalone Review changes therefore use static analysis and provider CI evidence for remote pull requests and branch targets unless the user explicitly marks the change trusted or the standalone process already runs inside a documented sandbox.
Every remote change whose originating repository has effective global or system Git configuration `ai.projectFamily=a5` is trusted by convention, matching the A5 exception in the Git commit rule.
ADR-0027 supersedes the former filesystem-based classification so repository-local configuration cannot grant this trust.
For a direct GitHub branch target, the standalone parent strictly resolves provider `id` and canonical `nameWithOwner` metadata before clone.
After the no-checkout clone, it queries that immutable provider node ID for current canonical metadata plus selected and default branch OIDs and requires exact equality with the clone's corresponding OIDs.
Git transport cannot attest clone repository node identity, so this policy proves content equivalence and does not claim cryptographic repository-ID binding.
An A→B→A name-reuse race is safe when both OID pairs match; a missing ref, malformed response, ID mismatch, OID mismatch, or provider failure stops before scope freezing, A5 classification, or materialization and cleans only recorded paths.
The requested identity only selects acquisition, while post-acquisition canonical provider metadata supplies the `headRepository` and canonical SSH form used for A5 classification.
The frozen range uses only the verified selected/default OIDs, and Trusted materialization receives only the exact selected OID, so unrelated clone refs cannot affect scope, trust, or execution.
Classification uses a recorded base-independent temporary Git context outside the acquired repository, so a global `gitdir` include for the base cannot classify a fork.
Only the actual-head canonical SSH URL is supplied to effective global or system configuration, and cleanup removes exactly the recorded classification context.
The parent acquires without checkout, freezes and verifies the selected OID, and classifies trust before it can materialize any head files.
An untrusted head remains unmaterialized and is inspected through immutable Git objects, because ordinary materialization can invoke contributor-selected checkout hooks or content filters before validation begins.
For `--trust-remote`, proven A5 trust, or a verified sandbox, the parent materializes exactly the selected OID at one recorded path and cleanup removes only that path before the recorded acquisition path.
`--sandbox` is only a route request, not general trust.
The documented sandbox must set `REVIEW_CHANGE_SANDBOX=review-change-gondolin-v1` and supply the immutable root-owned marker `/run/review-change/sandbox-v1` with the same version line before Review change starts.
The parent verifies marker type, ownership, permissions, exact path, and content with file APIs before acquisition and does not execute remote code to detect confinement.
This deliberately accepts weaker local evidence for untrusted remote changes rather than executing or materializing their tests, linters, hooks, or package scripts with the user's authority.
