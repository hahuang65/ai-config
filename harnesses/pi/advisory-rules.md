<!-- GENERATED from rules/*.md by scripts/gen-pi-agents.sh — do not edit by hand; run `make rules`. -->

# Advisory rules

Always-on guidance shared across every harness. This is guidance, not
enforcement: the dangerous-action guardrails are blocked mechanically by the
guard extension regardless of what these say.


<!-- rule: coding-style -->


# Coding Style

- Prefer immutability. Return new objects instead of mutating. Use `const`, `final`, `frozen`, or the language equivalent by default.
- Keep files under 400 lines. If a file exceeds this, extract modules.
- Keep functions under 50 lines. If a function exceeds this, split it.
- Max 3 levels of nesting. Flatten with early returns and guard clauses.
- No dead code. Remove unused imports, variables, functions, and commented-out code.
- Name things precisely. A function name should describe what it does. A variable name should describe what it holds. Avoid generic names like `data`, `info`, `item`, `temp`, `result`.
- No magic numbers or strings. Extract constants with descriptive names.
- Prefer explicit over implicit. Avoid clever tricks that sacrifice readability.
- Error handling at boundaries. Validate inputs at system edges (API handlers, CLI parsers, file readers). Trust internal code once validated.
- One abstraction per file. Each file should have a single clear responsibility.


<!-- rule: git-commit -->


# Git Commit

Always-on policy for staging and committing. Destructive-command blockers (force-push, `--no-verify`, hard reset) live in `no-git-destructive.md`; this file is about *what a normal commit should contain and how its message should read*.

## Commit message format

**Authoritative source: `@~/.gitmessage`.** Before writing a commit message, read that file and follow its template exactly — it defines the section order (subject, body, annotations), the allowed `TYPE` set, and the formatting rules. If the file does not exist, fall back to the summary below.

Fallback summary (used only when `~/.gitmessage` is absent):

- Subject line: `TYPE: imperative-mood description`, capitalized, no trailing period, ≤ 72 chars.
- Blank line, then a body that answers *what* this change is and *why* it is being made.
- Blank line, then an annotations block with links to issue-tracker tickets and any helpful articles.
- Allowed types: `FEATURE`, `FIX`, `REFACTOR`, `STYLE`, `DOCS`, `TEST`, `CHORE`.
- Use the body to explain what and why, not how. Bullets with `-` are fine.

## Branching

- Work on feature branches, not main
- Branch names: `type/short-description` (e.g., `feature/cursor-pagination`, `fix/auth-redirect`)

## Staging policy

- Commit early and often. Small, focused commits are easier to review and revert.
- Each commit should be a single logical change. Don't mix refactoring with feature work.
- Never commit secrets, credentials, or `.env` files.
- When committing changes, always check for corresponding files in `docs/features/` (research documents, plans, architecture diagrams) that were created or modified as part of the work. Include them in the commit unless they are ignored by any git mechanism (`.gitignore`, `.git/info/exclude`, or `core.excludesFile`). These artifacts are part of the feature's history.

### Exception: ~/Projects/a5/**

For any repo whose working tree lives under `~/Projects/a5/`:

- NEVER explicitly stage `CONTEXT.md`, `docs/adr/**`, or `docs/features/**`, even by exact path. Explicit `git add <path>` bypasses excludes — the directive is what stops the agent from working around the git layer.
- NEVER propose adding these to a tracked `.gitignore`; teammates have not opted in.
- If `git status` lists them as untracked, leave them untracked.
- They are already excluded by `~/.config/git/a5.gitignore`, loaded via an `includeIf "gitdir:~/Projects/a5/"` rule in `~/.gitconfig`. The git layer is the safety net; this rule is the agent-side enforcement.


<!-- rule: mise -->


# Mise manages everything

Every language toolchain on this computer — Ruby, Python, Node, Go, Rust, etc. — is installed and version-managed through [mise](https://mise.jdx.dev/). This applies both inside and outside git-tracked projects.

## Inside a git-tracked project

Every git-tracked project on this computer pins its language versions via mise. The pin lives in one of:

- `.mise.toml` / `mise.toml`
- `.tool-versions`
- A language-specific file mise reads (`.ruby-version`, `.nvmrc`, `.python-version`, etc.)

The shell is configured with mise's activation hook, so the correct tool versions are on `PATH` the moment you `cd` into the project. **Invoke tools by name** — `bundle install`, `python script.py`, `node app.js`, `cargo build`, `rspec`. Do not prefix with `mise exec --` or `mise x --`; it's redundant and clutters output.

## Outside a git-tracked project (e.g. `$HOME`)

Tools in non-project directories are also installed by mise and resolve directly on `PATH` via global mise config. Same rule: **invoke by name**, no `mise exec` prefix.

## Other version managers

Binaries for `rbenv`, `rvm`, `chruby`, `asdf`, `nvm`, `pyenv`, `pyenv-virtualenv`, and friends may exist on the system. Ignore them. Do not run their activation snippets (`eval "$(rbenv init -)"`, `source ~/.rvm/scripts/rvm`, `source ~/.asdf/asdf.sh`, etc.) and do not suggest them to the user.

If a session-start skill or hook asks you to pick a version manager — the `ruby-skills:ruby-version-manager` skill, for instance, will fire on any project with a `Gemfile` and offer you a choice — the answer is always **mise**. Skip the prompt, do not run the skill's `detect.sh`, and proceed with bare tool invocations.

## Version mismatches

If a command fails because the resolved toolchain version is wrong, do **not** edit `.mise.toml` / `.tool-versions` / `.ruby-version` to "fix" it. Re-plan as a hand-off:

- Tell the user which version mise resolved and which version the project expects
- Wait for the user to install the missing version (`mise install`) or correct the pin themselves


<!-- rule: performance -->


# Performance & Model Selection

## Model routing guidance

Choose the right model for the task:

- **Haiku**: Deterministic, low-risk mechanical changes. Renaming, reformatting, simple find-and-replace, generating boilerplate, running linters. Fast and cheap.
- **Sonnet**: Default for most work. Implementation, refactoring, bug fixes, code review, test writing. Covers ~90% of tasks.
- **Opus**: Architecture decisions, deep code review, ambiguous requirements, complex multi-file refactors, planning phases. Use when accuracy matters more than speed.

When in doubt, start with Sonnet. Escalate to Opus if the task requires reasoning across many files or making judgment calls about design.

## General performance

- Profile before optimizing. Never guess at bottlenecks.
- Prefer algorithmic improvements over micro-optimizations.
- Cache expensive computations. Invalidate caches explicitly.
- Use pagination for list endpoints. Default to cursor-based for large datasets.
- Lazy-load heavy resources. Load code, images, and data only when needed.
- Set timeouts on all external calls. No unbounded waits for HTTP requests, database queries, or subprocess execution.


<!-- rule: security -->


# Security

Watch for these anti-patterns when writing or editing code, and re-plan with the safe alternative. (Hardcoded secret literals are blocked outright by the guard core — see `no-hardcoded-secret`; this rule covers the fuzzier patterns that are guidance, not hard blocks.)

Common triggers and the fix:

- **String-concatenated SQL** → Use parameterized queries or prepared statements. Never concatenate user input into SQL, ORM queries, or shell commands.
- **User input passed directly to a file API** → Sanitize or reject paths from user input. Never feed `req.body`, `req.params`, or `req.query` into `fs.readFile`, `open()`, or similar without validation.
- **`eval()` on dynamic input** → Use a proper parser, lookup table, or AST. `eval` on anything touched by user input is a code-injection vector.
- **`child_process.exec` with string concatenation** → Use `execFile` or `spawn` with an args array. String concat into a shell is a command-injection vector.

Plus the always-on security rules this file enforces:

- Validate all external input with schema-based validation (user input, API request bodies, query parameters, file uploads, webhook payloads).
- Escape output before rendering in HTML, emails, or logs to prevent XSS.
- Authenticate and authorize every new API route — check auth, verify the caller has permission for the requested resource.
- Strip passwords, tokens, PII, and credit card numbers before logging.

Re-plan the edit with one of these patterns, then proceed.


<!-- rule: testing -->


# Testing

- TDD is the default. Write a failing test before writing implementation code. Red → Green → Refactor.
- Every behavioral change must have test coverage. No exceptions.
- Maximize shared setup. Use `before`/`let`/`subject`/`factory` blocks so common state is defined once. Each test should apply the bare minimum mutation for its scenario and assert.
- Test behavior, not implementation. Tests should verify what the code does, not how it does it. Avoid testing private methods or internal state.
- One assertion per test when possible. If a test needs multiple assertions, they should all verify the same behavior.
- Name tests as sentences that describe the expected behavior: "returns empty list when no results match", not "test_query_3".
- Keep test files next to the code they test, or in a parallel `test/` directory matching the source structure.
- No test interdependence. Each test must pass in isolation and in any order.
