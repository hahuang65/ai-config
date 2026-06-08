# Pi On-Demand Rules & Subagent Extension — Tasks

Source PRD: [prd.md](./prd.md)

## Slice 1: Pi manifest — add rules dir, remove AGENTS.md

**Type:** AFK
**Blocked by:** None — can start immediately
**User stories covered:** 1, 4, 5

### What to build

Update the pi harness manifest so the generic install loop symlinks individual rule files into `~/.pi/agent/rules/` (matching Claude and omp) and stops symlinking the always-on AGENTS.md concatenation. Update the test gate to validate the new layout.

### Acceptance criteria

- [ ] `harnesses/pi/manifest.sh`: `consumed_categories` includes `rules`
- [ ] `harnesses/pi/manifest.sh`: `install_module` no longer symlinks `advisory-rules.md` → `AGENTS.md`
- [ ] `scripts/test-pipeline.sh`: `test_install_behavior` checks that pi's installed root has a `rules/` directory with the 6 rule files and no AGENTS.md symlink
- [ ] `make test` passes

---

## Slice 2: Remove concatenation artifacts

**Type:** AFK
**Blocked by:** Slice 1
**User stories covered:** 1, 5

### What to build

Delete the concatenation script and its committed output. Remove the Makefile target that generated them. Remove the drift-check test that validated them.

### Acceptance criteria

- [ ] `scripts/gen-pi-agents.sh` is deleted
- [ ] `harnesses/pi/advisory-rules.md` is deleted
- [ ] `Makefile` no longer has a `rules` target
- [ ] `scripts/test-pipeline.sh`: `test_pi_agents_current` is removed
- [ ] `make test` passes

---

## Slice 3: Subagent extension install

**Type:** AFK
**Blocked by:** Slice 1
**User stories covered:** 3, 5

### What to build

Add a step to pi's `install_module` that symlinks the subagent extension from pi's examples directory. Update the test gate to verify the extension files are present after install.

### Acceptance criteria

- [ ] `harnesses/pi/manifest.sh`: `install_module` symlinks `index.ts` and `agents.ts` from `/opt/pi-coding-agent/examples/extensions/subagent/` into `$config_root/extensions/subagent/`
- [ ] The symlink step skips gracefully if the pi examples directory doesn't exist
- [ ] `scripts/test-pipeline.sh`: `test_install_behavior` checks for `extensions/subagent/index.ts` and `extensions/subagent/agents.ts`
- [ ] `make test` passes

---

## Slice 4: Update skill file rules-adherence instructions

**Type:** AFK
**Blocked by:** None — independent of Slices 1-3
**User stories covered:** 2, 4

### What to build

Add pi's on-demand rule-loading instruction to the "Rules Adherence" section of every build-pipeline skill that tells the AI where to load advisory rules from.

### Acceptance criteria

- [ ] `skills/prd/SKILL.md` — rules-adherence section mentions pi's `~/.pi/agent/rules/` path
- [ ] `skills/tasks/SKILL.md` — same
- [ ] `skills/implement/SKILL.md` — same
- [ ] `skills/implement-coach/SKILL.md` — same
- [ ] `make test` passes

---

## Slice 5: Update agent file rule-path lists

**Type:** AFK
**Blocked by:** None — independent of Slices 1-3
**User stories covered:** 3, 4

### What to build

Add `~/.pi/agent/rules/` to the "Project Rules" section of every agent file, alongside the existing Claude Code and oh-my-pi paths, so spawned sub-agents know where to find rule files in pi.

### Acceptance criteria

- [ ] `agents/architect.md` — rule-path list includes `~/.pi/agent/rules/` for pi
- [ ] `agents/code-reviewer.md` — same
- [ ] `agents/database-reviewer.md` — same
- [ ] `agents/doc-updater.md` — same
- [ ] `agents/refactor-cleaner.md` — same
- [ ] `agents/refactorer.md` — same
- [ ] `agents/tdd-guide.md` — same
- [ ] `make test` passes

---

## Slice 6: ADR-0014

**Type:** AFK
**Blocked by:** None — can be written at any point
**User stories covered:** 4

### What to build

Write a new ADR documenting the reversal of ADR-0013. Record the rationale (per-turn token cost, consistency with oh-my-pi's on-demand pattern), the new delivery mechanism (individual files at `~/.pi/agent/rules/`), and the addition of the subagent extension. The ADR supersedes ADR-0013's rules-projection mechanism for pi.

### Acceptance criteria

- [ ] `docs/adr/0014-pi-rule-delivery-switch-on-demand.md` exists and documents the decision
- [ ] The ADR references ADR-0013 as superseded
