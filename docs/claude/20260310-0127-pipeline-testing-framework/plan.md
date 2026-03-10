# Plan: /build-feature Pipeline Testing Framework

## Goal

Create a bash testing framework that validates the internal consistency of the /build-feature pipeline — cross-reference integrity, frontmatter schemas, phase step completeness, symlink targets, and reference paths — so that structural regressions are caught automatically before commit.

## Research Reference

`docs/claude/20260310-0127-pipeline-testing-framework/research.md`

## Approach

A single bash test script (`scripts/test-pipeline.sh`) that runs a suite of validation checks against the pipeline's markdown/YAML/HTML files. Each check is a function that prints PASS/FAIL and returns 0/1. The script exits non-zero if any check fails.

The pre-commit hook (`.githooks/pre-commit`) will call this script so every commit validates pipeline integrity automatically.

**Why bash, not Python/JS:**
- Zero dependencies — the repo is language-agnostic config files
- The existing `scripts/` convention uses Python but only for permission syncing
- Bash with `grep`/`sed`/`awk` is the natural tool for validating markdown structure
- Keeps the test framework as simple as the thing it tests

**Test categories:**

1. **Frontmatter schema** — required fields present and valid for each file type
2. **Cross-reference integrity** — every file path referenced in one file exists on disk
3. **Phase step completeness** — each SKILL.md contains all expected steps, agents, commands, and artifacts
4. **Guide ↔ SKILL sync** — guide.html agents/commands match SKILL.md references
5. **Symlink targets** — every source file that install.sh would symlink actually exists
6. ~~**Rule coverage** — every rule file is referenced by at least one agent~~ (Removed: dead logic — rules are always-on context)
7. **VE reference paths** — commands that read VE references point to files that exist
8. **Stale stub detection** — no files that are just redirect comments

## Detailed Changes

### `scripts/test-pipeline.sh` (NEW — ~534 lines)

The main test script. Structure:

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
ERRORS=()

