---
name: code-cleaner
description: Clean up implementation code after tests pass — consolidate duplication, improve reuse and readability, remove cruft. Never changes behavior, never modifies tests. Run as the cleanup step of the post-implementation review chain.
argument-hint: "[paths or area to clean — defaults to the changed files]"
---

# Code Cleaner

Clean up implementation code: improve reuse, quality, and efficiency without changing behavior. Run **after tests pass and the verification loop is clean** — this is the cleanup step of the post-implementation review chain.

> Named `code-cleaner`, **not** `simplify`, on purpose: `/simplify` is a Claude Code built-in, so a same-named skill would shadow it and create confusion about which one runs. `code-cleaner` is our own, available on every harness.

## What to Do

- **Reuse over duplication.** Consolidate duplicated logic into an existing helper; prefer what the codebase already provides over adding new code.
- **Simplify.** Early returns over nested conditionals, built-in helpers over hand-rolled loops; drop unnecessary intermediate variables and overly verbose expressions.
- **Remove cruft.** Unused imports, unreachable branches, commented-out code, dead variables.
- **Apply language conventions.** Idiomatic patterns, naming, and formatting for the project's language.

## Linter / type checker

Detect the project's toolchain and run its linter and type checker after each cleanup batch — see [../shared/references/tooling.md](../shared/references/tooling.md).

## Rules

- **Never change behavior.** Only remove or simplify — don't add functionality.
- **Never modify tests.** Tests are the safety net.
- **Keep tests passing after every change.** Re-run the suite after each cleanup batch; revert a change that turns a test red.
- **When unsure whether a change is safe, flag it** rather than making it. Surface behavioral-judgment calls to the user; apply only the mechanical, obviously-safe improvements directly (in coach mode, the user decides the judgment calls).

Do NOT commit to version control unless the user explicitly asks.
