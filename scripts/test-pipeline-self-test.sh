#!/usr/bin/env bash
# Validates that test-pipeline.sh correctly catches errors by creating
# temporary broken files and verifying the test script fails on them.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PIPELINE="$REPO_DIR/scripts/test-pipeline.sh"
SELF_PASS=0
SELF_FAIL=0

self_pass() { SELF_PASS=$((SELF_PASS + 1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
self_fail() { SELF_FAIL=$((SELF_FAIL + 1)); printf '  \033[31m✗\033[0m %s\n' "$1"; }

cleanup() {
  rm -f "$REPO_DIR"/skills/test-self-test-*/SKILL.md 2>/dev/null || true
  rmdir "$REPO_DIR"/skills/test-self-test-* 2>/dev/null || true
  rm -f "$REPO_DIR"/agents/test-self-test-*.md 2>/dev/null || true
  rm -f "$REPO_DIR"/commands/test-self-test-*.md 2>/dev/null || true
  rm -f "$REPO_DIR"/rules/test-self-test-*.md 2>/dev/null || true
  rm -rf "$REPO_DIR"/harnesses/test-self-test-* 2>/dev/null || true
  rm -f "$REPO_DIR"/harnesses/omp/test-self-test-*.{yml,yaml} 2>/dev/null || true
  rm -f "$REPO_DIR"/harnesses/omp/hooks/pre/guard-test-self-test-*.ts 2>/dev/null || true
  rm -f "$REPO_DIR"/harnesses/omp/hooks/post/redact-test-self-test-*.ts 2>/dev/null || true
  # Restore omp/config.yml if a self-test was interrupted mid-rename
  if [[ -f "$REPO_DIR/harnesses/omp/test-self-test-config-bak.yml" && ! -f "$REPO_DIR/harnesses/omp/config.yml" ]]; then
    mv "$REPO_DIR/harnesses/omp/test-self-test-config-bak.yml" "$REPO_DIR/harnesses/omp/config.yml"
  else
    rm -f "$REPO_DIR/harnesses/omp/test-self-test-config-bak.yml" 2>/dev/null || true
  fi
  # Restore implement-coach SKILL.md if a self-test was interrupted mid-strip
  if [[ -f "$REPO_DIR/skills/implement-coach/SKILL.md.test-self-test-bak" ]]; then
    mv "$REPO_DIR/skills/implement-coach/SKILL.md.test-self-test-bak" \
       "$REPO_DIR/skills/implement-coach/SKILL.md"
  fi
}
trap cleanup EXIT

run_pipeline() {
  bash "$PIPELINE" >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# Self-test 1: Valid repo passes
# ---------------------------------------------------------------------------

test_valid_repo_passes() {
  if run_pipeline; then
    self_pass "valid repo: test-pipeline.sh exits 0"
  else
    self_fail "valid repo: test-pipeline.sh should exit 0 but failed"
  fi
}

# ---------------------------------------------------------------------------
# Self-test 2: Missing frontmatter name field in skill
# ---------------------------------------------------------------------------

test_skill_missing_name_fails() {
  local skill_dir="$REPO_DIR/skills/test-self-test-skill"
  mkdir -p "$skill_dir"
  cat >"$skill_dir/SKILL.md" <<'EOF'
---
description: A skill missing the name field
---

Some body content here.
EOF

  if run_pipeline; then
    self_fail "skill missing name: test-pipeline.sh should exit non-zero"
  else
    self_pass "skill missing name: test-pipeline.sh correctly exits non-zero"
  fi

  rm -f "$skill_dir/SKILL.md"
  rmdir "$skill_dir"
}

# ---------------------------------------------------------------------------
# Self-test 3: Missing frontmatter tools field in agent
# ---------------------------------------------------------------------------

test_agent_missing_tools_fails() {
  local agent_file="$REPO_DIR/agents/test-self-test-agent.md"
  cat >"$agent_file" <<'EOF'
---
name: test-self-test-agent
description: An agent missing the tools field
---

Some agent body content.
EOF

  if run_pipeline; then
    self_fail "agent missing tools: test-pipeline.sh should exit non-zero"
  else
    self_pass "agent missing tools: test-pipeline.sh correctly exits non-zero"
  fi

  rm -f "$agent_file"
}

# ---------------------------------------------------------------------------
# Self-test 4: Unknown tool name in agent
# ---------------------------------------------------------------------------

test_agent_unknown_tool_fails() {
  local agent_file="$REPO_DIR/agents/test-self-test-agent.md"
  cat >"$agent_file" <<'EOF'
---
name: test-self-test-agent
description: An agent with an unknown tool
tools: ["FakeTool"]
---

Some agent body content.
EOF

  if run_pipeline; then
    self_fail "agent unknown tool: test-pipeline.sh should exit non-zero"
  else
    self_pass "agent unknown tool: test-pipeline.sh correctly exits non-zero"
  fi

  rm -f "$agent_file"
}

# ---------------------------------------------------------------------------
# Self-test 5: Broken cross-reference to visual-explainer references
# ---------------------------------------------------------------------------

test_broken_ve_reference_fails() {
  local cmd_file="$REPO_DIR/commands/test-self-test-cmd.md"
  cat >"$cmd_file" <<'EOF'
---
description: test command with broken reference
---

See ~/.claude/skills/visual-explainer/references/nonexistent-file.md for details.
EOF

  if run_pipeline; then
    self_fail "broken VE reference: test-pipeline.sh should exit non-zero"
  else
    self_pass "broken VE reference: test-pipeline.sh correctly exits non-zero"
  fi

  rm -f "$cmd_file"
}

# ---------------------------------------------------------------------------
# Self-test 6: Missing rule file referenced from agent body
# ---------------------------------------------------------------------------

test_agent_missing_rule_fails() {
  local agent_file="$REPO_DIR/agents/test-self-test-agent.md"
  cat >"$agent_file" <<'EOF'
---
name: test-self-test-agent
description: An agent referencing a nonexistent rule
tools: ["Read"]
---

Follow the guidelines in rules/nonexistent-rule.md.
EOF

  if run_pipeline; then
    self_fail "agent missing rule: test-pipeline.sh should exit non-zero"
  else
    self_pass "agent missing rule: test-pipeline.sh correctly exits non-zero"
  fi

  rm -f "$agent_file"
}

# ---------------------------------------------------------------------------
# Self-test 7: Stale stub file with redirect language
# ---------------------------------------------------------------------------

test_stale_stub_fails() {
  local agent_file="$REPO_DIR/agents/test-self-test-stub.md"
  cat >"$agent_file" <<'EOF'
This agent has been moved to code-reviewer.md
See agents/code-reviewer.md instead
EOF

  if run_pipeline; then
    self_fail "stale stub: test-pipeline.sh should exit non-zero"
  else
    self_pass "stale stub: test-pipeline.sh correctly exits non-zero"
  fi

  rm -f "$agent_file"
}

# ---------------------------------------------------------------------------
# Self-test 8: AI-readable file contains Claude-Code-centric forbidden phrase
# ---------------------------------------------------------------------------

test_forbidden_already_loaded_in_context_fails() {
  local skill_dir="$REPO_DIR/skills/test-self-test-forbidden-phrase"
  mkdir -p "$skill_dir"
  cat >"$skill_dir/SKILL.md" <<'EOF'
---
name: test-self-test-forbidden-phrase
description: A fixture skill that smuggles in the Claude-centric phrase.
---

Comply with the project rules already loaded in context. This phrase is
Claude-Code-centric and is wrong on omp under rulebook semantics.
EOF

  if run_pipeline; then
    self_fail "forbidden phrase: test-pipeline.sh should exit non-zero"
  else
    self_pass "forbidden phrase: test-pipeline.sh correctly exits non-zero"
  fi

  rm -f "$skill_dir/SKILL.md"
  rmdir "$skill_dir"
}

# ---------------------------------------------------------------------------
# Self-test 9: TTSR rule (has condition:) missing description
# ---------------------------------------------------------------------------

test_ttsr_rule_missing_description_fails() {
  local f="$REPO_DIR/rules/test-self-test-ttsr-no-desc.md"
  cat >"$f" <<'EOF'
---
condition:
  - 'foo'
scope: tool:bash
---

Body of a TTSR rule that's missing the required description field.
EOF

  if run_pipeline; then
    self_fail "TTSR rule missing description: test-pipeline.sh should exit non-zero"
  else
    self_pass "TTSR rule missing description: test-pipeline.sh correctly exits non-zero"
  fi

  rm -f "$f"
}

# ---------------------------------------------------------------------------
# Self-test 10: Rulebook rule (no condition:) missing description
# ---------------------------------------------------------------------------

test_rulebook_rule_missing_description_fails() {
  local f="$REPO_DIR/rules/test-self-test-rulebook-no-desc.md"
  cat >"$f" <<'EOF'
# Rule with no frontmatter

This rule has neither description nor condition. omp would silently drop it
from the rulebook bucket; our pipeline must flag it instead of letting it rot.
EOF

  if run_pipeline; then
    self_fail "rulebook rule missing description: test-pipeline.sh should exit non-zero"
  else
    self_pass "rulebook rule missing description: test-pipeline.sh correctly exits non-zero"
  fi

  rm -f "$f"
}

# ---------------------------------------------------------------------------
# Self-test 11: omp install target missing (rename omp/config.yml aside)
# ---------------------------------------------------------------------------

test_omp_install_target_missing_fails() {
  local src="$REPO_DIR/harnesses/omp/config.yml"
  local bak="$REPO_DIR/harnesses/omp/test-self-test-config-bak.yml"
  mv "$src" "$bak"

  if run_pipeline; then
    self_fail "missing omp/config.yml: test-pipeline.sh should exit non-zero"
  else
    self_pass "missing omp/config.yml: test-pipeline.sh correctly exits non-zero"
  fi

  mv "$bak" "$src"
}

# ---------------------------------------------------------------------------
# Self-test 11b: re-enabling oh-my-pi cross-discovery fails isolation (ADR-0010)
# ---------------------------------------------------------------------------

test_cross_discovery_enabled_fails() {
  local src="$REPO_DIR/harnesses/omp/config.yml"
  local bak
  bak="$(mktemp)"  # outside the repo so the pipeline scan / cleanup ignore it
  cp "$src" "$bak"
  sed -i 's/enableClaudeUser:[[:space:]]*false/enableClaudeUser: true/' "$src"

  if run_pipeline; then
    self_fail "cross-discovery re-enabled: test-pipeline.sh should exit non-zero"
  else
    self_pass "cross-discovery re-enabled: test-pipeline.sh correctly exits non-zero"
  fi

  cp "$bak" "$src"
  rm -f "$bak"
}

# ---------------------------------------------------------------------------
# Self-test 11c: a harness manifest missing config_root fails the contract
# ---------------------------------------------------------------------------

test_bad_manifest_fails() {
  local dir="$REPO_DIR/harnesses/test-self-test-mod"
  mkdir -p "$dir"
  cat >"$dir/manifest.sh" <<'EOF'
# Intentionally omits config_root — must fail the manifest contract check.
consumed_categories=(skills)
install_module() { :; }
EOF

  if run_pipeline; then
    self_fail "bad manifest (no config_root): test-pipeline.sh should exit non-zero"
  else
    self_pass "bad manifest (no config_root): test-pipeline.sh correctly exits non-zero"
  fi

  rm -rf "$dir"
}

# ---------------------------------------------------------------------------
# Self-test 12: invalid YAML in omp/
# ---------------------------------------------------------------------------

test_omp_yaml_invalid_fails() {
  local f="$REPO_DIR/harnesses/omp/test-self-test-broken.yml"
  cat >"$f" <<'EOF'
key: [unclosed list
  - "and: { mixed: types"
  more: { broken
EOF

  if run_pipeline; then
    self_fail "broken omp YAML: test-pipeline.sh should exit non-zero"
  else
    self_pass "broken omp YAML: test-pipeline.sh correctly exits non-zero"
  fi

  rm -f "$f"
}

# ---------------------------------------------------------------------------
# Self-test 13: omp hook missing default export
# ---------------------------------------------------------------------------

test_omp_hook_missing_default_export_fails() {
  local f="$REPO_DIR/harnesses/omp/hooks/pre/guard-test-self-test-bad.ts"
  cat >"$f" <<'EOF'
import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

// Intentionally missing `export default function` — should fail the
// test_omp_hook_shape pipeline check.
function notAHook(pi: HookAPI): void {
  pi.on("tool_call", () => undefined);
}
EOF

  if run_pipeline; then
    self_fail "hook missing default export: test-pipeline.sh should exit non-zero"
  else
    self_pass "hook missing default export: test-pipeline.sh correctly exits non-zero"
  fi

  rm -f "$f"
}

# ---------------------------------------------------------------------------
# Self-test 14: Skill directory with no SKILL.md
# ---------------------------------------------------------------------------

test_skill_dir_missing_skill_md_fails() {
  local skill_dir="$REPO_DIR/skills/test-self-test-empty"
  mkdir -p "$skill_dir"

  if run_pipeline; then
    self_fail "missing SKILL.md: test-pipeline.sh should exit non-zero"
  else
    self_pass "missing SKILL.md: test-pipeline.sh correctly exits non-zero"
  fi

  rmdir "$skill_dir"
}

# ---------------------------------------------------------------------------
# Self-test 15: implement-coach SKILL.md missing the Holding-the-line and
# Todo-hygiene sections — proves the gate would catch a regression that
# softens or deletes coach mode's load-bearing waiting discipline.
# ---------------------------------------------------------------------------

test_implement_coach_missing_holding_line_fails() {
  local src="$REPO_DIR/skills/implement-coach/SKILL.md"
  local bak="$REPO_DIR/skills/implement-coach/SKILL.md.test-self-test-bak"
  cp "$src" "$bak"

  # Strip every line from `## Holding the line` up to (not including) the
  # next H2 (`## Rules Adherence`). This wipes Holding-the-line AND
  # Todo-hygiene in one pass since they are contiguous.
  awk '
    /^## Holding the line/ { skip = 1 }
    /^## Rules Adherence/  { skip = 0 }
    !skip
  ' "$bak" > "$src"

  if run_pipeline; then
    self_fail "stripped implement-coach holding-line section: test-pipeline.sh should exit non-zero"
  else
    self_pass "stripped implement-coach holding-line section: test-pipeline.sh correctly exits non-zero"
  fi

  mv "$bak" "$src"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  echo "Self-test: test-pipeline.sh error detection"
  echo ""

  test_valid_repo_passes
  test_skill_missing_name_fails
  test_agent_missing_tools_fails
  test_agent_unknown_tool_fails
  test_broken_ve_reference_fails
  test_agent_missing_rule_fails
  test_stale_stub_fails
  test_forbidden_already_loaded_in_context_fails
  test_ttsr_rule_missing_description_fails
  test_rulebook_rule_missing_description_fails
  test_omp_install_target_missing_fails
  test_cross_discovery_enabled_fails
  test_bad_manifest_fails
  test_omp_yaml_invalid_fails
  test_omp_hook_missing_default_export_fails
  test_skill_dir_missing_skill_md_fails
  test_implement_coach_missing_holding_line_fails

  echo ""
  echo "Results: $SELF_PASS passed, $SELF_FAIL failed"

  if [[ "$SELF_FAIL" -gt 0 ]]; then
    exit 1
  fi
}

main
