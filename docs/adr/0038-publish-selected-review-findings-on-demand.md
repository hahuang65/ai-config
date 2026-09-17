# Publish selected Review change Findings on demand

A reviewer leaves a pull-request report open, returns days later, excludes two irrelevant Findings, and posts the remaining review without an active harness session.
A per-report listener would waste resources while an agent poll would eventually expire.

Pull-request Review change reports will offer a Review publication through one user-scoped, socket-activated local publisher.
The operating system starts a publisher process for each confirmation or publication request, and that process exits after handling exactly one bounded request.
The temporary HTML carries signed, bounded publication data instead of relying on retained per-report state.
Before the model runs, a trusted invocation boundary freezes the GitHub host, repository and pull-request identities, exact base and head commits, signing-key identifier, and comment-template version in a signed scope.
The standalone CLI parent owns this boundary for CLI runs.
For a direct pi invocation, the installed input extension captures the user's exact pull-request target before reviewer work, keeps it across steering input, and the structured tool accepts only Finding claims when it renders the form.
For a direct Claude Code invocation, the installed `UserPromptSubmit` hook captures and signs the exact target before model work, stores it as current-session state, and supplies only public identity to the model.
Its `PreToolUse` `Write` hook accepts Finding claims only and replaces them with the signed form for the current invocation.
Both harnesses use the same code to freeze the scope and verify its signature.
Every production report-signing operation requires the repository, pull request, base commit, and head commit frozen for the current invocation; no generic production signer accepts unfrozen model-authored claims.
The mandatory shared guardrails classify the complete managed `~/.review-publication/` directory and Claude Code's `~/.claude/review-publication-sessions/` directory as protected credential and session state, blocking ordinary Claude Code and pi model file and shell tools while leaving the separately installed socket worker and trusted pre-model harness boundaries able to use that state.
Each saved Claude Code publication scope is bound to its exact session identifier and is rejected if a valid state file is copied to another session.
This is a practical protection against mistakes and ordinary model tool use, not operating-system isolation from hostile code that already executes with unrestricted user-account access.
The trusted signer creates the random report identity, rejects changed scope claims, and renders the publication form through shared deterministic code.
The publisher uses the authenticated `gh` account, verifies the exact open pull-request base and head, derives the general comment from the selected Findings, and shows the complete selection in the browser.
The browser's Post review action requests publication but does not authorize provider mutation.
After the signed confirmation token and exact selected content pass validation, the socket-activated publisher uses an installation-owned absolute executable to show a bounded operating-system confirmation outside model-visible channels.
That prompt identifies the exact actor, repository, pull request, base commit, head commit, selected Finding count, and whether inline comments are included.
Only explicit operating-system approval lets the provider publication stage begin; cancellation, dismissal, timeout, unavailable UI, invalid output, and process failure stop without mutation.
Neither the general comment nor Finding comments are manually editable.

## Considered Options

- A live agent poll or per-report listener was rejected because it consumes resources before the user acts and cannot reliably wait for days.
- Direct browser access to GitHub was rejected because it would expose credentials and depend on browser cross-origin behavior.
- A retained publication record was rejected because the open temporary report is sufficient authority and losing the report may safely end publication.

## Consequences

Publication fails without partial posting when the invocation-frozen repository, pull request, base, or head differs, a selected inline location is invalid, the authenticated GitHub account changed, or provider validation fails.
The operating-system prompt is the final authorization boundary, immediately before the provider stage that can mutate.
A stable hidden publication marker supports duplicate detection through GitHub without retaining per-report local state.
Publication work is serialized by a filesystem-safe digest of the validated report identity, so two different reports do not block each other.
The worker derives its platform from the runtime and reads the installed absolute GitHub CLI and confirmation executable paths from protected installation-owned configuration.
macOS uses `osascript`, and Linux uses Zenity from the active user session.
Installation or publication fails clearly when the platform confirmation facility is unavailable.
Non-pull-request reports remain presentation-only.
Pull-request reports replace the manual provider-comment copy panels with the publication form.
