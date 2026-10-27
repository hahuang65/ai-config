# Ordinary Claude and Pi resources. Installing into a real home is an explicit,
# separate ./install.sh invocation; this Makefile never retargets the live installation.
.DEFAULT_GOAL := help
.PHONY: help build test lint test-package test-worktree test-worklog test-artifact test-evaluation test-browser test-prepared build-evaluation-debug build-artifact-debug build-guard-parser build-guard-bundle build-language-servers build-pele build-pi-questions build-pi-checklist build-pi-specialists
.PHONY: _test-package-prepared _test-artifact-prepared _test-evaluation-prepared _test-browser-prepared
# Keep suites serial even with make -j; common build prerequisites run once.
# Ordinary package files, installers, WT parity, and native runtime groups use bounded workers.
.NOTPARALLEL:
WT_TEST_JOBS ?= 4
PACKAGE_TEST_JOBS ?= 2
ifneq ($(words $(PACKAGE_TEST_JOBS)),1)
$(error PACKAGE_TEST_JOBS must be 1 or 2)
endif
ifeq ($(filter 1 2,$(PACKAGE_TEST_JOBS)),)
$(error PACKAGE_TEST_JOBS must be 1 or 2)
endif
INSTALL_TEST_JOBS ?= 2
ifneq ($(words $(INSTALL_TEST_JOBS)),1)
$(error INSTALL_TEST_JOBS must be 1 or 2)
endif
ifeq ($(filter 1 2,$(INSTALL_TEST_JOBS)),)
$(error INSTALL_TEST_JOBS must be 1 or 2)
endif

help:
	@printf 'build  Bundle Pi adapters and Pele; build four Rust tools (locked dependencies; network allowed).\n'
	@printf 'test   Run the native package, review, worktree, worklog, and artifact tests.\n'
	@printf 'lint   Check install.sh and Rust formatting and lints.\n'
	@printf 'Focused: test-package, test-worktree, test-worklog, test-artifact, test-evaluation, test-browser.\n'
	@printf 'test-prepared runs the same tests without source-generating prerequisites; first run build build-evaluation-debug build-artifact-debug.\n'
	@printf 'Ordinary package files use two workers; PACKAGE_TEST_JOBS=1 runs them serially.\n'
	@printf 'Installer files use two workers; INSTALL_TEST_JOBS=1 runs them serially.\n'
	@printf 'WT parity uses up to four workers; WT_TEST_JOBS=1 runs it serially. Full test coverage is unchanged.\n'
	@printf 'Install explicitly with ./install.sh (builds first; live home requires separate approval).\n'

build-guard-parser:
	bun install --frozen-lockfile --ignore-scripts --omit peer
	node tools/build-guard-parser.mjs

build-guard-bundle: build-guard-parser
	bun build harnesses/pi/guard-policies.ts --target node --format esm --outfile harnesses/pi/guard-policies.bundle.ts

build-language-servers: build-guard-parser
	bun tools/build-language-servers.mjs
	bun build harnesses/pi/lsp.ts --target node --format esm --external @earendil-works/pi-coding-agent --external typebox --outfile harnesses/pi/lsp.bundle.ts

build-pele: build-guard-parser
	bun tools/build-pele.mjs

build-pi-questions:
	bun build harnesses/pi/ask-user-question.ts --target node --format esm --external @earendil-works/pi-coding-agent --external typebox --outfile harnesses/pi/ask-user-question.bundle.ts

build-pi-checklist:
	bun build harnesses/pi/todo.ts --target node --format esm --external @earendil-works/pi-coding-agent --external @earendil-works/pi-tui --external typebox --outfile harnesses/pi/todo.bundle.ts

build-pi-specialists: build-guard-parser
	node tools/build-specialists.mjs
	bun build harnesses/pi/specialists.ts --target node --format esm --external @earendil-works/pi-coding-agent --external typebox --outfile harnesses/pi/specialists.bundle.ts

build: build-guard-bundle build-language-servers build-pele build-pi-questions build-pi-checklist build-pi-specialists
	bun tools/build-status-footer.mjs
	bun build harnesses/pi/worktree.ts --target node --format esm --external @earendil-works/pi-coding-agent --external @sinclair/typebox --outfile harnesses/pi/worktree.bundle.ts
	bun build harnesses/pi/review-feedback.ts --target node --format esm --external @earendil-works/pi-coding-agent --outfile harnesses/pi/review-feedback.bundle.ts
	cargo build --locked --release --manifest-path tools/worktree/Cargo.toml
	cargo build --locked --release --manifest-path tools/worklog/Cargo.toml
	cargo build --locked --release --manifest-path tools/artifact-review/Cargo.toml
	cargo build --locked --release --manifest-path tools/evaluation/Cargo.toml

test: test-package test-worktree test-worklog test-artifact test-evaluation test-browser

# Run only after a successful current build, including both debug support targets.
# Keep every assertion recipe; omit only source-producing preparation prerequisites.
test-prepared: _test-package-prepared test-worktree test-worklog _test-artifact-prepared _test-evaluation-prepared _test-browser-prepared

build-evaluation-debug:
	cargo build --locked --manifest-path tools/evaluation/Cargo.toml
	cargo build --locked --manifest-path tools/evaluation/Cargo.toml --example reviewer-fixture

build-artifact-debug: build-pele
	cargo build --locked --manifest-path tools/artifact-review/Cargo.toml

test-package: build build-evaluation-debug

test-package _test-package-prepared:
	$(MAKE) --no-print-directory -f test/packages.mk -j$(PACKAGE_TEST_JOBS)
	$(MAKE) --no-print-directory -f test/installers.mk -j$(INSTALL_TEST_JOBS)
	bun test --concurrent --max-concurrency=2 test/package-worktree.test.ts
	bun test --concurrent --max-concurrency=2 test/package-claude-worktree-runtime.test.ts

test-worktree:
	cargo test --locked --manifest-path tools/worktree/Cargo.toml
	cargo build --locked --manifest-path tools/worktree/Cargo.toml
	python -m unittest discover -s tools/worktree/tests -p parallel_runner_tests.py -v
	python tools/worktree/tests/rust_parity.py --jobs $(WT_TEST_JOBS)

test-worklog:
	cargo test --locked --manifest-path tools/worklog/Cargo.toml

test-artifact: build-pele

test-artifact _test-artifact-prepared:
	cargo test --locked --manifest-path tools/artifact-review/Cargo.toml

test-evaluation: build build-evaluation-debug

test-evaluation _test-evaluation-prepared:
	cargo test --locked --manifest-path tools/evaluation/Cargo.toml --lib --tests

test-browser: build-guard-bundle build-evaluation-debug build-artifact-debug

test-browser _test-browser-prepared:
	node --test --test-concurrency=1 tools/artifact-review/tests/integration.mjs

lint: build-pele
	bun tools/build-language-servers.mjs --check
	shellcheck install.sh
	$(MAKE) -C tools/worktree lint
	$(MAKE) -C tools/worklog lint
	cargo fmt --check --manifest-path tools/evaluation/Cargo.toml
	cargo clippy --all-targets --locked --manifest-path tools/evaluation/Cargo.toml -- -D warnings
	cargo fmt --check --manifest-path tools/artifact-review/Cargo.toml
	cargo clippy --all-targets --locked --manifest-path tools/artifact-review/Cargo.toml -- -D warnings
