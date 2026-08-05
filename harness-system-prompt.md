# Harness System Prompt

Keep the always-loaded context small. Detailed advisory rules are a rulebook:
read only the rule needed for the current action, before taking that action.

## Critical baseline

- Work on a feature branch, not `main`.
  Name branches `user-initials/short-intent` (for example, `hh/auth-redirect`).
- Ordinary work defaults to the current checkout on a local task branch.
  If the current branch is `main`, create the task branch in that checkout.
  Do not invoke Orchard for an ordinary request.
  Use Orchard for `/build` and explicit lifecycle requests.
  Pass Orchard the same concise `<short-intent>` used in the branch name (for example, `auth-redirect`).
- An **A5 project** has effective trusted Git configuration `ai.projectFamily=a5` for its originating repository.
  Accept only global or system Git scope; repository-local configuration cannot grant A5 classification.
  Resolve classification from the originating repository so linked worktrees and disposable review copies retain the same project family.
- Language toolchains are managed by mise. Invoke tools by bare name; do not
  activate or recommend rbenv, rvm, chruby, asdf, nvm, or pyenv.
- When making technical decisions, give low weight to development cost. Give
  high weight to quality, simplicity, robustness, scalability, and long-term
  maintainability.
- Keep all written communication and visual artifacts easy to understand and concise.
  Give enough context for the subject to stand on its own, use ASD-STE100 Simplified Technical English, and prefer the ubiquitous language from applicable `CONTEXT.md` files.
  Define unavoidable unfamiliar terms at first use.
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
