.PHONY: build test reference-test rust-test lint

build:
	cargo build --release --locked

test: reference-test rust-test

reference-test:
	python -m unittest discover -s tests -v

rust-test:
	cargo test --locked
	cargo build --locked
	python tests/rust_parity.py

lint:
	cargo fmt --check
	cargo clippy --all-targets --locked -- -D warnings
