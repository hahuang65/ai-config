---
description: Language toolchains are version-managed by mise on this computer. Read before invoking ruby, python, node, bundle, pip, npm, cargo, rspec, or any language tool — covers why mise activation is implicit (call tools by bare name, no `mise exec` prefix) and why rbenv / rvm / chruby / asdf / nvm / pyenv must be ignored even when their binaries exist.
---

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