pass() { ((PASS++)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { ((FAIL++)); ERRORS+=("$1: $2"); printf '  \033[31m✗\033[0m %s: %s\n' "$1" "$2"; }

# ── Test: Frontmatter Schema ─────────────────────────────────────────

test_frontmatter_skills() {
  echo "Frontmatter: Skills"
  for file in "$REPO_DIR"/skills/*/SKILL.md; do
    name=$(basename "$(dirname "$file")")
    # Extract YAML frontmatter between --- delimiters
    frontmatter=$(sed -n '/^---$/,/^---$/p' "$file" | sed '1d;$d')

    # Required: name, description
    if echo "$frontmatter" | grep -q '^name:'; then
      pass "$name has 'name' field"
    else
      fail "$name" "missing 'name' field"
    fi

    if echo "$frontmatter" | grep -q '^description:'; then
      pass "$name has 'description' field"
    else
      fail "$name" "missing 'description' field"
    fi
  done
}

test_frontmatter_agents() {
  echo "Frontmatter: Agents"
  for file in "$REPO_DIR"/agents/*.md; do
    name=$(basename "$file" .md)
    frontmatter=$(sed -n '/^---$/,/^---$/p' "$file" | sed '1d;$d')

    for field in name description tools; do
      if echo "$frontmatter" | grep -q "^${field}:"; then
        pass "$name has '$field' field"
      else
        fail "$name" "missing '$field' field"
      fi
    done

    # Validate tool names are from known set
    tools_line=$(echo "$frontmatter" | grep '^tools:' || true)
    if [ -n "$tools_line" ]; then
      known_tools='Read|Write|Edit|Bash|Grep|Glob|Agent|Skill|WebFetch|WebSearch|NotebookEdit'
      # Extract each tool name from JSON array
      echo "$tools_line" | grep -oE '"[^"]*"' | tr -d '"' | while read -r tool; do
        if echo "$tool" | grep -qE "^($known_tools)$"; then
          pass "$name tool '$tool' is valid"
        else
          fail "$name" "unknown tool '$tool'"
        fi
      done
    fi
  done
}

test_frontmatter_commands() {
  echo "Frontmatter: Commands"
  for file in "$REPO_DIR"/commands/*.md; do
    name=$(basename "$file" .md)
    frontmatter=$(sed -n '/^---$/,/^---$/p' "$file" | sed '1d;$d')

    if echo "$frontmatter" | grep -q '^description:'; then
      pass "$name has 'description' field"
    else
      fail "$name" "missing 'description' field"
    fi
  done
}
```

Phase step completeness — verifies each phase SKILL.md contains all expected steps, invokes the right agents/commands, and produces the right artifacts:

```bash
# ── Test: Phase Step Completeness ────────────────────────────────────
# Each phase has a known set of steps. We verify the SKILL.md contains
# the key markers for each step (agent names, command names, artifact
# names, step headers). This catches deletions, renames, and drift.

test_phase_research() {
  echo "Phase steps: Research"
  local skill="$REPO_DIR/skills/research/SKILL.md"

  # Step 1: Identify scope
  grep -q 'Identify the scope' "$skill" && pass "research step 1: identify scope" \
    || fail "research" "missing step 1: identify scope"

  # Step 2: Deep-read the code
  grep -q 'Deep-read the code' "$skill" && pass "research step 2: deep-read code" \
    || fail "research" "missing step 2: deep-read code"

  # Step 3: Write research.md with required sections
  grep -q 'Write the research document' "$skill" && pass "research step 3: write research.md" \
    || fail "research" "missing step 3: write research document"
  for section in Overview Architecture "Key Files" "Data Flow" "Patterns" Dependencies "Edge Cases" "Current State"; do
    grep -q "$section" "$skill" && pass "research.md requires '$section' section" \
      || fail "research" "research.md missing required section '$section'"
  done

  # Step 4: Generate architecture diagram
  grep -q 'generate-architecture-diagram' "$skill" && pass "research step 4: invoke /generate-architecture-diagram" \
    || fail "research" "missing step 4: /generate-architecture-diagram invocation"
  grep -q 'architecture\.html' "$skill" && pass "research step 4: produces architecture.html" \
    || fail "research" "missing step 4: architecture.html artifact"

  # Step 5: Stop and wait
  grep -q 'STOP' "$skill" && pass "research step 5: STOP and wait" \
    || fail "research" "missing step 5: STOP instruction"
}

test_phase_plan() {
  echo "Phase steps: Plan"
  local skill="$REPO_DIR/skills/plan/SKILL.md"

  # Step 1: Read context
  grep -q 'Read Context\|Read context' "$skill" && pass "plan step 1: read context" \
    || fail "plan" "missing step 1: read context"
  grep -q 'research\.md' "$skill" && pass "plan step 1: reads research.md" \
    || fail "plan" "step 1 missing research.md reference"

  # Step 1b: Architect agent (conditional)
  grep -q 'architect' "$skill" && pass "plan step 1b: architect agent" \
    || fail "plan" "missing step 1b: architect agent"

  # Step 1c: Domain context detection
  grep -q 'frontend-design\|frontend-patterns\|api-design' "$skill" \
    && pass "plan step 1c: domain skill detection" \
    || fail "plan" "missing step 1c: domain skill detection"

  # Step 2: Write plan.md with required sections
  grep -q 'Write the plan document' "$skill" && pass "plan step 2: write plan.md" \
    || fail "plan" "missing step 2: write plan document"
  for section in Goal "Research Reference" Approach "Detailed Changes" "New Files" Dependencies "Considerations" "Testing Strategy"; do
    grep -q "$section" "$skill" && pass "plan.md requires '$section' section" \
      || fail "plan" "plan.md missing required section '$section'"
  done

  # Step 3: Wait for annotation
  grep -q 'Wait for Annotation\|STOP' "$skill" && pass "plan step 3: wait for annotation" \
    || fail "plan" "missing step 3: wait for annotation"

  # Step 4: Address annotations (loop)
  grep -q 'Address Annotations\|address.*annotation' "$skill" && pass "plan step 4: address annotations" \
    || fail "plan" "missing step 4: address annotations"
  grep -qiE '//.*annotation' "$skill" && pass "plan step 4: // comment pattern" \
    || fail "plan" "step 4 missing // annotation pattern"

  # Step 5: Generate todo list
  grep -q 'Todo List\|todo list' "$skill" && pass "plan step 5: generate todo list" \
    || fail "plan" "missing step 5: todo list generation"

  # Step 6: Generate visual plan
  grep -q 'generate-visual-plan' "$skill" && pass "plan step 6: invoke /generate-visual-plan" \
    || fail "plan" "missing step 6: /generate-visual-plan invocation"
  grep -q 'visual-plan\.html' "$skill" && pass "plan step 6: produces visual-plan.html" \
    || fail "plan" "missing step 6: visual-plan.html artifact"
}

test_phase_implement() {
  echo "Phase steps: Implement"
  local skill="$REPO_DIR/skills/implement/SKILL.md"

  # Step 1: Read the plan
  grep -q 'Read the plan' "$skill" && pass "implement step 1: read plan" \
    || fail "implement" "missing step 1: read plan"

  # Step 2: Implement via tdd-guide agent (batched)
  grep -q 'tdd-guide' "$skill" && pass "implement step 2: tdd-guide agent" \
    || fail "implement" "missing step 2: tdd-guide agent"
  grep -qiE 'batch\|3-5' "$skill" && pass "implement step 2: task batching (3-5)" \
    || fail "implement" "step 2 missing task batching instruction"

  # Step 3: Track progress
  grep -qiE 'Track progress\|mark.*\[x\]' "$skill" && pass "implement step 3: track progress" \
    || fail "implement" "missing step 3: progress tracking"

  # Step 4: Code quality
  grep -qiE 'code quality\|existing.*patterns' "$skill" && pass "implement step 4: code quality" \
    || fail "implement" "missing step 4: code quality"

  # Step 5: Verify loop (type check, lint, test, build)
  grep -qiE 'type check' "$skill" && pass "implement step 5: type check" \
    || fail "implement" "step 5 missing type check"
  grep -qiE 'lint' "$skill" && pass "implement step 5: lint" \
    || fail "implement" "step 5 missing lint"
  grep -qiE 'test suite\|full test' "$skill" && pass "implement step 5: test suite" \
    || fail "implement" "step 5 missing test suite"
  grep -qiE 'build' "$skill" && pass "implement step 5: build" \
    || fail "implement" "step 5 missing build"

  # Step 6: Database reviewer (conditional)
  grep -q 'database-reviewer' "$skill" && pass "implement step 6: database-reviewer agent" \
    || fail "implement" "missing step 6: database-reviewer agent"

  # Step 7: Simplify
  grep -q '/simplify' "$skill" && pass "implement step 7: /simplify" \
    || fail "implement" "missing step 7: /simplify invocation"

  # Step 8: Refactor cleanup
  grep -q 'refactor-cleaner' "$skill" && pass "implement step 8: refactor-cleaner agent" \
    || fail "implement" "missing step 8: refactor-cleaner agent"

  # Step 9: Code review
  grep -q 'code-reviewer' "$skill" && pass "implement step 9: code-reviewer agent" \
    || fail "implement" "missing step 9: code-reviewer agent"
  grep -qiE 'OWASP' "$skill" && pass "implement step 9: OWASP security checks" \
    || fail "implement" "step 9 missing OWASP reference"

  # Step 10: Doc updater (conditional)
  grep -q 'doc-updater' "$skill" && pass "implement step 10: doc-updater agent" \
    || fail "implement" "missing step 10: doc-updater agent"

  # Step 11: Fact-check
  grep -q 'fact-check' "$skill" && pass "implement step 11: /fact-check" \
    || fail "implement" "missing step 11: /fact-check invocation"

  # Step 12: Refresh visual artifacts (conditional)
  grep -q 'visual-plan\.html' "$skill" && pass "implement step 12: refresh visual-plan.html" \
    || fail "implement" "missing step 12: visual-plan.html refresh"
  grep -q 'generate-visual-plan' "$skill" && pass "implement step 12: invoke /generate-visual-plan" \
    || fail "implement" "step 12 missing /generate-visual-plan invocation"

  # Step 13: Report completion (never commit)
  grep -qiE 'never commit\|do not commit\|NEVER commit' "$skill" && pass "implement step 13: never commit guard" \
    || fail "implement" "missing step 13: never commit guard"
}

test_phase_orchestrator() {
  echo "Phase steps: Build-Feature Orchestrator"
  local skill="$REPO_DIR/skills/build-feature/SKILL.md"

  # Creates feature directory
  grep -q 'docs/claude/' "$skill" && pass "orchestrator: feature directory convention" \
    || fail "orchestrator" "missing feature directory convention"

  # Invokes all 3 sub-skills
  for phase in research plan implement; do
    grep -q "$phase" "$skill" && pass "orchestrator: invokes $phase skill" \
      || fail "orchestrator" "missing $phase skill invocation"
  done

  # Stop points between phases
  grep -c 'Wait for the user' "$skill" | grep -qE '^[2-9]' \
    && pass "orchestrator: has user wait points between phases" \
    || fail "orchestrator" "missing wait points between phases"

  # Optional VE integration
  grep -q 'visual-explainer' "$skill" && pass "orchestrator: VE integration" \
    || fail "orchestrator" "missing visual-explainer integration"

  # Diff review after implementation
  grep -q 'diff-review' "$skill" && pass "orchestrator: /diff-review after implementation" \
    || fail "orchestrator" "missing /diff-review after implementation"

  # Fact-check on diff review
  grep -q 'fact-check' "$skill" && pass "orchestrator: /fact-check on diff-review" \
    || fail "orchestrator" "missing /fact-check on diff-review"
}
```

Cross-reference integrity check:

```bash
# ── Test: Cross-Reference Integrity ──────────────────────────────────

test_cross_references() {
  echo "Cross-references: Skills → Skills"
  # build-feature invokes research, plan, implement
  for target in research plan implement; do
    if [ -f "$REPO_DIR/skills/$target/SKILL.md" ]; then
      pass "build-feature → $target exists"
    else
      fail "build-feature" "references skill '$target' but skills/$target/SKILL.md not found"
    fi
  done

  echo "Cross-references: Skills → Agents"
  # Extract agent references from skill files: subagent_type values
  for skill_file in "$REPO_DIR"/skills/*/SKILL.md; do
    skill_name=$(basename "$(dirname "$skill_file")")
    grep -oE 'subagent_type.*"([-a-z]+)"' "$skill_file" 2>/dev/null | grep -oE '"[-a-z]+"' | tr -d '"' | sort -u | while read -r agent; do
      if [ -f "$REPO_DIR/agents/$agent.md" ]; then
        pass "$skill_name → agent '$agent' exists"
      else
        fail "$skill_name" "references agent '$agent' but agents/$agent.md not found"
      fi
    done
  done

  echo "Cross-references: Commands → VE References"
  # Commands reference ~/.claude/skills/visual-explainer/references/<file>
  for cmd_file in "$REPO_DIR"/commands/*.md; do
    cmd_name=$(basename "$cmd_file" .md)
    grep -oE 'visual-explainer/references/[a-z0-9_-]+\.md' "$cmd_file" 2>/dev/null | sort -u | while read -r ref_path; do
      local_path="$REPO_DIR/skills/$ref_path"
      if [ -f "$local_path" ]; then
        pass "$cmd_name → $ref_path exists"
      else
        fail "$cmd_name" "references $ref_path but file not found"
      fi
    done
  done

  echo "Cross-references: Commands → VE Core"
  for cmd_file in "$REPO_DIR"/commands/*.md; do
    cmd_name=$(basename "$cmd_file" .md)
    if grep -q 'visual-explainer/core\.md' "$cmd_file" 2>/dev/null; then
      if [ -f "$REPO_DIR/skills/visual-explainer/core.md" ]; then
        pass "$cmd_name → core.md exists"
      else
        fail "$cmd_name" "references visual-explainer/core.md but file not found"
      fi
    fi
  done

  echo "Cross-references: Commands → VE Templates"
  for cmd_file in "$REPO_DIR"/commands/*.md; do
    cmd_name=$(basename "$cmd_file" .md)
    grep -oE 'visual-explainer/templates/[a-z0-9_-]+\.html' "$cmd_file" 2>/dev/null | sort -u | while read -r tmpl_path; do
      local_path="$REPO_DIR/skills/$tmpl_path"
      if [ -f "$local_path" ]; then
        pass "$cmd_name → $tmpl_path exists"
      else
        fail "$cmd_name" "references $tmpl_path but file not found"
      fi
    done
  done
}
```

Agent → rule dependency check:

```bash
# ── Test: Agent Rule Dependencies ────────────────────────────────────

test_agent_rule_deps() {
  echo "Agent → Rule dependencies"
  for agent_file in "$REPO_DIR"/agents/*.md; do
    agent_name=$(basename "$agent_file" .md)
    # Look for rules/ references in agent body (after frontmatter)
    sed '1,/^---$/d' "$agent_file" | grep -oE 'rules/[a-z_-]+\.md' 2>/dev/null | sort -u | while read -r rule_ref; do
      if [ -f "$REPO_DIR/$rule_ref" ]; then
        pass "$agent_name → $rule_ref exists"
      else
        fail "$agent_name" "references $rule_ref but file not found"
      fi
    done
  done
}

test_rule_coverage() {
  echo "Rule coverage (every rule referenced by ≥1 agent)"
  for rule_file in "$REPO_DIR"/rules/*.md; do
    rule_name=$(basename "$rule_file")
    if grep -rl "$rule_name" "$REPO_DIR"/agents/*.md >/dev/null 2>&1; then
      pass "$rule_name is referenced by at least one agent"
    else
      fail "$rule_name" "not referenced by any agent"
    fi
  done
}
```

Symlink target validation:

```bash
# ── Test: Symlink Targets ────────────────────────────────────────────

test_symlink_targets() {
  echo "Symlink targets (install.sh sources exist)"

  # Skills: every skills/*/ directory
  for skill_dir in "$REPO_DIR"/skills/*/; do
    name=$(basename "$skill_dir")
    if [ -f "$skill_dir/SKILL.md" ]; then
      pass "skills/$name/SKILL.md exists"
    else
      fail "skills/$name" "directory exists but SKILL.md missing"
    fi
  done

  # Rules
  for rule in "$REPO_DIR"/rules/*.md; do
    name=$(basename "$rule")
    pass "rules/$name exists"
  done

  # Commands
  for cmd in "$REPO_DIR"/commands/*.md; do
    name=$(basename "$cmd")
    pass "commands/$name exists"
  done

  # Agents
  for agent in "$REPO_DIR"/agents/*.md; do
    name=$(basename "$agent")
    pass "agents/$name exists"
  done
}
```

Guide ↔ SKILL sync (agents/commands in guide.html match SKILL.md):

```bash
# ── Test: Step Numbering ─────────────────────────────────────────────

test_guide_skill_sync() {
  echo "Guide ↔ SKILL sync (agents/commands match)"
  for skill_dir in "$REPO_DIR"/skills/*/; do
    name=$(basename "$skill_dir")
    guide="$skill_dir/guide.html"
    skill="$skill_dir/SKILL.md"

    [ -f "$guide" ] || continue
    [ -f "$skill" ] || continue

    # Count "Step N" references in SKILL.md (### Step N pattern)
    skill_steps=$(grep -cE '^###\s+Step\s+[0-9]' "$skill" || echo 0)

    # Count step rows in guide.html (look for step number cells)
    # guide.html uses <td>N.N</td> pattern for step numbers
    guide_steps=$(grep -coE '<td>[0-9]+\.[0-9]+</td>' "$guide" || echo 0)

    # We can't compare counts directly since guide uses sub-steps (1.1, 1.2)
    # and SKILL.md uses major steps (Step 1, Step 2). Instead, verify that
    # every agent mentioned in guide.html exists and every agent in SKILL.md
    # appears in guide.html.

    # Check: agents referenced in guide.html exist as files
    grep -oE 'agents/[a-z_-]+\.md' "$guide" 2>/dev/null | sort -u | while read -r agent_ref; do
      if [ -f "$REPO_DIR/$agent_ref" ]; then
        pass "$name guide → $agent_ref exists"
      else
        fail "$name guide" "references $agent_ref but file not found"
      fi
    done

    # Check: agent names mentioned in SKILL.md subagent_type also appear in guide
    grep -oE 'subagent_type.*"([-a-z]+)"' "$skill" 2>/dev/null | grep -oE '"[-a-z]+"' | tr -d '"' | sort -u | while read -r agent; do
      if grep -q "$agent" "$guide" 2>/dev/null; then
        pass "$name SKILL.md agent '$agent' appears in guide.html"
      else
        fail "$name" "SKILL.md references agent '$agent' but not found in guide.html"
      fi
    done

    # Check: commands referenced in SKILL.md also appear in guide
    grep -oE '/[a-z_-]+' "$skill" 2>/dev/null | grep -vE '^/Users|^/tmp|^/dev|^/$' | sort -u | while read -r cmd; do
      cmd_name="${cmd#/}"
      # Only check commands that exist as files
      if [ -f "$REPO_DIR/commands/$cmd_name.md" ]; then
        if grep -q "$cmd_name" "$guide" 2>/dev/null; then
          pass "$name SKILL.md command '$cmd' appears in guide.html"
        else
          fail "$name" "SKILL.md references command '$cmd' but not found in guide.html"
        fi
      fi
    done
  done
}
```

Stale stub detection:

```bash
# ── Test: Stale Stubs ────────────────────────────────────────────────

test_stale_stubs() {
  echo "Stale stubs (redirect-only files)"
  for dir in agents commands rules; do
    for file in "$REPO_DIR"/$dir/*.md; do
      [ -f "$file" ] || continue
      name=$(basename "$file")
      # A stub file has < 5 non-empty lines and contains "moved" or "merged" or "see"
      line_count=$(grep -c '.' "$file" || echo 0)
      if [ "$line_count" -lt 5 ]; then
        if grep -qiE '(moved to|merged into|has been|see )' "$file" 2>/dev/null; then
          fail "$dir/$name" "appears to be a stale stub ($line_count lines with redirect language)"
        fi
      fi
    done
  done

  # Also check skills
  for file in "$REPO_DIR"/skills/visual-explainer/references/*.md; do
    [ -f "$file" ] || continue
    name=$(basename "$file")
    line_count=$(grep -c '.' "$file" || echo 0)
    if [ "$line_count" -lt 5 ]; then
      if grep -qiE '(moved to|merged into|has been|see )' "$file" 2>/dev/null; then
        fail "visual-explainer/references/$name" "appears to be a stale stub"
      fi
    fi
  done

  pass "Stale stub scan complete"
}
```

Main runner:

```bash
# ── Main ─────────────────────────────────────────────────────────────

main() {
  echo ""
  echo "Pipeline Integrity Tests"
  echo "========================"
  echo ""

  test_frontmatter_skills
  echo ""
  test_frontmatter_agents
  echo ""
  test_frontmatter_commands
  echo ""
  test_phase_research
  echo ""
  test_phase_plan
  echo ""
  test_phase_implement
  echo ""
  test_phase_orchestrator
  echo ""
  test_cross_references
  echo ""
  test_agent_rule_deps
  echo ""
  test_rule_coverage
  echo ""
  test_symlink_targets
  echo ""
  test_guide_skill_sync
  echo ""
  test_stale_stubs

  echo ""
  echo "========================"
  echo "Results: $PASS passed, $FAIL failed"

  if [ "$FAIL" -gt 0 ]; then
    echo ""
    echo "Failures:"
    for err in "${ERRORS[@]}"; do
      echo "  - $err"
    done
    exit 1
  fi
}

main "$@"
```

### `.githooks/pre-commit` (MODIFY)

Add the pipeline test script call before the existing sync-permissions call:

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(git rev-parse --show-toplevel)"

# Validate pipeline integrity
bash "$REPO_DIR/scripts/test-pipeline.sh"

# Sync permissions from Claude Code to OpenCode
python3 "$REPO_DIR/scripts/sync-permissions.py"

# If the sync changed opencode.jsonc, stage it
if ! git diff --quiet -- opencode/opencode.jsonc 2>/dev/null; then
  git add opencode/opencode.jsonc
fi
```

## New Files

| File | Purpose |
|------|---------|
| `scripts/test-pipeline.sh` | Main test script — validates all pipeline integrity checks |
| `scripts/test-pipeline-self-test.sh` | Self-test harness — validates test-pipeline.sh catches errors |

## Dependencies

None. Pure bash with standard Unix tools (`grep`, `sed`, `awk`, `sort`).

## Considerations & Trade-offs

### Bash vs Python

Python would allow YAML parsing (`pyyaml`) and cleaner string handling, but introduces a dependency. The frontmatter in this repo is simple enough (single-line key-value pairs) that `sed`/`grep` extraction works reliably. If the frontmatter grows more complex (nested YAML, multi-line values), migrating to Python would be warranted.

### Phase step validation: keyword matching vs. AST parsing

Each phase test uses `grep` to check for key phrases ("tdd-guide", "/simplify", "OWASP", "never commit") rather than trying to parse markdown structure. This is intentionally loose — it catches deletions and renames (the real risks) without breaking when prose is reworded. The tradeoff is that a step could technically be mentioned in a comment or note without being an actual instruction, but in practice these SKILL.md files are tightly written and false positives are unlikely.

### Guide ↔ SKILL sync: structural matching

guide.html uses sub-step numbering (3.1, 3.2, ...) while SKILL.md uses major steps (Step 1, Step 2, ...). Instead of count matching, we validate that every agent and command referenced in one file appears in the other. This catches stale references after renames/deletions without breaking on harmless numbering differences.

### Pre-commit hook vs. CI-only

Running tests on pre-commit catches errors before they enter history. The test script runs in <1 second (it's just file reads and greps), so it won't slow commits. The tradeoff is that if a test is flaky or overly strict, it blocks all commits until fixed.

### Built-in skill validation

`/simplify` and `frontend-design` are built-in Claude Code skills with no local files. We can verify that SKILL.md references them, but we can't verify they exist. The test script will skip validation for known built-in skills rather than false-flagging them.

## Migration / Data Changes

None.

## Testing Strategy

The test script tests itself — if it runs clean on the current repo state (which we know is correct from the recent manual review), that validates the positive case. We also need to verify it catches actual errors.

**Test file:** `scripts/test-pipeline-self-test.sh` — a wrapper that creates temporary broken files, runs the test script, and verifies it catches each error class.

| # | Test Case | File | Expected |
|---|-----------|------|----------|
| 1 | Valid repo passes all checks | `test-pipeline-self-test.sh` | `test-pipeline.sh` exits 0 on the real repo |
| 2 | Missing frontmatter `name` field detected | `test-pipeline-self-test.sh` | Create a temp skill without `name:`, verify FAIL |
| 3 | Missing frontmatter `tools` field in agent detected | `test-pipeline-self-test.sh` | Create a temp agent without `tools:`, verify FAIL |
| 4 | Unknown tool name in agent detected | `test-pipeline-self-test.sh` | Create a temp agent with `tools: ["FakeTool"]`, verify FAIL |
| 5 | Broken cross-reference detected | `test-pipeline-self-test.sh` | Create a temp command referencing nonexistent VE file, verify FAIL |
| 6 | Missing rule file detected | `test-pipeline-self-test.sh` | Create a temp agent referencing nonexistent rule, verify FAIL |
| 7 | Stale stub file detected | `test-pipeline-self-test.sh` | Create a temp file with "moved to X" content, verify FAIL |
| 8 | Missing SKILL.md in skill directory detected | `test-pipeline-self-test.sh` | Create a skill dir without SKILL.md, verify FAIL |
| 9 | Research phase: all 5 steps present | `test-pipeline.sh` | Verify research SKILL.md has scope, deep-read, write, architecture diagram, STOP |
| 10 | Research phase: all 8 required sections | `test-pipeline.sh` | Verify research.md template requires Overview through Current State |
| 11 | Plan phase: all 6 steps present | `test-pipeline.sh` | Verify plan SKILL.md has read context, architect, domain detection, write, annotation, todo, visual-plan |
| 12 | Plan phase: all required plan.md sections | `test-pipeline.sh` | Verify Goal through Testing Strategy |
| 13 | Implement phase: all 13 steps present | `test-pipeline.sh` | Verify all agents (tdd-guide, database-reviewer, refactor-cleaner, code-reviewer, doc-updater), commands (/simplify, /fact-check, /generate-visual-plan), and guards (never commit) |
| 14 | Orchestrator: invokes all 3 sub-skills | `test-pipeline.sh` | Verify build-feature references research, plan, implement |
| 15 | Orchestrator: has wait points and VE integration | `test-pipeline.sh` | Verify user wait points, diff-review, fact-check |

## Todo List

### Phase 1: Test Framework Core

- [x] Create `scripts/test-pipeline.sh` with shebang, `set -euo pipefail`, REPO_DIR, counters, `pass()`/`fail()` helpers, and `main()` runner
- [x] Write `test_frontmatter_skills()` — validate `name` and `description` in all `skills/*/SKILL.md`
- [x] Write `test_frontmatter_agents()` — validate `name`, `description`, `tools` in all `agents/*.md`, plus tool name validation against known set
- [x] Write `test_frontmatter_commands()` — validate `description` in all `commands/*.md`

### Phase 2: Phase Step Completeness Tests

- [x] Write `test_phase_research()` — verify all 5 research steps and 8 required sections
- [x] Write `test_phase_plan()` — verify all 6 plan steps, required plan.md sections, architect/domain detection
- [x] Write `test_phase_implement()` — verify all 13 implement steps, all agent/command invocations, OWASP, never-commit guard
- [x] Write `test_phase_orchestrator()` — verify sub-skill invocations, wait points, VE integration, diff-review, fact-check

### Phase 3: Cross-Reference and Structural Tests

- [x] Write `test_cross_references()` — skills→skills, skills→agents, commands→VE references, commands→VE core, commands→VE templates
- [x] Write `test_agent_rule_deps()` — every rule referenced by an agent exists on disk
- [x] ~~Write `test_rule_coverage()` — every rule file is referenced by at least one agent~~ (Removed during /simplify: dead logic — all rules are always-on context, both branches always passed)
- [x] Write `test_symlink_targets()` — every skills/*/SKILL.md, rules/*.md, commands/*.md, agents/*.md exists
- [x] Write `test_guide_skill_sync()` — agents/commands in guide.html match SKILL.md references
- [x] Write `test_stale_stubs()` — detect redirect-only files in agents/, commands/, rules/, VE references

### Phase 4: Pre-commit Integration

- [x] Modify `.githooks/pre-commit` to call `scripts/test-pipeline.sh` before sync-permissions
- [x] Make `scripts/test-pipeline.sh` executable (`chmod +x`)

### Phase 5: Self-Tests

- [x] Create `scripts/test-pipeline-self-test.sh` with test harness (temp dir setup/teardown)
- [x] Self-test 1: valid repo passes all checks (exit 0)
- [x] Self-test 2: missing frontmatter `name` field detected
- [x] Self-test 3: missing frontmatter `tools` field in agent detected
- [x] Self-test 4: unknown tool name in agent detected
- [x] Self-test 5: broken cross-reference detected
- [x] Self-test 6: missing rule file detected
- [x] Self-test 7: stale stub file detected
- [x] Self-test 8: missing SKILL.md in skill directory detected

### Phase 6: Validation

- [x] Run `test-pipeline.sh` on the real repo and confirm all tests pass (279 passed, 0 failed — reduced from 285 after /simplify removed dead `test_rule_coverage` and unified VE checks)
- [x] Run `test-pipeline-self-test.sh` and confirm all self-tests pass (8 passed, 0 failed)
- [x] Test the pre-commit hook by making a test commit

## Verification Summary

**Fact-checked against codebase on 2026-03-10.**

- **Claims checked**: 22
- **Confirmed**: 18
- **Corrections made**: 4
  1. Changed line count from "~300 lines" to "~534 lines" (actual `wc -l` of `test-pipeline.sh`)
  2. Struck through test category 6 (Rule coverage) — removed during /simplify as dead logic
  3. Added `test-pipeline-self-test.sh` to the New Files table (was missing)
  4. Changed self-test 8 description from "Unreferenced rule detected" to "Missing SKILL.md in skill directory detected" (matches actual implementation)
- **Unverifiable**: 0

Note: Code snippets in the Detailed Changes section represent the *planned* implementation, not the final code. The actual implementation diverged in several ways (e.g., `PASS=$((PASS + 1))` instead of `((PASS++))` to avoid `set -e` traps, `check_content_cached` with `[[ =~ ]]` instead of `grep`, unified VE path checker). These are expected plan-vs-implementation deltas, not errors.
