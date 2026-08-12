# Resolve GitHub review targets in isolation

Review change accepts explicit GitHub pull-request and branch URLs plus exact `gh:` identifiers without requiring the caller to enter a local checkout.
Browser URLs tolerate their supported suffixes, queries, and fragments but require the canonical GitHub HTTPS origin without credentials, nonstandard ports, or endpoint ambiguity; `gh:` identifiers reject those URL-only modifiers.
Pull-request shorthand recognizes only documented GitHub SSH and HTTPS remote transports without credentials and with canonical or default port forms.
It parses the requested repository identity before Git operations, acquires the repository without checkout under `~/.review-orchard/`, fetches there to establish current branch state without changing a user's source Git metadata, and freezes the selected scope to immutable objects before validation.
For a branch target, it strictly resolves read-only provider `id` plus canonical `nameWithOwner` metadata before clone.
After the no-checkout clone, it queries that immutable provider node ID for current canonical metadata plus selected and default branch OIDs and requires exact equality with the clone's corresponding OIDs.
Git transport cannot attest clone repository node identity, so these checks prove content equivalence rather than cryptographic repository-ID binding.
An A→B→A name-reuse race is safe when both OID pairs match; a provider failure, malformed response, missing ref, ID mismatch, or OID mismatch fails closed and cleans only recorded paths before remote materialization.
The requested identity only selects acquisition, while post-acquisition canonical provider metadata supplies the final `headRepository` for A5 classification.
Branch scope uses only the verified selected/default OIDs, and materialization receives only the exact selected OID, so unrelated clone refs cannot affect scope, trust, or execution.
Inside a local repository, exact local branch names take precedence over ambiguous shorthand such as `pull/59`; explicit GitHub URLs and `gh:` identifiers always select their named remote repository.
For matching-remote freshness, it reads `git remote get-url` as one raw record, removes only one Git output terminator, and rejects every remaining C0, C1, or DEL control before URL normalization or fetch.
This keeps convenient target resolution and freshness checks inside the existing disposable read-only boundary rather than trading them for source-checkout mutation or stale remote-tracking refs.
