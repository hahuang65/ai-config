# Test-only worker scheduling. The parent gate stays serial around this sub-make.
SHELL := /bin/bash
.DEFAULT_GOAL := installers
.PHONY: installers installer-one installer-two

INSTALLER_FILES := $(wildcard test/package-install-*.test.ts)
# Balance measured file durations, including shared-staging safety coverage.
INSTALLER_ONE := $(filter test/package-install-rollback.test.ts test/package-install-records.test.ts test/package-install-paths.test.ts test/package-install-performance.test.ts test/package-install-entrypoints.test.ts test/package-install-lock.test.ts test/package-install-upgrade.test.ts,$(INSTALLER_FILES))
INSTALLER_TWO := $(filter-out $(INSTALLER_ONE),$(INSTALLER_FILES))
ifeq ($(strip $(INSTALLER_ONE)),)
$(error Installer worker one has no test files)
endif
ifeq ($(strip $(INSTALLER_TWO)),)
$(error Installer worker two has no test files)
endif

installers: installer-one installer-two

installer-one:
	@set -o pipefail; bun test $(INSTALLER_ONE) 2>&1 | while IFS= read -r line || [[ -n $$line ]]; do printf '[installer 1] %s\n' "$$line"; done

installer-two:
	@set -o pipefail; bun test $(INSTALLER_TWO) 2>&1 | while IFS= read -r line || [[ -n $$line ]]; do printf '[installer 2] %s\n' "$$line"; done
