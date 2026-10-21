.PHONY: build test reference-test rust-test lint
WT_TEST_JOBS ?= 4

build:
	cargo build --release --locked

test: reference-test rust-test

reference-test:
	python -m unittest discover -s tests -v

rust-test:
	cargo test --locked
	cargo build --locked
	python -m unittest discover -s tests -p parallel_runner_tests.py -v
	python tests/rust_parity.py --jobs $(WT_TEST_JOBS)

lint:
	bash -n src/completion.bash
	shellcheck --shell=bash src/completion.bash
	cargo fmt --check
	cargo clippy --all-targets --locked -- -D warnings
