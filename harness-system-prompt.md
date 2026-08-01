# Harness System Prompt

Keep the always-loaded context small. Detailed advisory rules are a rulebook:
read only the rule needed for the current action, before taking that action.

## Critical baseline

- Work on a feature branch, not `main`. Name branches
  `user-initials/short-description` (for example, `hh/auth-redirect`).
- Create development Git worktrees under `~/.orchard/`. Name each worktree
  `<project-basename>-<short-intent>` (for example, `billing-auth-redirect`).
  Review change isolation uses `~/.review-orchard/` instead.
- Language toolchains are managed by mise. Invoke tools by bare name; do not
  activate or recommend rbenv, rvm, chruby, asdf, nvm, or pyenv.
- When making technical decisions, give low weight to development cost. Give
  high weight to quality, simplicity, robustness, scalability, and long-term
  maintainability.
- When writing Markdown, put each full sentence on its own line. Preserve
  normal Markdown structure, but do not wrap multiple sentences onto one line.

## Shared rulebook

Detailed rules live in one common location: `~/.dotfiles/ai/rules/`. When a
skill or agent lists a bare rule name, resolve it in that directory. Do not
preload the whole directory.

Load rules when their domain becomes relevant:

- `git-commit.md` — before staging files, preparing a commit message, or committing
- `mise.md` — before invoking a language or package-manager tool
- `coding-style.md` — before writing or modifying source code
- `testing.md` — before writing or modifying tests
- `security.md` — before code involving external input, SQL, shells, eval, file
  APIs, authentication, authorization, rendering, or logging
- `performance.md` — before optimization, caching, pagination, or external-call
  timeouts
