#!/usr/bin/env bash
# Validates internal consistency of markdown/YAML configuration files
# for the /build-feature pipeline.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
ERRORS=()

KNOWN_TOOLS=(Read Write Edit Bash Grep Glob Agent Skill WebFetch WebSearch NotebookEdit)
KNOWN_TOOLS_PATTERN="$(IFS='|'; echo "${KNOWN_TOOLS[*]}")"
REDIRECT_PATTERN="moved to|merged into|has been|see "
MIN_NON_EMPTY_LINES=5  # Files with fewer non-empty lines are candidates for stale stub detection

pass() { PASS=$((PASS + 1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); ERRORS+=("$1: $2"); printf '  \033[31m✗\033[0m %s: %s\n' "$1" "$2"; }

# Cached list of agent basenames (without .md)
AGENT_NAMES=()
_cache_agent_names() {
  [[ ${#AGENT_NAMES[@]} -gt 0 ]] && return
  local f
  for f in "$REPO_DIR"/agents/*.md; do
    [[ -f "$f" ]] && AGENT_NAMES+=("$(basename "$f" .md)")
  done
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

extract_frontmatter() {
  sed -n '/^---$/,/^---$/p' "$1" | sed '1d;$d'
}

extract_body() {
  # Skip frontmatter block (first --- to second ---), print the rest
  awk 'BEGIN{fm=0; done=0} /^---$/{if(!done){fm++;if(fm==2){done=1};next}} done{print}' "$1"
}

check_content_cached() {
  local content="$1"
  local label="$2"
  local pattern="$3"
  if [[ "$content" =~ $pattern ]]; then
    pass "$label contains '$pattern'"
  else
    fail "$label" "missing '$pattern'"
  fi
}

count_matches() {
  grep -cE "$1" "$2" 2>/dev/null || echo 0
}

# ---------------------------------------------------------------------------
# 1. Frontmatter: skills
# ---------------------------------------------------------------------------

test_frontmatter_skills() {
  echo "Frontmatter: skills"
  local skill_dir
  for skill_dir in "$REPO_DIR"/skills/*/; do
    local skill_file="$skill_dir/SKILL.md"
    [[ -f "$skill_file" ]] || continue
    local label
    label="skills/$(basename "$skill_dir")/SKILL.md"
    local fm
    fm="$(extract_frontmatter "$skill_file")"
    for field in name description; do
      if [[ "$fm" =~ (^|$'\n')${field}: ]]; then
        pass "$label has $field:"
      else
        fail "$label" "missing '$field:' in frontmatter"
      fi
    done
  done
}

# ---------------------------------------------------------------------------
# 2. Frontmatter: agents
# ---------------------------------------------------------------------------

test_frontmatter_agents() {
  echo "Frontmatter: agents"
  local agent_file
  for agent_file in "$REPO_DIR"/agents/*.md; do
    local label="agents/$(basename "$agent_file")"
    local fm
    fm="$(extract_frontmatter "$agent_file")"
    for field in name description tools; do
      if [[ "$fm" =~ (^|$'\n')${field}: ]]; then
        pass "$label has $field:"
      else
        fail "$label" "missing '$field:' in frontmatter"
      fi
    done
    local tools_line
    tools_line="$(echo "$fm" | grep "^tools:" || true)"
    while read -r tool; do
      [[ -z "$tool" ]] && continue
      if [[ "$tool" =~ ^($KNOWN_TOOLS_PATTERN)$ ]]; then
        pass "$label tool '$tool' is known"
      else
        fail "$label" "unknown tool '$tool'"
      fi
    done < <(echo "$tools_line" | grep -oE '"[^"]*"' | tr -d '"')
  done
}

# ---------------------------------------------------------------------------
# 3. Frontmatter: commands
# ---------------------------------------------------------------------------

test_frontmatter_commands() {
  echo "Frontmatter: commands"
  local cmd_file
  for cmd_file in "$REPO_DIR"/commands/*.md; do
    local label="commands/$(basename "$cmd_file")"
    local fm
    fm="$(extract_frontmatter "$cmd_file")"
    if [[ "$fm" =~ (^|$'\n')description: ]]; then
      pass "$label has description:"
    else
      fail "$label" "missing 'description:' in frontmatter"
    fi
  done
}

# ---------------------------------------------------------------------------
# 4. Phase: research
# ---------------------------------------------------------------------------

test_phase_research() {
  echo "Phase: research"
  local file="$REPO_DIR/skills/research/SKILL.md"
  local label="skills/research/SKILL.md"
  [[ -f "$file" ]] || { fail "$label" "file not found"; return; }
  local content
  content="$(<"$file")"

  check_content_cached "$content" "$label" "Identify the scope"
  check_content_cached "$content" "$label" "Deep-read the code"
  check_content_cached "$content" "$label" "Write the research document"

  for section in Overview Architecture "Key Files" "Data Flow" Patterns Dependencies "Edge Cases" "Current State"; do
    check_content_cached "$content" "$label" "$section"
  done

  check_content_cached "$content" "$label" "generate-architecture-diagram"
  check_content_cached "$content" "$label" "research\.html"
  check_content_cached "$content" "$label" "STOP"
}

# ---------------------------------------------------------------------------
# 5. Phase: plan
# ---------------------------------------------------------------------------

test_phase_plan() {
  echo "Phase: plan"
  local file="$REPO_DIR/skills/plan/SKILL.md"
  local label="skills/plan/SKILL.md"
  [[ -f "$file" ]] || { fail "$label" "file not found"; return; }
  local content
  content="$(<"$file")"

  check_content_cached "$content" "$label" "[Rr]ead [Cc]ontext"
  check_content_cached "$content" "$label" "research\.md"
  check_content_cached "$content" "$label" "architect"
  check_content_cached "$content" "$label" "frontend-design|frontend-patterns|api-design"
  check_content_cached "$content" "$label" "Write the plan document"

  for section in Goal "Research Reference" Approach "Detailed Changes" "New Files" Dependencies Considerations "Testing Strategy"; do
    check_content_cached "$content" "$label" "$section"
  done

  check_content_cached "$content" "$label" "Wait for Annotation|STOP"
  check_content_cached "$content" "$label" "Address Annotations"
  check_content_cached "$content" "$label" "//"
  check_content_cached "$content" "$label" "[Tt]odo [Ll]ist"
  check_content_cached "$content" "$label" "generate-visual-plan"
  check_content_cached "$content" "$label" "plan\.html"
}

# ---------------------------------------------------------------------------
# 6. Phase: implement
# ---------------------------------------------------------------------------

test_phase_implement_steps_1_to_6() {
  local content="$1"
  local label="$2"
  check_content_cached "$content" "$label" "Read the plan"
  check_content_cached "$content" "$label" "tdd-guide"
  check_content_cached "$content" "$label" "batch|3-5"
  check_content_cached "$content" "$label" "Track progress|mark.*\[x\]"
  check_content_cached "$content" "$label" "code quality|existing.*patterns"
  check_content_cached "$content" "$label" "type check"
  check_content_cached "$content" "$label" "lint"
  check_content_cached "$content" "$label" "test suite|full test"
  check_content_cached "$content" "$label" "build"
  check_content_cached "$content" "$label" "database-reviewer"
}

test_phase_implement_steps_7_to_13() {
  local content="$1"
  local label="$2"
  check_content_cached "$content" "$label" "/simplify"
  check_content_cached "$content" "$label" "refactor-cleaner"
  check_content_cached "$content" "$label" "code-reviewer"
  check_content_cached "$content" "$label" "OWASP"
  check_content_cached "$content" "$label" "doc-updater"
  check_content_cached "$content" "$label" "fact-check"
  check_content_cached "$content" "$label" "plan\.html"
  check_content_cached "$content" "$label" "generate-visual-plan"
  check_content_cached "$content" "$label" "never commit|NEVER commit|do not commit"
}

test_phase_implement() {
  echo "Phase: implement"
  local file="$REPO_DIR/skills/implement/SKILL.md"
  local label="skills/implement/SKILL.md"
  [[ -f "$file" ]] || { fail "$label" "file not found"; return; }
  local content
  content="$(<"$file")"
  test_phase_implement_steps_1_to_6 "$content" "$label"
  test_phase_implement_steps_7_to_13 "$content" "$label"
}

# ---------------------------------------------------------------------------
# 7. Phase: orchestrator (build-feature)
# ---------------------------------------------------------------------------

test_phase_orchestrator() {
  echo "Phase: orchestrator (build-feature)"
  local file="$REPO_DIR/skills/build-feature/SKILL.md"
  local label="skills/build-feature/SKILL.md"
  [[ -f "$file" ]] || { fail "$label" "file not found"; return; }
  local content
  content="$(<"$file")"

  check_content_cached "$content" "$label" "docs/claude/"
  for phase in research plan implement; do
    check_content_cached "$content" "$label" "$phase"
  done

  local wait_count
  wait_count="$(count_matches "Wait for the user" "$file")"
  if [[ "$wait_count" -ge 2 ]]; then
    pass "$label has 'Wait for the user' >= 2 times"
  else
    fail "$label" "'Wait for the user' appears $wait_count time(s), expected >= 2"
  fi

  check_content_cached "$content" "$label" "visual-explainer"
  check_content_cached "$content" "$label" "diff-review"
  check_content_cached "$content" "$label" "fact-check"
}

# ---------------------------------------------------------------------------
# 8. Cross-references
# ---------------------------------------------------------------------------

check_skill_references_phases() {
  for phase in research plan implement; do
    local target="$REPO_DIR/skills/$phase/SKILL.md"
    if [[ -f "$target" ]]; then
      pass "skills/$phase/SKILL.md exists (referenced from build-feature)"
    else
      fail "cross-ref" "skills/$phase/SKILL.md not found"
    fi
  done
}

check_agent_files_exist() {
  local agent_names_str
  agent_names_str="$(printf '%s\n' "${AGENT_NAMES[@]}")"
  local skill_file
  for skill_file in "$REPO_DIR"/skills/*/SKILL.md; do
    while read -r agent_name; do
      [[ -z "$agent_name" ]] && continue
      local agent_file="$REPO_DIR/agents/${agent_name}.md"
      if [[ -f "$agent_file" ]]; then
        pass "agents/${agent_name}.md exists (referenced from $(basename "$(dirname "$skill_file")")/SKILL.md)"
      else
        fail "cross-ref" "agents/${agent_name}.md not found (referenced from $skill_file)"
      fi
    done < <(grep -oE '`[a-z][a-z0-9-]+`' "$skill_file" | tr -d '`' | grep -Ff <(echo "$agent_names_str") || true)
  done
}

check_ve_paths() {
  local ve_dir="$REPO_DIR/skills/visual-explainer"
  local cmd_file
  for cmd_file in "$REPO_DIR"/commands/*.md; do
    local cmd_label="commands/$(basename "$cmd_file")"
    local content
    content="$(<"$cmd_file")"
    # Check references/ and templates/ — strip "visual-explainer/" prefix since ve_dir already includes it
    local ve_subpath
    while read -r ve_subpath; do
      [[ -z "$ve_subpath" ]] && continue
      local rel_path="${ve_subpath#visual-explainer/}"
      local target="$ve_dir/$rel_path"
      if [[ -f "$target" ]]; then
        pass "skills/visual-explainer/$rel_path exists"
      else
        fail "cross-ref" "$target not found (referenced from $cmd_label)"
      fi
    done < <(echo "$content" | grep -oE "visual-explainer/(references|templates)/[a-z._-]+" | sort -u || true)
    # Check core.md
    if [[ "$content" =~ visual-explainer/core\.md ]]; then
      if [[ -f "$ve_dir/core.md" ]]; then
        pass "skills/visual-explainer/core.md exists (referenced from $cmd_label)"
      else
        fail "cross-ref" "skills/visual-explainer/core.md not found"
      fi
    fi
  done
}

test_cross_references() {
  echo "Cross-references"
  check_skill_references_phases
  check_agent_files_exist
  check_ve_paths
}

# ---------------------------------------------------------------------------
# 9. Agent rule dependencies
# ---------------------------------------------------------------------------

test_agent_rule_deps() {
  echo "Agent rule dependencies"
  local agent_file
  for agent_file in "$REPO_DIR"/agents/*.md; do
    local label="agents/$(basename "$agent_file")"
    local body
    body="$(extract_body "$agent_file")"
    while read -r rule_path; do
      [[ -z "$rule_path" ]] && continue
      local rule_name="${rule_path#rules/}"
      local target="$REPO_DIR/rules/$rule_name"
      if [[ -f "$target" ]]; then
        pass "$label references existing $rule_path"
      else
        fail "$label" "references $rule_path which does not exist"
      fi
    done < <(echo "$body" | grep -oE 'rules/[a-z._-]+\.md' | sort -u || true)
  done
}

# ---------------------------------------------------------------------------
# 10. Symlink targets
# ---------------------------------------------------------------------------

test_symlink_targets() {
  echo "Symlink targets"
  local skill_dir
  for skill_dir in "$REPO_DIR"/skills/*/; do
    local skill_name
    skill_name="$(basename "$skill_dir")"
    local skill_file="$skill_dir/SKILL.md"
    if [[ -f "$skill_file" ]]; then
      pass "skills/$skill_name/SKILL.md exists"
    else
      fail "skills/$skill_name" "SKILL.md not found"
    fi
  done

  for dir in rules commands agents; do
    local f
    for f in "$REPO_DIR/$dir"/*.md; do
      if [[ -f "$f" ]]; then
        pass "$dir/$(basename "$f") exists"
      else
        fail "$dir" "$(basename "$f") is not a regular file"
      fi
    done
  done
}

# ---------------------------------------------------------------------------
# 11. Guide/skill sync
# ---------------------------------------------------------------------------

check_guide_agents_exist() {
  local guide_file="$1"
  local skill_name="$2"
  while read -r agent_name; do
    [[ -z "$agent_name" ]] && continue
    local agent_file="$REPO_DIR/agents/${agent_name}.md"
    if [[ -f "$agent_file" ]]; then
      pass "guide $skill_name: agent '$agent_name' exists"
    else
      fail "guide $skill_name" "agent '$agent_name' from guide not found"
    fi
  done < <(grep -oE 'agent-name">[^<]+' "$guide_file" | sed 's/agent-name">//' | sort -u || true)
}

check_guide_contains_skill_agents() {
  local guide_file="$1"
  local skill_file="$2"
  local skill_name="$3"
  local agent_names_str
  agent_names_str="$(printf '%s\n' "${AGENT_NAMES[@]}")"
  while read -r agent_name; do
    [[ -z "$agent_name" ]] && continue
    if grep -q "$agent_name" "$guide_file"; then
      pass "guide $skill_name: agent '$agent_name' from SKILL.md appears in guide"
    else
      fail "guide $skill_name" "agent '$agent_name' from SKILL.md not found in guide"
    fi
  done < <(grep -oE '`[a-z][a-z0-9-]+`' "$skill_file" | tr -d '`' | grep -Ff <(echo "$agent_names_str") | sort -u || true)
}

check_guide_contains_skill_commands() {
  local guide_file="$1"
  local skill_file="$2"
  local skill_name="$3"
  while read -r cmd_path; do
    [[ -z "$cmd_path" ]] && continue
    # Skip absolute and home-relative paths (not local command references)
    [[ "$cmd_path" =~ ^(/|~) ]] && continue
    local cmd_name
    cmd_name="$(basename "$cmd_path" .md)"
    local local_cmd="$REPO_DIR/commands/${cmd_name}.md"
    [[ -f "$local_cmd" ]] || continue
    if grep -q "$cmd_name" "$guide_file"; then
      pass "guide $skill_name: command '$cmd_name' from SKILL.md appears in guide"
    else
      fail "guide $skill_name" "command '$cmd_name' from SKILL.md not found in guide"
    fi
  done < <(grep -oE '[a-z][a-z0-9/_-]+\.md' "$skill_file" | sort -u || true)
}

test_guide_skill_sync() {
  echo "Guide/skill sync"
  local skill_dir
  for skill_dir in "$REPO_DIR"/skills/*/; do
    local skill_name
    skill_name="$(basename "$skill_dir")"
    local guide_file="$skill_dir/guide.html"
    local skill_file="$skill_dir/SKILL.md"
    [[ -f "$guide_file" && -f "$skill_file" ]] || continue
    check_guide_agents_exist "$guide_file" "$skill_name"
    check_guide_contains_skill_agents "$guide_file" "$skill_file" "$skill_name"
    check_guide_contains_skill_commands "$guide_file" "$skill_file" "$skill_name"
  done
}

# ---------------------------------------------------------------------------
# 12. Stale stubs
# ---------------------------------------------------------------------------

check_stale_in_dir() {
  local dir="$1"
  local label_prefix="$2"
  local stub_file
  for stub_file in "$dir"/*.md; do
    [[ -f "$stub_file" ]] || continue
    local label="${label_prefix}/$(basename "$stub_file")"
    local non_empty_count
    non_empty_count="$(grep -cE '.+' "$stub_file" 2>/dev/null || echo 0)"
    if [[ "$non_empty_count" -lt "$MIN_NON_EMPTY_LINES" ]]; then
      if grep -qiE "$REDIRECT_PATTERN" "$stub_file"; then
        fail "$label" "appears to be a stale stub ($non_empty_count non-empty lines with redirect language)"
      else
        pass "$label is short but has no redirect language"
      fi
    else
      pass "$label has $non_empty_count non-empty lines (not a stub)"
    fi
  done
}

test_stale_stubs() {
  echo "Stale stubs"
  check_stale_in_dir "$REPO_DIR/agents" "agents"
  check_stale_in_dir "$REPO_DIR/commands" "commands"
  check_stale_in_dir "$REPO_DIR/rules" "rules"
  check_stale_in_dir "$REPO_DIR/skills/visual-explainer/references" "skills/visual-explainer/references"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  _cache_agent_names
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
  test_symlink_targets
  echo ""
  test_guide_skill_sync
  echo ""
  test_stale_stubs

  echo ""
  echo "Results: $PASS passed, $FAIL failed"

  if [[ "${#ERRORS[@]}" -gt 0 ]]; then
    echo ""
    echo "Failures:"
    for err in "${ERRORS[@]}"; do
      printf '  \033[31m✗\033[0m %s\n' "$err"
    done
    exit 1
  fi
}

main
