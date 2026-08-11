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
  [[ -L "$REPO_DIR/skills/rebase" ]] && rm "$REPO_DIR/skills/rebase"
  rm -f "$REPO_DIR"/commands/test-self-test-*.md 2>/dev/null || true
  rmdir "$REPO_DIR/commands" 2>/dev/null || true
  rm -f "$REPO_DIR"/rules/test-self-test-*.md 2>/dev/null || true
  rm -f "$REPO_DIR"/docs/adr/[0-9][0-9][0-9][0-9]-test-self-test-*.md 2>/dev/null || true
  rm -rf "$REPO_DIR"/harnesses/test-self-test-* 2>/dev/null || true
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
  mkdir -p "${tmp%/*}"
  mkdir -p "${repo%/*}"
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
  mkdir -p "${tmp%/*}"
  cp "$repo" "$tmp"
  mv "$repo" "$repo.__real__"
  ln -sf "$tmp" "$repo"
}

fixture_restore() {
  local repo="$REPO_DIR/$1"
  rm -f "$repo"
  mv "$repo.__real__" "$repo"
}

# ---------------------------------------------------------------------------
# Cleanup (trap + explicit call from main)
# ---------------------------------------------------------------------------

cleanup() {
  remove_fixtures
  rm -rf "$TMPDIR" 2>/dev/null || true
}
trap cleanup EXIT

# Load detector functions once. Each planted case resets detector state but
# avoids starting another Bash process and reparsing the full pipeline.
# shellcheck disable=SC1090
. "$PIPELINE"

run_pipeline() {
  PASS=0
  FAIL=0
  ERRORS=()
  AGENT_NAMES=()
  (pipeline_main "$@") >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# Self-test 1: Valid repo passes
# ---------------------------------------------------------------------------

test_pipeline_entry_passes() {
  if bash "$PIPELINE" content coach-holding-line >/dev/null 2>&1; then
    self_pass "pipeline entry: clean selector exits 0"
  else
    self_fail "pipeline entry: clean selector should exit 0"
  fi
}

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

  if run_pipeline content frontmatter-skills; then
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

  if run_pipeline content frontmatter-agents; then
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

  if run_pipeline content frontmatter-agents; then
    self_fail "agent unknown tool: test-pipeline.sh should exit non-zero"
  else
    self_pass "agent unknown tool: test-pipeline.sh correctly exits non-zero"
  fi
}

# ---------------------------------------------------------------------------
# Self-test 5: Broken skill reference
# ---------------------------------------------------------------------------

test_broken_skill_reference_fails() {
  local skill_dir
  skill_dir="$(fixture_skill_dir "test-self-test-broken-reference")"
  cat >"$skill_dir/SKILL.md" <<'EOF'
---
name: test-self-test-broken-reference
description: A fixture skill with a broken progressive-disclosure reference.
---

Read [missing details](references/nonexistent-file.md).
EOF

  if run_pipeline content cross-references; then
    self_fail "broken skill reference: test-pipeline.sh should exit non-zero"
  else
    self_pass "broken skill reference: test-pipeline.sh correctly exits non-zero"
  fi
}

# ---------------------------------------------------------------------------
# Self-test 5a: Broken fragment-bearing skill reference
# ---------------------------------------------------------------------------

