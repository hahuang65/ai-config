# Do not execute untrusted pull requests locally

A disposable worktree isolates Git state but does not sandbox contributor-controlled code from the user's machine or credentials.
Standalone Review changes therefore use static analysis and provider CI evidence for remote pull requests unless the user explicitly marks the change trusted or the project supplies a documented sandbox.
Pull requests originating from a repository whose primary working tree is under `~/Projects/a5/` are trusted by convention, matching the existing A5 exception in the Git commit rule.
An untrusted head is attached with a no-checkout detached worktree and inspected through immutable Git objects, because ordinary materialization can invoke contributor-selected checkout hooks or content filters before validation begins.
This deliberately accepts weaker local evidence for untrusted pull requests rather than executing or materializing their tests, linters, hooks, or package scripts with the user's authority.
