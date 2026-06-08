# Pi On-Demand Rules & Subagent Extension — PRD

## Problem Statement

The pi harness currently loads all six advisory rules (coding-style, testing, security, performance, git-commit, mise) as a concatenated always-on instruction file (`AGENTS.md`), burning ~2,700 tokens on every turn whether or not the rules are relevant. Meanwhile, pi has no sub-agent capability, so the build pipeline's post-implementation review chain — which invokes specialized agents like `code-reviewer`, `database-reviewer`, and `refactor-cleaner` via "the Agent tool" — cannot run in pi as it does in Claude Code and oh-my-pi. Without a fix, pi users either skip the review chain or run it inline without isolation.

## Solution

Two changes:

1. **Switch pi rules from always-on to on-demand.** Remove the generated concatenation (`AGENTS.md`) and instead mirror each rule as an individual file at `~/.pi/agent/rules/*.md`, matching the pattern Claude Code and oh-my-pi already use. Skills and agents tell the AI to `read` from this path when entering a phase that needs them. Claude Code keeps its always-on rules (native behavior); oh-my-pi keeps its on-demand rulebook.

2. **Install pi's subagent extension.** Pi ships an official subagent example at `/opt/pi-coding-agent/examples/extensions/subagent/`. The pi module's install step symlinks it into `~/.pi/agent/extensions/subagent/`, registering a `subagent` tool that the AI can call with `{ agent, task }` to spawn isolated sub-processes. The existing agent files at `~/.pi/agent/agents/*.md` are auto-discovered — no new agent definitions needed.

## User Stories

1. As a pi user, I want the six advisory rules to not consume context tokens when I'm not implementing code, so that I don't pay unnecessary per-turn API costs.
2. As a pi user running the `/build` pipeline, I want the AI to explicitly load the advisory rules when entering the implement phase, so that my code still follows the project conventions.
3. As a pi user running the `/build` pipeline, I want the review chain (code-reviewer, refactor-cleaner, database-reviewer, doc-updater) to work in pi the same way it works in Claude Code and oh-my-pi, so that I get the same quality gates.
4. As an ai-config maintainer, I want the rules to still be authored once in `rules/*.md` and reach all three harnesses, so that there is one source of truth.
5. As an ai-config maintainer, I want the test gate to validate the new pi layout, so that drift is caught in CI.

## Implementation Decisions

### Modules to modify

1. **pi harness manifest** (`harnesses/pi/manifest.sh`)
   - Add `rules` to `consumed_categories` — the generic install loop will symlink each `rules/*.md` into `~/.pi/agent/rules/`
   - Remove the `install_module` step that symlinks `advisory-rules.md` → `AGENTS.md`
   - Add an `install_module` step: if the subagent extension source exists at `/opt/pi-coding-agent/examples/extensions/subagent/`, symlink `index.ts` and `agents.ts` into `~/.pi/agent/extensions/subagent/`

2. **Removed artifacts**
   - Delete `scripts/gen-pi-agents.sh` — the concatenation script is no longer needed
   - Delete `harnesses/pi/advisory-rules.md` — the committed generated file is no longer needed
   - Remove the `rules` target from the `Makefile`

3. **Test gate** (`scripts/test-pipeline.sh`)
   - Remove `test_pi_agents_current` — the drift check for the deleted concatenation
   - Update `test_install_behavior`: change the pi check from "no rules dir" to "rules dir exists", remove the AGENTS.md existence check, validate the subagent extension files are symlinked

4. **Skill rules-adherence instructions** (4 files)
   - `skills/prd/SKILL.md` — add `"in pi, read from \`~/.pi/agent/rules/\`"` to the rules-adherence section
   - `skills/tasks/SKILL.md` — same
   - `skills/implement/SKILL.md` — same
   - `skills/implement-coach/SKILL.md` — same
   - Each line becomes: "In Claude Code these are global instructions; in pi, read from `~/.pi/agent/rules/`; in oh-my-pi, load via `rule://<name>` when entering the rule's domain."

5. **Agent rule-path lists** (7 files)
   - `agents/architect.md`
   - `agents/code-reviewer.md`
   - `agents/database-reviewer.md`
   - `agents/doc-updater.md`
   - `agents/refactor-cleaner.md`
   - `agents/refactorer.md`
   - `agents/tdd-guide.md`
   - Each adds `` `~/.pi/agent/rules/` for pi `` alongside the existing `` `~/.claude/rules/` for Claude Code, `~/.omp/agent/rules/` for oh-my-pi ``

