#!/usr/bin/env bash
# Validates that test-pipeline.sh correctly catches errors by creating
# temporary broken files and verifying the test script fails on them.
#
# All temporary fixture files and directories are created outside the
# repository (under a mktemp -d directory) and symlinked in, so nothing
# is ever written to the working tree. In-place modification tests
# replace real files with symlinks to copies in the temp dir, then
# restore the originals on cleanup.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PIPELINE="$REPO_DIR/scripts/test-pipeline.sh"
SELF_PASS=0
SELF_FAIL=0

# All fixture files live under this temp dir, never inside the repo.
TMPDIR="$(mktemp -d)"

# Sweep any leftover test-self-test symlinks from previous interrupted runs.
# This runs at the start of every self-test invocation.
remove_fixtures() {
  rm -f "$REPO_DIR"/agents/test-self-test-*.md 2>/dev/null || true
  rm -rf "$REPO_DIR"/skills/test-self-test-* 2>/dev/null || true
  rm -f "$REPO_DIR"/commands/test-self-test-*.md 2>/dev/null || true
  rm -f "$REPO_DIR"/rules/test-self-test-*.md 2>/dev/null || true
  rm -rf "$REPO_DIR"/harnesses/test-self-test-* 2>/dev/null || true
  rm -f "$REPO_DIR"/harnesses/omp/test-self-test-* 2>/dev/null || true
  rm -f "$REPO_DIR"/harnesses/omp/hooks/pre/guard-test-self-test-*.ts 2>/dev/null || true
  rm -f "$REPO_DIR"/harnesses/omp/hooks/post/redact-test-self-test-*.ts 2>/dev/null || true
  # Restore any __real__ files left behind by an interrupted fixture_replace.
  # First remove the symlink that replaced the original (if still present),
  # then move the backup back.
  while IFS= read -r -d '' bak; do
    orig="${bak%.__real__}"
    if [[ -L "$orig" ]]; then
      rm -f "$orig"
    fi
    mv "$bak" "$orig" 2>/dev/null || true
  done < <(find "$REPO_DIR" \( -name '*.md.__real__' -o -name '*.ts.__real__' -o -name '*.yml.__real__' \) -print0 2>/dev/null)
}
remove_fixtures