test_broken_fragment_skill_reference_fails() {
  local skill_dir
  skill_dir="$(fixture_skill_dir "test-self-test-broken-fragment-reference")"
  mkdir -p "$skill_dir/references"
  cat >"$skill_dir/references/existing-reference.md" <<'EOF'
# Existing Section

<a id="explicit-section"></a>

This reference contains a heading and an explicit HTML anchor.
EOF
  cat >"$skill_dir/SKILL.md" <<'EOF'
---
name: test-self-test-broken-fragment-reference
description: A fixture skill with fragment-bearing references.
---

Read the [heading](references/existing-reference.md#existing-section) and
[explicit anchor](references/existing-reference.md#explicit-section).
EOF

  if run_pipeline content cross-references; then
    self_pass "fragment references: existing heading and HTML anchor resolve"
  else
    self_fail "fragment references: existing heading and HTML anchor should resolve"
    return
  fi

  printf '%s\n' 'Read [missing details](references/existing-reference.md#missing-section).' \
    >>"$skill_dir/SKILL.md"
  if run_pipeline content cross-references; then
    self_fail "broken fragment reference: test-pipeline.sh should exit non-zero"
  else
    self_pass "broken fragment reference: test-pipeline.sh correctly exits non-zero"
  fi
}

# ---------------------------------------------------------------------------
# Self-test 5b: a same-named command and skill fail the gate
# ---------------------------------------------------------------------------

test_command_skill_overlap_fails() {
  local skill_dir
  skill_dir="$(fixture_skill_dir "rebase")"
  cat >"$skill_dir/SKILL.md" <<'EOF'
---
name: rebase
description: A planted skill that overlaps the curated rebase command.
---

This fixture must fail the command and skill overlap invariant.
EOF

  if run_pipeline content command-prompts; then
    self_fail "command/skill overlap: test-pipeline.sh should exit non-zero"
  else
    self_pass "command/skill overlap: test-pipeline.sh correctly exits non-zero"
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

  if run_pipeline content agent-rule-deps; then
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

  if run_pipeline content stale-stubs; then
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
wrong because detailed rules are loaded on demand.
EOF

  if run_pipeline content forbidden-phrasing; then
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

  if run_pipeline content no-ttsr-frontmatter; then
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

  if run_pipeline content pi-bundle-current; then
    self_fail "stale pi guard bundle: test-pipeline.sh should exit non-zero"
  else
    self_pass "stale pi guard bundle: test-pipeline.sh correctly exits non-zero"
  fi
  fixture_restore "$rel"
}

# ---------------------------------------------------------------------------
# Self-test 10: Advisory rule missing description metadata
# ---------------------------------------------------------------------------

test_advisory_rule_missing_description_fails() {
  local f
  f="$(fixture_file "rules/test-self-test-no-desc.md")"
  cat >"$f" <<'EOF'
# Rule with no frontmatter

This advisory rule has no description metadata.
EOF

  if run_pipeline content advisory-frontmatter; then
    self_fail "advisory rule missing description: test-pipeline.sh should exit non-zero"
  else
    self_pass "advisory rule missing description: test-pipeline.sh correctly exits non-zero"
  fi
}

# ---------------------------------------------------------------------------
# Self-test 11: a harness manifest missing config_root fails the contract
# ---------------------------------------------------------------------------

test_bad_manifest_fails() {
  local dir
  dir="$(fixture_harness_dir "test-self-test-mod")"
  cat >"$dir/manifest.sh" <<'EOF'
# Intentionally omits config_root — must fail the manifest contract check.
consumed_categories=(skills)
install_module() { :; }
EOF

  if run_pipeline install harness-modules; then
    self_fail "bad manifest (no config_root): test-pipeline.sh should exit non-zero"
  else
    self_pass "bad manifest (no config_root): test-pipeline.sh correctly exits non-zero"
  fi
}

# ---------------------------------------------------------------------------
# Self-test 12: Skill directory with no SKILL.md
# ---------------------------------------------------------------------------

test_skill_dir_missing_skill_md_fails() {
  fixture_skill_dir "test-self-test-empty" >/dev/null

  if run_pipeline content symlink-targets; then
    self_fail "missing SKILL.md: test-pipeline.sh should exit non-zero"
  else
    self_pass "missing SKILL.md: test-pipeline.sh correctly exits non-zero"
  fi
}

# ---------------------------------------------------------------------------
# Self-test 15: coach SKILL.md missing the Holding-the-line and
# Todo-hygiene sections — proves the gate would catch a regression that
# softens or deletes coach mode's load-bearing waiting discipline.
# ---------------------------------------------------------------------------

test_implement_coach_missing_holding_line_fails() {
  local rel="skills/coach/SKILL.md"
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

  if run_pipeline content coach-holding-line; then
    self_fail "stripped coach holding-line section: test-pipeline.sh should exit non-zero"
  else
    self_pass "stripped coach holding-line section: test-pipeline.sh correctly exits non-zero"
  fi
  fixture_restore "$rel"
}

# ---------------------------------------------------------------------------
# Self-test 16: build skill missing the mandatory phase-loading section —
# proves the gate catches regressions that let /build reason about sub-skills
# from availability lists instead of loading each phase by path.
# ---------------------------------------------------------------------------

test_build_missing_phase_loading_fails() {
  local rel="skills/build/SKILL.md"
  fixture_replace "$rel"

  awk '
    /^## Mandatory Phase Loading/ { skip = 1 }
    /^Each phase also runs standalone:/ { skip = 0 }
    !skip
  ' "$TMPDIR/$rel" > "$TMPDIR/$rel.tmp"
  mv "$TMPDIR/$rel.tmp" "$TMPDIR/$rel"

  if run_pipeline content phase-orchestrator; then
    self_fail "stripped build phase-loading section: test-pipeline.sh should exit non-zero"
  else
    self_pass "stripped build phase-loading section: test-pipeline.sh correctly exits non-zero"
  fi
  fixture_restore "$rel"
}

# ---------------------------------------------------------------------------
# Self-test 17: mockup workflow loses its artifact contract and approval
# ---------------------------------------------------------------------------

test_mockup_contract_missing_fails() {
  local rel="skills/mockup/SKILL.md"
  fixture_replace "$rel"

  grep -vE 'mockup contract|approval|approved' "$TMPDIR/$rel" > "$TMPDIR/$rel.tmp"
  mv "$TMPDIR/$rel.tmp" "$TMPDIR/$rel"

  if run_pipeline content mockup-workflow; then
    self_fail "stripped mockup contract: test-pipeline.sh should exit non-zero"
  else
    self_pass "stripped mockup contract: test-pipeline.sh correctly exits non-zero"
  fi
  fixture_restore "$rel"
}

# ---------------------------------------------------------------------------
# Self-test 18: mockup loses standalone target resolution
# ---------------------------------------------------------------------------

test_mockup_target_resolution_missing_fails() {
  local rel="skills/mockup/SKILL.md"
  fixture_replace "$rel"

  grep -vE 'Otherwise, treat.*feature description' "$TMPDIR/$rel" > "$TMPDIR/$rel.tmp"
  mv "$TMPDIR/$rel.tmp" "$TMPDIR/$rel"

  if run_pipeline content mockup-workflow; then
    self_fail "stripped mockup target resolution: test-pipeline.sh should exit non-zero"
  else
    self_pass "stripped mockup target resolution: test-pipeline.sh correctly exits non-zero"
  fi
  fixture_restore "$rel"
}

# ---------------------------------------------------------------------------
# Planted self-test: mockup approval starts before alternatives settle
# ---------------------------------------------------------------------------

test_mockup_approval_order_fails() {
  local rel="skills/mockup/SKILL.md" approval_line
  fixture_replace "$rel"
  approval_line="$(grep -E '^6[.] Only after' "$TMPDIR/$rel")"

  awk -v approval_line="$approval_line" '
    /^4[.] When unresolved alternatives/ { print approval_line }
    /^6[.] Only after/ { next }
    { print }
  ' "$TMPDIR/$rel" > "$TMPDIR/$rel.tmp"
  mv "$TMPDIR/$rel.tmp" "$TMPDIR/$rel"

  if run_pipeline content mockup-workflow; then
    self_fail "early mockup approval: test-pipeline.sh should exit non-zero"
  else
    self_pass "early mockup approval: test-pipeline.sh correctly exits non-zero"
  fi
  fixture_restore "$rel"
}

# ---------------------------------------------------------------------------
# Self-test 19: prototype uses conjunctive mockup-first routing
# ---------------------------------------------------------------------------

test_prototype_mockup_routing_conjunctive_fails() {
  local rel="skills/prototype/SKILL.md"
  fixture_replace "$rel"

  sed 's/prototype subject or visual design is an imperative prerequisite/prototype subject and visual design is an imperative prerequisite/' \
    "$TMPDIR/$rel" > "$TMPDIR/$rel.tmp"
  mv "$TMPDIR/$rel.tmp" "$TMPDIR/$rel"

  if run_pipeline content prototype-mockup-routing; then
    self_fail "conjunctive prototype mockup routing: test-pipeline.sh should exit non-zero"
  else
    self_pass "conjunctive prototype mockup routing: test-pipeline.sh correctly exits non-zero"
  fi
  fixture_restore "$rel"
}

# ---------------------------------------------------------------------------
# Planted self-test: an implementation mode loses the material UI return path
# ---------------------------------------------------------------------------

test_implementation_mockup_sync_missing_fails() {
  local rel="skills/code/SKILL.md"
  fixture_replace "$rel"

  if run_pipeline content mockup-intent-thread; then
    self_pass "implementation mockup sync: clean selector exits 0"
  else
    self_fail "implementation mockup sync: clean selector should exit 0"
    fixture_restore "$rel"
    return
  fi

  awk '
    /^## Material UI Synchronization/ { skip = 1 }
    /^## Completion/ { skip = 0 }
    !skip
  ' "$TMPDIR/$rel" > "$TMPDIR/$rel.tmp"
  mv "$TMPDIR/$rel.tmp" "$TMPDIR/$rel"

  if run_pipeline content mockup-intent-thread; then
    self_fail "stripped implementation mockup sync: test-pipeline.sh should exit non-zero"
  else
    self_pass "stripped implementation mockup sync: test-pipeline.sh correctly exits non-zero"
  fi
  fixture_restore "$rel"
}

# ---------------------------------------------------------------------------
# Planted self-test: final Review change loses its material UI return path
# ---------------------------------------------------------------------------

test_review_change_ui_redesign_missing_fails() {
  local rel="skills/review-change/references/build-mode.md"
  fixture_replace "$rel"

  if run_pipeline content review-change-ui-redesign; then
    self_pass "Review change UI redesign: clean selector exits 0"
  else
    self_fail "Review change UI redesign: clean selector should exit 0"
    fixture_restore "$rel"
    return
  fi

  awk '
    /^## Material UI redesign during final review/ { skip = 1 }
    /^## Feature-artifact synchronization/ { skip = 0 }
    !skip
  ' "$TMPDIR/$rel" > "$TMPDIR/$rel.tmp"
  mv "$TMPDIR/$rel.tmp" "$TMPDIR/$rel"

  if run_pipeline content review-change-ui-redesign; then
    self_fail "stripped Review change UI redesign: test-pipeline.sh should exit non-zero"
  else
    self_pass "stripped Review change UI redesign: test-pipeline.sh correctly exits non-zero"
  fi
  fixture_restore "$rel"
}

# ---------------------------------------------------------------------------
# Planted self-test: Tasks omits changed-mockup review and approval
# ---------------------------------------------------------------------------

test_todo_redesign_approval_missing_fails() {
  local rel="skills/todo/SKILL.md"
  fixture_replace "$rel"

  awk '
    /^2[.] Run the changed .*review-artifact.*explicit approval[.]$/ {
      print "2. Update the changed `mockups.html` without a review."
      next
    }
    { print }
  ' "$TMPDIR/$rel" > "$TMPDIR/$rel.tmp"
  mv "$TMPDIR/$rel.tmp" "$TMPDIR/$rel"

  if run_pipeline content todo-workflow; then
    self_fail "Tasks mockup review omitted: test-pipeline.sh should exit non-zero"
  else
    self_pass "Tasks mockup review omitted: test-pipeline.sh correctly exits non-zero"
  fi
  fixture_restore "$rel"
}

# ---------------------------------------------------------------------------
# Planted self-test: Spec omits changed-mockup review and approval
# ---------------------------------------------------------------------------

test_spec_redesign_approval_missing_fails() {
  local rel="skills/spec/SKILL.md"
  fixture_replace "$rel"

  awk '
    /^2[.] Update the changed .*review-artifact.*explicit approval[.]$/ {
      print "2. Update the changed `mockups.html` without a review."
      next
    }
    { print }
  ' "$TMPDIR/$rel" > "$TMPDIR/$rel.tmp"
  mv "$TMPDIR/$rel.tmp" "$TMPDIR/$rel"

  if run_pipeline content spec-workflow; then
    self_fail "Spec mockup review omitted: test-pipeline.sh should exit non-zero"
  else
    self_pass "Spec mockup review omitted: test-pipeline.sh correctly exits non-zero"
  fi
  fixture_restore "$rel"
}

# ---------------------------------------------------------------------------
# Self-test 20: duplicate ADR identifiers
# ---------------------------------------------------------------------------

test_duplicate_adr_id_fails() {
  local f
  f="$(fixture_file "docs/adr/0019-test-self-test-duplicate.md")"
  printf '%s\n' '# Duplicate ADR identifier' >"$f"

  if run_pipeline content unique-adr-ids; then
    self_fail "duplicate ADR id: test-pipeline.sh should exit non-zero"
  else
    self_pass "duplicate ADR id: test-pipeline.sh correctly exits non-zero"
  fi
}

# ---------------------------------------------------------------------------
# Self-test 18: standalone review mode omits context-file loading
# ---------------------------------------------------------------------------

test_context_consumer_missing_context_map_fails() {
  local rel="skills/review-change/references/workflow.md"
  fixture_replace "$rel"
  sed 's/applicable context files/context index/g' "$TMPDIR/$rel" >"$TMPDIR/$rel.tmp"
  mv "$TMPDIR/$rel.tmp" "$TMPDIR/$rel"

  if run_pipeline content ubiquitous-language; then
    self_fail "missing context files: test-pipeline.sh should exit non-zero"
  else
    self_pass "missing context files: test-pipeline.sh correctly exits non-zero"
  fi
  fixture_restore "$rel"
}

# ---------------------------------------------------------------------------
# Self-test 19: context-consuming skill omits ubiquitous language
# ---------------------------------------------------------------------------

test_context_consumer_missing_ubiquitous_language_fails() {
  local rel="skills/review-change/references/workflow.md"
  fixture_replace "$rel"
  sed 's/ubiquitous language/domain terms/g' "$TMPDIR/$rel" >"$TMPDIR/$rel.tmp"
  mv "$TMPDIR/$rel.tmp" "$TMPDIR/$rel"

  if run_pipeline content ubiquitous-language; then
    self_fail "missing ubiquitous language: test-pipeline.sh should exit non-zero"
  else
    self_pass "missing ubiquitous language: test-pipeline.sh correctly exits non-zero"
  fi
  fixture_restore "$rel"
}

# ---------------------------------------------------------------------------
# Self-tests 20–23: Agent-facing CLI guidance drift
# ---------------------------------------------------------------------------

test_cli_ergonomics_routing_drift_fails() {
  local rel="harness-system-prompt.md"
  fixture_replace "$rel"
  awk '{ sub(/before designing, implementing, or reviewing an Agent-facing CLI/, "before reviewing any CLI"); print }' \
    "$TMPDIR/$rel" >"$TMPDIR/$rel.tmp"
  mv "$TMPDIR/$rel.tmp" "$TMPDIR/$rel"

  if run_pipeline content cli-ergonomics-routing; then
    self_fail "CLI ergonomics routing drift: test-pipeline.sh should exit non-zero"
  else
    self_pass "CLI ergonomics routing drift: test-pipeline.sh correctly exits non-zero"
  fi
  fixture_restore "$rel"
}

test_cli_ergonomics_missing_outcome_fails() {
  local rel="rules/cli-ergonomics.md"
  fixture_replace "$rel"
  awk '{ sub(/^## Explicit truncation$/, "## Overflow handling"); print }' \
    "$TMPDIR/$rel" >"$TMPDIR/$rel.tmp"
  mv "$TMPDIR/$rel.tmp" "$TMPDIR/$rel"

  if run_pipeline content cli-ergonomics-outcomes; then
    self_fail "CLI ergonomics missing outcome: test-pipeline.sh should exit non-zero"
  else
    self_pass "CLI ergonomics missing outcome: test-pipeline.sh correctly exits non-zero"
  fi
  fixture_restore "$rel"
}

test_cli_ergonomics_readme_inventory_drift_fails() {
  local rel="README.md"
  fixture_replace "$rel"
  awk '{ sub(/Rules \(7 advisory files\)/, "Rules (6 advisory files)"); print }' \
    "$TMPDIR/$rel" >"$TMPDIR/$rel.tmp"
  mv "$TMPDIR/$rel.tmp" "$TMPDIR/$rel"

  if run_pipeline content cli-ergonomics-inventory; then
    self_fail "CLI ergonomics README inventory drift: test-pipeline.sh should exit non-zero"
  else
    self_pass "CLI ergonomics README inventory drift: test-pipeline.sh correctly exits non-zero"
  fi
  fixture_restore "$rel"
}

test_cli_ergonomics_readme_attribution_drift_fails() {
  local rel="README.md"
  fixture_replace "$rel"
  awk '{ sub(/93c5f334d6ec074c29ca8d74fa629530dd298a43/, "unversioned"); print }' \
    "$TMPDIR/$rel" >"$TMPDIR/$rel.tmp"
  mv "$TMPDIR/$rel.tmp" "$TMPDIR/$rel"

  if run_pipeline content cli-ergonomics-inventory; then
    self_fail "CLI ergonomics README attribution drift: test-pipeline.sh should exit non-zero"
  else
    self_pass "CLI ergonomics README attribution drift: test-pipeline.sh correctly exits non-zero"
  fi
  fixture_restore "$rel"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

run_planted_case() {
  local planted_case="$1"
  remove_fixtures
  case "$planted_case" in
    skill-missing-name) test_skill_missing_name_fails ;;
    agent-missing-tools) test_agent_missing_tools_fails ;;
    agent-unknown-tool) test_agent_unknown_tool_fails ;;
    broken-reference) test_broken_skill_reference_fails ;;
    broken-fragment-reference) test_broken_fragment_skill_reference_fails ;;
    command-skill-overlap) test_command_skill_overlap_fails ;;
    agent-missing-rule) test_agent_missing_rule_fails ;;
    stale-stub) test_stale_stub_fails ;;
    forbidden-phrase) test_forbidden_already_loaded_in_context_fails ;;
    retired-rule-frontmatter) test_reintroduced_ttsr_rule_fails ;;
    stale-pi-bundle) test_stale_pi_bundle_fails ;;
    rule-missing-description) test_advisory_rule_missing_description_fails ;;
    bad-manifest) test_bad_manifest_fails ;;
    skill-missing-file) test_skill_dir_missing_skill_md_fails ;;
    coach-discipline) test_implement_coach_missing_holding_line_fails ;;
    build-phase-loading) test_build_missing_phase_loading_fails ;;
    mockup-contract) test_mockup_contract_missing_fails ;;
    mockup-target-resolution) test_mockup_target_resolution_missing_fails ;;
    mockup-approval-order) test_mockup_approval_order_fails ;;
    prototype-mockup-routing) test_prototype_mockup_routing_conjunctive_fails ;;
    implementation-mockup-sync) test_implementation_mockup_sync_missing_fails ;;
    review-change-ui-redesign) test_review_change_ui_redesign_missing_fails ;;
    todo-redesign-approval) test_todo_redesign_approval_missing_fails ;;
    spec-redesign-approval) test_spec_redesign_approval_missing_fails ;;
    duplicate-adr) test_duplicate_adr_id_fails ;;
    missing-context-files) test_context_consumer_missing_context_map_fails ;;
    missing-ubiquitous-language) test_context_consumer_missing_ubiquitous_language_fails ;;
    cli-ergonomics-routing) test_cli_ergonomics_routing_drift_fails ;;
    cli-ergonomics-outcomes) test_cli_ergonomics_missing_outcome_fails ;;
    cli-ergonomics-readme-inventory) test_cli_ergonomics_readme_inventory_drift_fails ;;
    cli-ergonomics-readme-attribution) test_cli_ergonomics_readme_attribution_drift_fails ;;
    *) printf 'unknown planted case %q\n' "$planted_case" >&2; exit 2 ;;
  esac
  remove_fixtures
}

