# Ordinary Claude and Pi resources. Installing into a real home is an explicit,
# separate Rust command; this Makefile never retargets the live installation.
.DEFAULT_GOAL := help
.PHONY: help build test lint

help:
	@printf 'build  Bundle the Pi guard and build the four Rust tools (offline).\n'
	@printf 'test   Run the native package, review, worktree, worklog, and artifact tests.\n'
	@printf 'lint   Check Rust formatting and lints.\n'
	@printf 'Install only with tools/evaluation/target/release/ai-config --root "$$(pwd -P)" install\n'

build:
	bun build harnesses/pi/guard-policies.ts --target node --format esm --outfile harnesses/pi/guard-policies.bundle.ts
	bun tools/build-status-footer.mjs
	cargo build --locked --offline --release --manifest-path tools/worktree/Cargo.toml
	cargo build --locked --offline --release --manifest-path tools/worklog/Cargo.toml
	cargo build --locked --offline --release --manifest-path tools/artifact-review/Cargo.toml
	cargo build --locked --offline --release --manifest-path tools/evaluation/Cargo.toml

test: build
	cargo build --locked --offline --manifest-path tools/evaluation/Cargo.toml
	bun test $(wildcard test/package-*.test.ts) test/reviewer-runtime.test.ts test/guards.test.ts test/cli-links.test.ts test/resolve-conflicts.test.ts
	cargo test --locked --offline --manifest-path tools/worktree/Cargo.toml
	cargo build --locked --offline --manifest-path tools/worktree/Cargo.toml
	python tools/worktree/tests/rust_parity.py
	cargo test --locked --offline --manifest-path tools/worklog/Cargo.toml
	cargo test --locked --offline --manifest-path tools/artifact-review/Cargo.toml
	cargo test --locked --offline --manifest-path tools/evaluation/Cargo.toml --lib --tests
	cargo build --locked --offline --manifest-path tools/artifact-review/Cargo.toml
	node --test --test-concurrency=1 tools/artifact-review/tests/integration.mjs

lint:
	$(MAKE) -C tools/worktree lint
	$(MAKE) -C tools/worklog lint
	cargo fmt --check --manifest-path tools/evaluation/Cargo.toml
	cargo clippy --all-targets --locked --offline --manifest-path tools/evaluation/Cargo.toml -- -D warnings
	cargo fmt --check --manifest-path tools/artifact-review/Cargo.toml
	cargo clippy --all-targets --locked --offline --manifest-path tools/artifact-review/Cargo.toml -- -D warnings
