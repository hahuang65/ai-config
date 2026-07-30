# ai-config — developer tasks. Run `make` (or `make help`) to list targets.
.DEFAULT_GOAL := help
SHELL := bash

.PHONY: help install bundle test test/content test/install test/guard test/meta

help: ## Show this help
	@printf '\n  \033[1mai-config\033[0m \033[2m— make targets\033[0m\n\n'
	@awk 'BEGIN{FS=":.*## "} /^[a-zA-Z0-9_\/-]+:.*## /{printf "  \033[36m%-15s\033[0m %s\n",$$1,$$2}' $(MAKEFILE_LIST)
	@printf '\n  \033[2mtip: VERBOSE=1 make test/content  shows every check\033[0m\n\n'

install: ## Symlink config into each harness root (~/.claude, ~/.pi/agent)
	@bash install.sh

bundle: ## Rebuild pi's self-contained guard extension bundle (pi can't resolve symlinked imports)
	@bun build harnesses/pi/extensions/guard-policies.ts --target=bun --outfile harnesses/pi/guard-policies.bundle.ts >/dev/null
	@printf '  rebuilt harnesses/pi/guard-policies.bundle.ts\n'

test: test/content test/install test/guard test/meta ## Run every check (all test/* targets)

test/content: ## Validate the shared authoring contract (skills, commands, agents, rules)
	@bash scripts/test-pipeline.sh content

test/install: ## Validate the install system + harness modules (manifests, isolation)
	@bash scripts/test-pipeline.sh install

test/guard: ## Run the guard-core + adapter + conformance suite (bun)
	@bun test shared/ test/

test/meta: ## Verify the validation pipeline catches planted errors
	@bash scripts/test-pipeline-self-test.sh