self_pass() { SELF_PASS=$((SELF_PASS + 1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
self_fail() { SELF_FAIL=$((SELF_FAIL + 1)); printf '  \033[31m✗\033[0m %s\n' "$1"; }

# ---------------------------------------------------------------------------
# Helpers for creating fixtures outside the repo
# ---------------------------------------------------------------------------

# Create a single-file fixture at the given repo-relative path.
# The file is physically in $TMPDIR/<rel>; a symlink is placed at
# $REPO_DIR/<rel> so the pipeline can find it. Returns the temp path
# for writing content.
fixture_file() {
  local rel="$1"
  local tmp="$TMPDIR/$rel"
  local repo="$REPO_DIR/$rel"
  mkdir -p "$(dirname "$tmp")"
  mkdir -p "$(dirname "$repo")"
  rm -f "$repo" 2>/dev/null || true
  ln -sf "$tmp" "$repo"
  echo "$tmp"
}

# Create a skill directory fixture at skills/<name>/.
# The directory is physically in $TMPDIR/skills/<name>; a symlink is
# placed at $REPO_DIR/skills/<name>. Returns the temp directory path.
fixture_skill_dir() {
  local name="$1"
  local tmp="$TMPDIR/skills/$name"
  local repo="$REPO_DIR/skills/$name"
  mkdir -p "$tmp"
  rm -rf "$repo" 2>/dev/null || true
  ln -sfn "$tmp" "$repo"
  echo "$tmp"
}

# Create a harness module directory fixture at harnesses/<name>/.
# The directory is physically in $TMPDIR/harnesses/<name>; a symlink
# is placed at $REPO_DIR/harnesses/<name>. Returns the temp path.
fixture_harness_dir() {
  local name="$1"
  local tmp="$TMPDIR/harnesses/$name"
  local repo="$REPO_DIR/harnesses/$name"
  mkdir -p "$tmp"
  rm -rf "$repo" 2>/dev/null || true
  ln -sfn "$tmp" "$repo"
  echo "$tmp"
}

# Replace a tracked repo file with a symlink to a copy in the temp dir.
# Used by tests that modify an existing file in-place: the original is
# never touched; the modification goes to the temp copy. On cleanup the
# symlink is removed and the original is restored.
fixture_replace() {
  local rel="$1"
  local repo="$REPO_DIR/$rel"
  local tmp="$TMPDIR/$rel"
  mkdir -p "$(dirname "$tmp")"
  cp "$repo" "$tmp"
  mv "$repo" "$repo.__real__"
  ln -sf "$tmp" "$repo"
}

# ---------------------------------------------------------------------------
# Cleanup (trap + explicit call from main)
# ---------------------------------------------------------------------------

cleanup() {
  remove_fixtures
  rm -rf "$TMPDIR" 2>/dev/null || true
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
  local skill_dir
  skill_dir="$(fixture_skill_dir "test-self-test-skill")"
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
}

# ---------------------------------------------------------------------------
# Self-test 3: Missing frontmatter tools field in agent
# ---------------------------------------------------------------------------

test_agent_missing_tools_fails() {
  local f
  f="$(fixture_file "agents/test-self-test-agent.md")"
  cat >"$f" <<'EOF'
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
}

# ---------------------------------------------------------------------------
# Self-test 4: Unknown tool name in agent
# ---------------------------------------------------------------------------

test_agent_unknown_tool_fails() {
  local f
  f="$(fixture_file "agents/test-self-test-agent.md")"
  cat >"$f" <<'EOF'
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
}

# ---------------------------------------------------------------------------
# Self-test 5: Broken cross-reference to visual-explainer references
# ---------------------------------------------------------------------------

test_broken_ve_reference_fails() {
  local f
  f="$(fixture_file "commands/test-self-test-cmd.md")"
  cat >"$f" <<'EOF'
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
}

# ---------------------------------------------------------------------------
# Self-test 6: Missing rule file referenced from agent body
# ---------------------------------------------------------------------------

test_agent_missing_rule_fails() {
  local f
  f="$(fixture_file "agents/test-self-test-agent.md")"
  cat >"$f" <<'EOF'
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
}

# ---------------------------------------------------------------------------
# Self-test 7: Stale stub file with redirect language
# ---------------------------------------------------------------------------

test_stale_stub_fails() {
  local f
  f="$(fixture_file "agents/test-self-test-stub.md")"
  cat >"$f" <<'EOF'
This agent has been moved to code-reviewer.md
See agents/code-reviewer.md instead
EOF

  if run_pipeline; then
    self_fail "stale stub: test-pipeline.sh should exit non-zero"
  else
    self_pass "stale stub: test-pipeline.sh correctly exits non-zero"
  fi
}

# ---------------------------------------------------------------------------
# Self-test 8: AI-readable file contains Claude-Code-centric forbidden phrase
# ---------------------------------------------------------------------------

test_forbidden_already_loaded_in_context_fails() {
  local skill_dir
  skill_dir="$(fixture_skill_dir "test-self-test-forbidden-phrase")"
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
}

# ---------------------------------------------------------------------------
# Self-test 9: a re-introduced TTSR rule (has condition:/scope:) fails the gate
# ---------------------------------------------------------------------------

test_reintroduced_ttsr_rule_fails() {
  local f
  f="$(fixture_file "rules/test-self-test-ttsr.md")"
  cat >"$f" <<'EOF'
---
description: A re-introduced enforcement rule — should be rejected (TTSR retired, ADR-0012).
condition:
  - 'foo'
scope: tool:bash
---

Enforcement belongs in the guard core now, not in a stream rule.
EOF

  if run_pipeline; then
    self_fail "re-introduced TTSR rule: test-pipeline.sh should exit non-zero"
  else
    self_pass "re-introduced TTSR rule: test-pipeline.sh correctly exits non-zero"
  fi
}

# ---------------------------------------------------------------------------
# Self-test 9c: a stale pi guard bundle fails the gate
# ---------------------------------------------------------------------------

test_stale_pi_bundle_fails() {
  local rel="harnesses/pi/guard-policies.bundle.ts"
  # Replace with a symlink to a temp copy so modifications never touch the repo
  fixture_replace "$rel"
  # Simulate "edited the adapter/guard-core, forgot to `make bundle`".
  printf '\nconst __stale_drift__ = true;\n' >>"$TMPDIR/$rel"

  if run_pipeline; then
    self_fail "stale pi guard bundle: test-pipeline.sh should exit non-zero"
  else
    self_pass "stale pi guard bundle: test-pipeline.sh correctly exits non-zero"
  fi
}

# ---------------------------------------------------------------------------
# Self-test 10: Rulebook rule (no condition:) missing description
# ---------------------------------------------------------------------------

test_rulebook_rule_missing_description_fails() {
  local f
  f="$(fixture_file "rules/test-self-test-rulebook-no-desc.md")"
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
}

# ---------------------------------------------------------------------------
# Self-test 11: omp install target missing (rename omp/config.yml aside)
# ---------------------------------------------------------------------------

test_omp_install_target_missing_fails() {
  local rel="harnesses/omp/config.yml"
  local tmp="$TMPDIR/$rel"
  mkdir -p "$(dirname "$tmp")"
  mv "$REPO_DIR/$rel" "$tmp"

  if run_pipeline; then
    self_fail "missing omp/config.yml: test-pipeline.sh should exit non-zero"
  else
    self_pass "missing omp/config.yml: test-pipeline.sh correctly exits non-zero"
  fi

  # Restore immediately so subsequent tests can find the file.
  mv "$tmp" "$REPO_DIR/$rel"
}

# ---------------------------------------------------------------------------
# Self-test 11b: re-enabling oh-my-pi cross-discovery fails isolation (ADR-0010)
# ---------------------------------------------------------------------------

test_cross_discovery_enabled_fails() {
  local rel="harnesses/omp/config.yml"
  # Replace with a symlink to a temp copy so the sed modification never
  # touches the repo file.
  fixture_replace "$rel"
  sed -i.bak 's/enableClaudeUser:[[:space:]]*false/enableClaudeUser: true/' "$TMPDIR/$rel"
  rm -f "$TMPDIR/$rel.bak"

  if run_pipeline; then
    self_fail "cross-discovery re-enabled: test-pipeline.sh should exit non-zero"
  else
    self_pass "cross-discovery re-enabled: test-pipeline.sh correctly exits non-zero"
  fi
}

# ---------------------------------------------------------------------------
# Self-test 11c: a harness manifest missing config_root fails the contract
# ---------------------------------------------------------------------------

test_bad_manifest_fails() {
  local dir
  dir="$(fixture_harness_dir "test-self-test-mod")"
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
}

# ---------------------------------------------------------------------------
# Self-test 12: invalid YAML in omp/
# ---------------------------------------------------------------------------

test_omp_yaml_invalid_fails() {
  local f
  f="$(fixture_file "harnesses/omp/test-self-test-broken.yml")"
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
}

# ---------------------------------------------------------------------------
# Self-test 13: omp hook missing default export
# ---------------------------------------------------------------------------

test_omp_hook_missing_default_export_fails() {
  local f
  f="$(fixture_file "harnesses/omp/hooks/pre/guard-test-self-test-bad.ts")"
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
}

# ---------------------------------------------------------------------------
# Self-test 14: Skill directory with no SKILL.md
# ---------------------------------------------------------------------------

test_skill_dir_missing_skill_md_fails() {
  fixture_skill_dir "test-self-test-empty"

  if run_pipeline; then
    self_fail "missing SKILL.md: test-pipeline.sh should exit non-zero"
  else
    self_pass "missing SKILL.md: test-pipeline.sh correctly exits non-zero"
  fi
}

# ---------------------------------------------------------------------------
# Self-test 15: implement-coach SKILL.md missing the Holding-the-line and
# Todo-hygiene sections — proves the gate would catch a regression that
# softens or deletes coach mode's load-bearing waiting discipline.
# ---------------------------------------------------------------------------

test_implement_coach_missing_holding_line_fails() {
  local rel="skills/implement-coach/SKILL.md"
  # Replace with a symlink to a temp copy so the awk modification never
  # touches the repo file.
  fixture_replace "$rel"

  # Strip every line from `## Holding the line` up to (not including) the
  # next H2 (`## Rules Adherence`). This wipes Holding-the-line AND
  # Todo-hygiene in one pass since they are contiguous.
  awk '
    /^## Holding the line/ { skip = 1 }
    /^## Rules Adherence/  { skip = 0 }
    !skip
  ' "$TMPDIR/$rel" > "$TMPDIR/$rel.tmp"
  mv "$TMPDIR/$rel.tmp" "$TMPDIR/$rel"

  if run_pipeline; then
    self_fail "stripped implement-coach holding-line section: test-pipeline.sh should exit non-zero"
  else
    self_pass "stripped implement-coach holding-line section: test-pipeline.sh correctly exits non-zero"
  fi
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
  test_reintroduced_ttsr_rule_fails
  test_stale_pi_bundle_fails
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

  # Remove all fixture symlinks and temp dir (belt-and-suspenders with the EXIT trap).
  remove_fixtures
  rm -rf "$TMPDIR" 2>/dev/null || true

  if [[ "$SELF_FAIL" -gt 0 ]]; then
    exit 1
  fi
}

main
