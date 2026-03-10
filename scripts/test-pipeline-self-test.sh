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
# Self-test 8: Skill directory with no SKILL.md
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
  test_skill_dir_missing_skill_md_fails

  echo ""
  echo "Results: $SELF_PASS passed, $SELF_FAIL failed"

  if [[ "$SELF_FAIL" -gt 0 ]]; then
    exit 1
  fi
}

main