6. **ADR 0013** — update or supersede. The current ADR documents the always-on concatenation decision. A new ADR (0014) records the reversal: pi rules are now on-demand via individual files, same pattern as oh-my-pi.

### Technical clarifications

- The subagent extension ships with pi at `/opt/pi-coding-agent/examples/extensions/subagent/`. The install step checks for its existence and skips gracefully if pi is not installed.
- The generic install loop already handles `rules/` symlinking — adding it to `consumed_categories` is sufficient. No new install logic needed.
- Agent files are already at `~/.pi/agent/agents/*.md` (installed by the generic loop). The subagent extension's `agents.ts` auto-discovers them via the standard pi agent paths — no additional config.
- The subagent extension spawns `pi` sub-processes in JSON mode. Each sub-agent gets the agent's system prompt from the `.md` file and a specified tool set. Results stream back to the parent session.

### What stays unchanged

- Claude Code's always-on rules (`~/.claude/rules/*.md` auto-injected every turn)
- oh-my-pi's on-demand rulebook (`rule://<name>`)
- All existing agent definitions (same files, same content for Claude/omp)
- The install loop remains generic — no per-harness special-casing for `rules/`

## Testing Decisions

Tests for this feature verify that the end-to-end installation and behavior is correct. Per the project's testing philosophy, tests should verify behavior, not implementation — but when the behavior is "files end up in the right places and the gate passes," the tests necessarily check file layout and script output.

### What to test

- **`make test` passes after all changes** — the primary gate. All existing content/install/guard/meta checks must still pass, updated for the new pi layout.
- **`test_install_behavior`** — updated to verify:
  - pi has a `rules/` directory with the six individual rule files
  - pi has no `AGENTS.md` file (or AGENTS.md doesn't exist / is unrelated)
  - pi has the subagent extension files at `extensions/subagent/index.ts` and `extensions/subagent/agents.ts`
  - pi still has its guard extension (`extensions/guard-policies.ts`)
  - Claude Code still has its rules dir and AGENTS.md equivalency is gone (verify Claude hasn't changed)
- **`test_pi_agents_current` removed** — the old drift check for the deleted concatenation
- **`test_isolation`** — unchanged, must still pass (no cross-harness pollution)
- **`test_agent_rule_deps`** — unchanged, agent files still reference existing `rules/*.md`
- **`test_rulebook_rule_frontmatter`** — unchanged, rule frontmatter is unaffected

### Prior art

The existing `test_install_behavior` in `scripts/test-pipeline.sh` already validates file layout after a throwaway install. The new checks follow the same pattern: `[[ -f ... ]] && pass / || fail`. The drift-check pattern (`diff -q` against regenerated output) is already used by `test_pi_agents_current` and `test_pi_bundle_current` — we remove the former and keep the latter.

## Out of Scope

- Sub-agent functionality for oh-my-pi or Claude Code (they already have it via `task` and `Task()`)
- Sandboxing for pi sub-agents (the subagent extension uses the same filesystem as the parent)
- A dedicated "build mode" that auto-loads rules only during build phases
- Changes to the advisory rule content itself
- Adding new agent definitions beyond what already exists at `agents/*.md`
- The subagent extension's sample agents or workflow prompts (`examples/extensions/subagent/agents/` and `prompts/`) — we don't need them; our own agents at `~/.pi/agent/agents/` are sufficient

## Further Notes

- This partially reverses ADR-0013, which introduced the always-on concatenation for pi. The rationale at the time ("for six small, always-relevant advisory rules, always-on is simpler") was sound for v0 of pi integration, but the per-turn token cost is harder to justify now that we have a proven on-demand pattern from oh-my-pi.
- The subagent extension is an example that ships with pi, not a published npm package. We reference it by its well-known path under `/opt/pi-coding-agent/`. If pi's installation layout changes in a future version, the symlink step may need updating.
- Agent files need to mention pi's rule path even though pi sub-agents read from `~/.pi/agent/rules/` directly — the instruction tells sub-agents where to find the files.
