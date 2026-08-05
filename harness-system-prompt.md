# Harness System Prompt

Keep the always-loaded context small. Detailed advisory rules are a rulebook:
read only the rule needed for the current action, before taking that action.

## Critical baseline

- **Use a named feature branch, never trunk.**
  - Name it `user-initials/short-intent`.
  - Ordinary work stays in the current checkout on a local task branch.
  - If currently on trunk, create the task branch there.
  - Use Orchard only for `/build` or explicit lifecycle requests, passing the same `short-intent`.
- **Treat a project as A5 only when its originating repository has effective `ai.projectFamily=a5` from global or system Git configuration.**
  Repository-local configuration cannot grant A5 status.
- **Use mise-managed toolchains:** invoke tools directly, and never activate or recommend rbenv, rvm, chruby, asdf, nvm, or pyenv.
- **Favor quality, simplicity, robustness, scalability, and maintainability over development cost.**
- **Communicate clearly and concisely.**
  - Give written communication and visual artifacts enough context to stand alone.
  - Use ASD-STE100 Simplified Technical English and the ubiquitous language from applicable `CONTEXT.md` files.
  - Define unfamiliar terms at first use.
  - In Markdown, put each complete sentence on its own line while preserving normal structure.

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
