# Ordinary package workers finish before installer or native runtime groups start.
SHELL := /bin/bash
.DEFAULT_GOAL := packages
.PHONY: packages package-one package-two

PACKAGE_FILES := $(filter-out test/package-worktree.test.ts test/package-claude-worktree-runtime.test.ts $(wildcard test/package-install-*.test.ts),$(wildcard test/package-*.test.ts)) $(wildcard test/reviewer-runtime.test.ts test/guards.test.ts test/cli-links.test.ts test/resolve-conflicts.test.ts)
# Keep discovery and WT lifecycle checks together, balanced against guard/LSP cases.
PACKAGE_ONE := $(filter test/package-claude-worktree.test.ts test/package-claude-discovery.test.ts test/package-pi-discovery.test.ts test/reviewer-runtime.test.ts test/package-pi-lsp-transport.test.ts,$(PACKAGE_FILES))
PACKAGE_TWO := $(filter-out $(PACKAGE_ONE),$(PACKAGE_FILES))
ifeq ($(strip $(PACKAGE_ONE)),)
$(error Ordinary package worker one has no test files)
endif
ifeq ($(strip $(PACKAGE_TWO)),)
$(error Ordinary package worker two has no test files)
endif

packages: package-one package-two

package-one:
	@set -o pipefail; bun test $(PACKAGE_ONE) 2>&1 | while IFS= read -r line || [[ -n $$line ]]; do printf '[package 1] %s\n' "$$line"; done

package-two:
	@set -o pipefail; bun test $(PACKAGE_TWO) 2>&1 | while IFS= read -r line || [[ -n $$line ]]; do printf '[package 2] %s\n' "$$line"; done
