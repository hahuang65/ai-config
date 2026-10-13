# Change review CLI

Build the Rust binaries with `make build`, then invoke `tools/evaluation/target/release/review-change-eval` (also linked at `~/.local/bin/review-change-eval` after approved package installation).
Neither review nor posting runs as part of the package installer.

```text
review-change-eval review local --repo DIR --intent TEXT --engine pi --json
review-change-eval review range BASE..HEAD --repo DIR --intent TEXT --engine pi --json
review-change-eval review pr https://github.com/OWNER/REPO/pull/NUMBER --repo DIR --intent TEXT --engine pi --json
review-change-eval post /absolute/report.html [--state-dir DIR]
```

The reviewed repository must be explicit and the review intent must describe its intended behavior.
`local` compares HEAD to the working state; `range` compares two committed endpoints.
`--path` limits evidence to a literal relative file or directory, never a glob.
The Rust command freezes bounded, eligible source evidence, rejects modified or missing evidence, then invokes a restricted reviewer that cannot edit, run source code, or publish.
Pi uses an ephemeral isolated profile with no ordinary extensions, skills, or project context and a link to existing authentication when present; Claude review is independently available with `--engine claude`.
Neither mode imports evaluation `.state/pi` or historical agentmemory data.

Retained private reports and signatures default to `~/.local/state/ai-config/change-reviews`.
`--state-dir` selects a separate private location, including when reviewing this source checkout.
JSON mode never opens a browser or posts.
A normal terminal review opens the escaped, self-contained HTML report in the ordinary browser, while artifact approval remains a separate workflow.
The report states successful file reads, exclusions, uncertainty, and that tests were not run by the restricted reviewer.

Retained signatures bind report records and HTML bytes, but the signing key and records are accessible to programs running as the same operating-system user.
A same-user agent could change both, so the signature does **not** establish report integrity against that agent.
This is an accepted risk for the present human-reviewed workflow, not a claim of tamper resistance.
The human inspects the report, and posting pull-request findings separately requires an exact preview and confirmation in a human terminal.
That confirmation alone cannot establish that a saved report was never altered; revisit this risk if independent authenticity or posting without human review becomes necessary.

For GitHub pull requests, posting uses a separately selected, retained report; no review command grants posting authority.
Only the human runs `post REPORT` in an interactive terminal, confirms the exact preview, and sends comments (`COMMENT`, not `APPROVE` or `REQUEST_CHANGES`).
A failed or uncertain post must be reconciled from the same retained report, not bypassed with an independent request.
Read `review-change-eval --help` for current argument limits and error codes.