run_all_planted_cases() {
  local planted_case
  for planted_case in \
    skill-missing-name agent-missing-tools agent-unknown-tool broken-reference \
    broken-fragment-reference command-skill-overlap agent-missing-rule stale-stub forbidden-phrase \
    retired-rule-frontmatter stale-pi-bundle rule-missing-description bad-manifest \
    skill-missing-file coach-discipline build-phase-loading mockup-contract \
    mockup-target-resolution mockup-approval-order prototype-mockup-routing \
    implementation-mockup-sync review-change-ui-redesign todo-redesign-approval \
    spec-redesign-approval duplicate-adr \
    missing-context-files missing-ubiquitous-language cli-ergonomics-routing \
    cli-ergonomics-outcomes cli-ergonomics-readme-inventory \
    cli-ergonomics-readme-attribution; do
    run_planted_case "$planted_case"
  done
}

main() {
  local mode=all selected_case=""
  local -a selected_cases=()
  case "${1:-}" in
    "") ;;
    --planted-only) mode=planted ;;
    --case) mode=case; selected_case="${2:-}"; [[ -n "$selected_case" && -z "${3:-}" ]] \
      || { echo 'usage: test-pipeline-self-test.sh --case <name>' >&2; exit 2; } ;;
    --cases) mode=cases; selected_cases=("${@:2}"); [[ ${#selected_cases[@]} -gt 0 ]] \
      || { echo 'usage: test-pipeline-self-test.sh --cases <name>...' >&2; exit 2; } ;;
    *) printf 'unknown option %q — use: --planted-only | --case <name> | --cases <name>... (or no option)\n' "$1" >&2; exit 2 ;;
  esac

  echo "Self-test: test-pipeline.sh error detection"
  echo ""

  test_pipeline_entry_passes
  if [[ "$mode" == all ]]; then
    test_valid_repo_passes
  fi
  if [[ "$mode" == case ]]; then
    run_planted_case "$selected_case"
  elif [[ "$mode" == cases ]]; then
    for selected_case in "${selected_cases[@]}"; do
      run_planted_case "$selected_case"
    done
  else
    run_all_planted_cases
  fi

  echo ""
  echo "Results: $SELF_PASS passed, $SELF_FAIL failed"

  # Remove all fixture symlinks and temp dir (belt-and-suspenders with the EXIT trap).
  remove_fixtures
  rm -rf "$TMPDIR" 2>/dev/null || true

  if [[ "$SELF_FAIL" -gt 0 ]]; then
    exit 1
  fi
}

main "$@"
