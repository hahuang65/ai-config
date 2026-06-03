# Project Tooling & Verification Loop

Shared reference for `implement`, `implement-coach`, and `refactor`. Defines how to detect a project's toolchain and the verification loop to run after changes.

## Detect the toolchain

Identify the project's language and tooling from its config files. Use what the project already uses — never introduce a new tool.

| Config file | Language | Test runner | Linter | Type checker | Build |
|------------|----------|-------------|--------|--------------|-------|
| `pyproject.toml` / `setup.py` | Python | `pytest` | `ruff check .` | `mypy .` | — |
| `Cargo.toml` | Rust | `cargo test` | `cargo clippy` | (built-in) | `cargo build` |
| `go.mod` | Go | `go test ./...` | `golangci-lint run` | `go vet ./...` | `go build ./...` |
| `Gemfile` | Ruby | `bundle exec rspec` | `rubocop` | `bundle exec srb tc` | — |
| `Makefile` | (varies) | `test` target | `lint` target | `typecheck` target | `build` target |

If the language isn't listed, infer the tools from the project's config (`.rubocop.yml`, `tsconfig.json`, etc.).

## Verification loop

After the work is done, run this loop. It is **not optional**.

1. **Type check** — `mypy`, `go vet`, `bundle exec srb tc`, etc.
2. **Lint** — `ruff check .`, `rubocop`, `golangci-lint run`, etc.
3. **Test** — the full test suite; every test must pass.
4. **Build** — if a build command exists.

If any step fails, fix the issue and re-run the loop. Where applicable, fix via TDD — add a failing test that reproduces the problem, then make it pass. Repeat until all four steps pass cleanly.

**Linter errors are failures, not warnings.** They block the current step — fix them before proceeding.
