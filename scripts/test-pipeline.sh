#!/usr/bin/env bash
# Validates internal consistency of markdown/YAML configuration files
# for the /build pipeline.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
ERRORS=()

KNOWN_TOOLS=(Read Write Edit Bash Grep Glob Agent Skill WebFetch WebSearch NotebookEdit)
KNOWN_TOOLS_PATTERN="$(IFS='|'; echo "${KNOWN_TOOLS[*]}")"
REDIRECT_PATTERN="moved to|merged into|has been|see "
MIN_NON_EMPTY_LINES=5  # Files with fewer non-empty lines are candidates for stale stub detection

# Colour only when writing to a terminal; piped output (pre-commit, self-test)
# stays clean.
if [ -t 1 ]; then
  G=$'\033[32m'; R=$'\033[31m'; D=$'\033[2m'; B=$'\033[1m'; C=$'\033[36m'; N=$'\033[0m'
else
  G=""; R=""; D=""; B=""; C=""; N=""
fi

CURRENT=""
# A check passes/fails silently by default — the per-section summary line and
# the final failures block carry the signal. VERBOSE=1 prints every check.
pass() { PASS=$((PASS + 1)); [ -n "${VERBOSE:-}" ] && printf '    %s✓%s %s\n' "$G" "$N" "$1"; return 0; }
fail() { FAIL=$((FAIL + 1)); ERRORS+=("$1: $2"); [ -n "${VERBOSE:-}" ] && printf '    %s✗%s %s: %s\n' "$R" "$N" "$1" "$2"; return 0; }

# section() names the current group; run() executes a group and prints one
# ✓/✗ summary line with the number of checks it ran.
section() { CURRENT="$1"; }
run() {
  local p0=$PASS f0=$FAIL
  "$1"
  local dp=$((PASS - p0)) df=$((FAIL - f0))
  if [ "$df" -eq 0 ]; then
    printf '  %s✓%s %-52s %s%2d ok%s\n' "$G" "$N" "$CURRENT" "$D" "$dp" "$N"
  else
    printf '  %s✗%s %-52s %s%d/%d failed%s\n' "$R" "$N" "$CURRENT" "$R" "$df" "$((dp + df))" "$N"
  fi
}

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

gather_skill_content() {
  # SKILL.md plus only the reference files it actually links (its own
  # references/ and ../shared/references/), resolved relative to the skill dir.
  # A required workflow phrase still registers after it is relocated out of
  # SKILL.md into a reference the skill imports — but a phrase living in a
  # shared reference the skill does NOT import does not count. Phrase checks
  # assert "this skill defines X", following the same import graph an agent
  # would when it reads the SKILL and follows its links.
  local skill="$1"
  local skill_dir="$REPO_DIR/skills/$skill"
  local skill_file="$skill_dir/SKILL.md"
  cat "$skill_file" 2>/dev/null || true
  local rel
  while read -r rel; do
    [[ -z "$rel" ]] && continue
    [[ "$rel" =~ ^https?: ]] && continue
    [[ -f "$skill_dir/$rel" ]] && { printf '\n'; cat "$skill_dir/$rel"; }
  done < <(grep -oE '\]\([^)]*references/[^)]+\.md\)' "$skill_file" 2>/dev/null \
             | sed -E 's/^\]\(//; s/\)$//' | sort -u || true)
}

# ---------------------------------------------------------------------------
# 1. Frontmatter: skills
# ---------------------------------------------------------------------------

test_frontmatter_skills() {
  section "Frontmatter: skills"
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
  section "Frontmatter: agents"
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
  section "Frontmatter: commands"
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
# 4. Phase: grill
# ---------------------------------------------------------------------------

test_phase_grill() {
  section "Phase: grill"
  local file="$REPO_DIR/skills/grill/SKILL.md"
  local label="skills/grill/SKILL.md"
  [[ -f "$file" ]] || { fail "$label" "file not found"; return; }
  local content
  content="$(gather_skill_content grill)"

  check_content_cached "$content" "$label" "one at a time"
  check_content_cached "$content" "$label" "CONTEXT\.md"
  check_content_cached "$content" "$label" "docs/adr/"
  check_content_cached "$content" "$label" "[Cc]hallenge against the glossary"
  check_content_cached "$content" "$label" "[Ss]harpen fuzzy language"
  check_content_cached "$content" "$label" "[Cc]ross-reference with code"
  check_content_cached "$content" "$label" "[Hh]ard to reverse"
  check_content_cached "$content" "$label" "real trade-off"
  check_content_cached "$content" "$label" "draft the PRD"
}

# ---------------------------------------------------------------------------
# 5. Phase: prd
# ---------------------------------------------------------------------------

test_phase_prd() {
  section "Phase: prd"
  local file="$REPO_DIR/skills/prd/SKILL.md"
  local label="skills/prd/SKILL.md"
  [[ -f "$file" ]] || { fail "$label" "file not found"; return; }
  local content
  content="$(gather_skill_content prd)"

  check_content_cached "$content" "$label" "[Rr]ead [Cc]ontext"
  check_content_cached "$content" "$label" "CONTEXT\.md"
  check_content_cached "$content" "$label" "[Ss]ynthesize"
  check_content_cached "$content" "$label" "[Dd]eep module"
  check_content_cached "$content" "$label" "Write the PRD"

  for section in "Problem Statement" Solution "User Stories" "Implementation Decisions" "Testing Decisions" "Out of Scope"; do
    check_content_cached "$content" "$label" "$section"
  done

  check_content_cached "$content" "$label" "[Aa]nnotat"
  check_content_cached "$content" "$label" "[Aa]ddress"
  check_content_cached "$content" "$label" "//"
  check_content_cached "$content" "$label" "visual-explainer"
  check_content_cached "$content" "$label" "prd\.html"
}

# ---------------------------------------------------------------------------
# 5b. Phase: tasks
# ---------------------------------------------------------------------------

test_phase_tasks() {
  section "Phase: tasks"
  local file="$REPO_DIR/skills/tasks/SKILL.md"
  local label="skills/tasks/SKILL.md"
  [[ -f "$file" ]] || { fail "$label" "file not found"; return; }
  local content
  content="$(gather_skill_content tasks)"

  check_content_cached "$content" "$label" "vertical slice|vertical-slice|tracer bullet"
  check_content_cached "$content" "$label" "[Hh]oriz" # rejects horizontal slices
  check_content_cached "$content" "$label" "HITL"
  check_content_cached "$content" "$label" "AFK"
  check_content_cached "$content" "$label" "[Aa]cceptance criteria"
  check_content_cached "$content" "$label" "[Bb]locked by"
  check_content_cached "$content" "$label" "tasks\.md"
  check_content_cached "$content" "$label" "tasks\.html"
  check_content_cached "$content" "$label" "visual-explainer"
}

# ---------------------------------------------------------------------------
# 6. Phase: implement
# ---------------------------------------------------------------------------

test_phase_implement_core() {
  local content="$1"
  local label="$2"
  check_content_cached "$content" "$label" "tasks\.md"
  check_content_cached "$content" "$label" "tdd-guide|RED.*GREEN|red-green-refactor"
  check_content_cached "$content" "$label" "vertical slice|vertical-slice|one slice at a time"
  check_content_cached "$content" "$label" "[Tt]racer bullet"
  check_content_cached "$content" "$label" "[Oo]ne test at a time|one test, one impl"
  check_content_cached "$content" "$label" "public interface"
  check_content_cached "$content" "$label" "[Tt]ype check"
  check_content_cached "$content" "$label" "[Ll]int"
  check_content_cached "$content" "$label" "test suite|full test"
  check_content_cached "$content" "$label" "[Bb]uild"
  check_content_cached "$content" "$label" "database-reviewer"
}

test_phase_implement_post() {
  local content="$1"
  local label="$2"
  check_content_cached "$content" "$label" "code-cleaner"
  check_content_cached "$content" "$label" "refactor-cleaner"
  check_content_cached "$content" "$label" "code-reviewer"
  check_content_cached "$content" "$label" "OWASP"
  check_content_cached "$content" "$label" "doc-updater"
  check_content_cached "$content" "$label" "fact-checker"
  check_content_cached "$content" "$label" "prd\.html|tasks\.html"
  check_content_cached "$content" "$label" "diff-review"
  check_content_cached "$content" "$label" "never commit|NEVER commit|do not commit"
}

test_phase_implement() {
  section "Phase: implement"
  local file="$REPO_DIR/skills/implement/SKILL.md"
  local label="skills/implement/SKILL.md"
  [[ -f "$file" ]] || { fail "$label" "file not found"; return; }
  local content
  content="$(gather_skill_content implement)"
  test_phase_implement_core "$content" "$label"
  test_phase_implement_post "$content" "$label"
}

# ---------------------------------------------------------------------------
# 6b. Phase: implement-coach
# ---------------------------------------------------------------------------

test_phase_implement_coach() {
  section "Phase: implement-coach"
  local file="$REPO_DIR/skills/implement-coach/SKILL.md"
  local label="skills/implement-coach/SKILL.md"
  [[ -f "$file" ]] || { fail "$label" "file not found"; return; }
  local content
  content="$(gather_skill_content "implement-coach")"

  # Coaching-phase checks (vertical-slice TDD, one test at a time)
  check_content_cached "$content" "$label" "Coach the user"
  check_content_cached "$content" "$label" "[Oo]ne test at a time|ONE test|one (failing )?test"
  check_content_cached "$content" "$label" "vertical slice|vertical-slice"
  check_content_cached "$content" "$label" "[Dd]o NOT write all tests upfront|never (write|queue)|do not (preview|write)"
  check_content_cached "$content" "$label" "public interface"
  check_content_cached "$content" "$label" "check|verify"
  check_content_cached "$content" "$label" "[Tt]ype check"
  check_content_cached "$content" "$label" "[Ll]int"
  check_content_cached "$content" "$label" "test suite|full test"
  check_content_cached "$content" "$label" "[Bb]uild"

  # Post-completion checks (mirrors implement)
  check_content_cached "$content" "$label" "database-reviewer"
  check_content_cached "$content" "$label" "code-cleaner"
  check_content_cached "$content" "$label" "refactor-cleaner"
  check_content_cached "$content" "$label" "code-reviewer"
  check_content_cached "$content" "$label" "OWASP"
  check_content_cached "$content" "$label" "doc-updater"
  check_content_cached "$content" "$label" "fact-checker"
  check_content_cached "$content" "$label" "prd\.html|tasks\.html"
  check_content_cached "$content" "$label" "diff-review"
  check_content_cached "$content" "$label" "never commit|NEVER commit|do not commit"
}

# ---------------------------------------------------------------------------
# 6c. Phase: implement-coach holding-line discipline
#
# Coach mode's load-bearing rule is "yielding to the user IS the deliverable".
# A prior session rationalized its way out of waiting after the harness's
# `N incomplete todos - reminder K/M` injection fired: it polled the user's
# files for silent progress, then silently switched to /implement and took
# over both tests and code. The skill grew a Holding-the-line / Todo-hygiene
# section to forbid each of those moves. These assertions are the gate that
# stops a future edit from softening or deleting that section.
# ---------------------------------------------------------------------------

test_phase_implement_coach_holding_line() {
  section "Phase: implement-coach holding-line discipline"
  local skill_file="$REPO_DIR/skills/implement-coach/SKILL.md"
  local skill_label="skills/implement-coach/SKILL.md"
  local cmd_file="$REPO_DIR/commands/implement-coach.md"
  local cmd_label="commands/implement-coach.md"
  [[ -f "$skill_file" ]] || { fail "$skill_label" "file not found"; return; }
  [[ -f "$cmd_file" ]] || { fail "$cmd_label" "file not found"; return; }

  local skill_content
  skill_content="$(gather_skill_content "implement-coach")"

  # One assertion per named rationalization. Phrasing is tight because the
  # failure mode is precise: drift here is almost always softening, not
  # legitimate rewording.
  check_content_cached "$skill_content" "$skill_label" "Holding the line"
  check_content_cached "$skill_content" "$skill_label" "[Ii]ncomplete-criteria reminders are not advance signals"
  check_content_cached "$skill_content" "$skill_label" "[Nn]ever poll"
  check_content_cached "$skill_content" "$skill_label" "[Nn]ever switch modes unilaterally"
  check_content_cached "$skill_content" "$skill_label" "[Ss]ilence is not consent"
  check_content_cached "$skill_content" "$skill_label" "switch to .?/implement"
  check_content_cached "$skill_content" "$skill_label" "Todo hygiene"
  check_content_cached "$skill_content" "$skill_label" "coach actions"

  # The command file carries a one-paragraph copy so the rule lands before
  # the skill body unrolls. Drift either way (skill vs command) is a gap.
  local cmd_content
  cmd_content="$(cat "$cmd_file")"
  check_content_cached "$cmd_content" "$cmd_label" "[Ww]aiting is the deliverable"
  check_content_cached "$cmd_content" "$cmd_label" "switch to .?/implement"
  check_content_cached "$cmd_content" "$cmd_label" "[Ss]ilence is not consent"
}

# ---------------------------------------------------------------------------
# 7. Phase: orchestrator (build)
# ---------------------------------------------------------------------------

test_phase_orchestrator() {
  section "Phase: orchestrator (build)"
  local file="$REPO_DIR/skills/build/SKILL.md"
  local label="skills/build/SKILL.md"
  [[ -f "$file" ]] || { fail "$label" "file not found"; return; }
  local content
  content="$(gather_skill_content build)"

  check_content_cached "$content" "$label" "docs/features/"
  for phase in grill prd tasks implement implement-coach; do
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
}

# ---------------------------------------------------------------------------
# 8. Cross-references
# ---------------------------------------------------------------------------

check_skill_references_phases() {
  for phase in grill prd tasks implement implement-coach; do
    local target="$REPO_DIR/skills/$phase/SKILL.md"
    if [[ -f "$target" ]]; then
      pass "skills/$phase/SKILL.md exists (referenced from build)"
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

# Every `references/...md` link inside a SKILL.md must resolve to a real file —
# generalizes check_ve_paths to all skills. Guards progressive-disclosure
# imports (a skill's own references/ and ../shared/references/).
check_skill_reference_links() {
  local skill_file
  for skill_file in "$REPO_DIR"/skills/*/SKILL.md; do
    local skill_dir
    skill_dir="$(dirname "$skill_file")"
    local skill_name
    skill_name="$(basename "$skill_dir")"
    local rel
    while read -r rel; do
      [[ -z "$rel" ]] && continue
      [[ "$rel" =~ ^https?: ]] && continue
      if [[ -f "$skill_dir/$rel" ]]; then
        pass "skills/$skill_name/SKILL.md: reference '$rel' resolves"
      else
        fail "cross-ref" "skills/$skill_name/SKILL.md: reference '$rel' does not resolve"
      fi
    done < <(grep -oE '\]\([^)]*references/[^)]+\.md\)' "$skill_file" | sed -E 's/^\]\(//; s/\)$//' || true)
  done
}

test_cross_references() {
  section "Cross-references"
  check_skill_references_phases
  check_agent_files_exist
  check_ve_paths
  check_skill_reference_links
}

# ---------------------------------------------------------------------------
# 9. Agent rule dependencies
# ---------------------------------------------------------------------------

test_agent_rule_deps() {
  section "Agent rule dependencies"
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
  section "Symlink targets"
  local skill_dir
  for skill_dir in "$REPO_DIR"/skills/*/; do
    local skill_name
    skill_name="$(basename "$skill_dir")"
    [[ "$skill_name" == "shared" ]] && continue
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
  section "Guide/skill sync"
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
# 11a. Rule frontmatter: TTSR (has condition:) and rulebook (no condition:)
#
# omp's rule loader splits rules into two buckets based on frontmatter shape:
# rules with `condition:` go to TTSR; rules without go to the rulebook (when
# `description:` is present). A rule missing the right fields is silently
# dropped or wrongly bucketed. Validate the shape so drift is caught at the
# pipeline layer, not at omp runtime.
# ---------------------------------------------------------------------------

_count_condition_entries() {
  # Counts `- ` list entries directly under `condition:` in frontmatter.
  awk '
    /^condition:/ { in_cond = 1; next }
    in_cond && /^[a-zA-Z_]/ { in_cond = 0 }
    in_cond && /^[[:space:]]+-[[:space:]]/ { count++ }
    END { print count + 0 }
  '
}

test_ttsr_rule_frontmatter() {
  section "Rule frontmatter: TTSR"
  local rule_file
  for rule_file in "$REPO_DIR"/rules/*.md; do
    local label="rules/$(basename "$rule_file")"
    local fm
    fm="$(extract_frontmatter "$rule_file")"
    # Skip rules without `condition:` — those are rulebook (or always-apply)
    grep -q "^condition:" <<<"$fm" || continue
    if grep -q "^description:" <<<"$fm"; then
      pass "$label (TTSR) has description:"
    else
      fail "$label" "TTSR rule (has condition:) is missing 'description:'"
    fi
    local cond_count
    cond_count="$(_count_condition_entries <<<"$fm")"
    if [[ "$cond_count" -gt 0 ]]; then
      pass "$label has $cond_count condition entries"
    else
      fail "$label" "TTSR rule has empty or malformed 'condition:' list"
    fi
  done
}

test_rulebook_rule_frontmatter() {
  section "Rule frontmatter: rulebook"
  local rule_file
  for rule_file in "$REPO_DIR"/rules/*.md; do
    local label="rules/$(basename "$rule_file")"
    local fm
    fm="$(extract_frontmatter "$rule_file")"
    # Skip rules with `condition:` — those were validated by the TTSR check
    grep -q "^condition:" <<<"$fm" && continue
    if grep -q "^description:" <<<"$fm"; then
      pass "$label (rulebook) has description:"
    else
      fail "$label" "rulebook rule (no condition:) is missing 'description:' — would be silently dropped by omp"
    fi
    if grep -q "^alwaysApply:" <<<"$fm"; then
      fail "$label" "rulebook rule has 'alwaysApply:' — this repo deliberately uses rulebook-only (ADR-0002)"
    else
      pass "$label has no alwaysApply:"
    fi
  done
}

# ---------------------------------------------------------------------------
# 11b. Harness modules + generic install loop + omp YAML validity (ADR-0010)
# ---------------------------------------------------------------------------

test_harness_modules() {
  section "Harness modules + generic install loop"
  # install.sh must be a generic loop over module manifests, not hand-written
  # per-harness blocks.
  if grep -qE '/\*/manifest\.sh' "$REPO_DIR/install.sh"; then
    pass "install.sh loops over */manifest.sh module manifests"
  else
    fail "install.sh" "generic harness loop (*/manifest.sh) not found"
  fi
  # Every harness module must satisfy the manifest contract. Validate it the
  # way install.sh consumes it — by sourcing the manifest in isolation and
  # checking the declarations: a non-empty config_root always, and (for an
  # active, non-pending module) a non-empty consumed_categories.
  local mod name report
  for mod in "$REPO_DIR"/harnesses/*/; do
    [ -d "$mod" ] || continue
    name="$(basename "$mod")"
    if [[ ! -f "$mod/manifest.sh" ]]; then
      fail "harnesses/$name" "missing manifest.sh"
      continue
    fi
    report="$(HOME=/tmp/ai-harness-validate bash -c '
      config_root=""; consumed_categories=(); harness_pending=false
      install_module() { :; }
      # shellcheck disable=SC1090
      . "$1" 2>/dev/null || { echo SOURCE_FAIL; exit 0; }
      [ -n "$config_root" ] || echo NO_CONFIG_ROOT
      if [ "$harness_pending" != true ]; then
        [ "${#consumed_categories[@]}" -gt 0 ] || echo NO_CATEGORIES
      fi
    ' _ "$mod/manifest.sh")"
    if [[ -z "$report" ]]; then
      pass "harnesses/$name manifest satisfies the contract"
    else
      fail "harnesses/$name/manifest.sh" "contract violation: $(echo "$report" | tr '\n' ' ')"
    fi
  done
  # oh-my-pi's runtime config still resolves at its module path.
  if [[ -f "$REPO_DIR/harnesses/omp/config.yml" ]]; then
    pass "harnesses/omp/config.yml exists"
  else
    fail "harnesses/omp" "config.yml not found"
  fi
}

test_omp_yaml_valid() {
  section "omp YAML validity"
  local yml
  for yml in "$REPO_DIR"/harnesses/omp/*.yml "$REPO_DIR"/harnesses/omp/*.yaml; do
    [[ -f "$yml" ]] || continue
    local label="omp/$(basename "$yml")"
    if python3 -c "import yaml, sys; yaml.safe_load(open(sys.argv[1]))" "$yml" 2>/dev/null; then
      pass "$label parses as valid YAML"
    else
      fail "$label" "YAML parse error"
    fi
  done
}

# ---------------------------------------------------------------------------
# 11b2. omp hook shape
#
# Each omp/hooks/{pre,post}/*.ts file must (a) export a default function so
# omp's loader can invoke it, (b) import HookAPI so it's typed against the
# actual event surface, and (c) follow the directory naming convention
# (pre/guard-*.ts for blockers, post/redact-*.ts for output mutators).
# ---------------------------------------------------------------------------

test_omp_hook_shape() {
  section "omp hook shape"
  local hook_file
  for hook_file in "$REPO_DIR"/harnesses/omp/hooks/pre/*.ts "$REPO_DIR"/harnesses/omp/hooks/post/*.ts; do
    [ -f "$hook_file" ] || continue
    local dir
    dir="$(basename "$(dirname "$hook_file")")"
    local fname
    fname="$(basename "$hook_file")"
    local label="omp/hooks/$dir/$fname"
    local content
    content="$(<"$hook_file")"

    # Require a real default-export function signature at start of line —
    # not just the magic words appearing somewhere (e.g., in a comment).
    # Pattern: optional leading whitespace, `export default function`, then
    # an optional name, then `(` — the actual function signature shape.
    if grep -qE '^[[:space:]]*export[[:space:]]+default[[:space:]]+function([[:space:]]+[a-zA-Z_][a-zA-Z0-9_]*)?[[:space:]]*\(' "$hook_file"; then
      pass "$label has 'export default function (…)' signature"
    else
      fail "$label" "missing 'export default function (…)' signature at start of a line (omp loader requires a default-exported factory)"
    fi

    if grep -qE 'from[[:space:]]+["'\'']@oh-my-pi/pi-coding-agent/extensibility/hooks["'\'']' "$hook_file"; then
      pass "$label imports HookAPI from omp hooks package"
    else
      fail "$label" "missing import from '@oh-my-pi/pi-coding-agent/extensibility/hooks'"
    fi

    local stem="${fname%.ts}"
    case "$dir" in
      pre)
        if [[ "$stem" == guard-* ]]; then
          pass "$label follows pre/guard-*.ts naming"
        else
          fail "$label" "pre/ hooks must be named guard-*.ts (got '$stem')"
        fi
        ;;
      post)
        if [[ "$stem" == redact-* ]]; then
          pass "$label follows post/redact-*.ts naming"
        else
          fail "$label" "post/ hooks must be named redact-*.ts (got '$stem')"
        fi
        ;;
    esac
  done
}

# ---------------------------------------------------------------------------
# 11c. Forbidden Claude-centric phrasing
#
# The phrase "already loaded in context" (and close variants) asserts that
# rule content is auto-injected into the conversation — true in Claude Code,
# false in omp under rulebook semantics. Allowing it in any AI-readable file
# (skills/commands/agents/rules) misinforms the model on omp. Enforce its
# absence as a permanent guard.
# ---------------------------------------------------------------------------

test_no_forbidden_claude_centric_phrasing() {
  section "Forbidden Claude-centric phrasing"
  local pattern='already loaded in context|already in your context|loaded automatically into context'
  local matches
  matches="$(grep -ilE "$pattern" \
    "$REPO_DIR"/skills/*/SKILL.md \
    "$REPO_DIR"/commands/*.md \
    "$REPO_DIR"/agents/*.md \
    "$REPO_DIR"/rules/*.md \
    2>/dev/null || true)"
  if [[ -z "$matches" ]]; then
    pass "no AI-readable file contains the forbidden phrase"
  else
    while read -r match; do
      [[ -z "$match" ]] && continue
      local rel="${match#"$REPO_DIR"/}"
      fail "$rel" "contains Claude-centric phrase (matches /$pattern/i) — use cross-harness-accurate phrasing instead"
    done <<<"$matches"
  fi
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
  section "Stale stubs"
  check_stale_in_dir "$REPO_DIR/agents" "agents"
  check_stale_in_dir "$REPO_DIR/commands" "commands"
  check_stale_in_dir "$REPO_DIR/rules" "rules"
  check_stale_in_dir "$REPO_DIR/skills/visual-explainer/references" "skills/visual-explainer/references"
  check_stale_in_dir "$REPO_DIR/skills/shared/references" "skills/shared/references"
}

# ---------------------------------------------------------------------------
# 13. Isolation: no cross-harness pollution (ADR-0010)
#
# Sharing is push-only: each config root holds only its own module's files plus
# the curated shared set, and oh-my-pi's discovery of sibling USER config roots
# is disabled. Verified by installing into a throwaway HOME and asserting (a)
# the omp config disables sibling-user discovery and (b) no symlink under one
# harness's config root resolves into another harness's module directory. A
# planted leak proves the structural check actually fires.
# ---------------------------------------------------------------------------

# True if any symlink under config root $1 resolves into repo module dir $2.
root_leaks_into_module() {
  local root="$1" module="$2" mod_real link tgt
  mod_real="$(cd "$REPO_DIR/$module" 2>/dev/null && pwd)" || return 1
  [[ -d "$root" ]] || return 1
  while IFS= read -r -d '' link; do
    tgt="$(readlink -f "$link" 2>/dev/null)" || continue
    [[ "$tgt" == "$mod_real"/* ]] && return 0
  done < <(find "$root" -type l -print0 2>/dev/null)
  return 1
}

test_isolation() {
  section "Isolation: no cross-harness pollution"
  local tmphome
  tmphome="$(mktemp -d)"

  if ! HOME="$tmphome" bash "$REPO_DIR/install.sh" >/dev/null 2>&1; then
    fail "isolation" "install.sh failed under a throwaway HOME"
    rm -rf "$tmphome"
    return
  fi

  # (a) Cross-discovery of sibling USER sources is disabled in omp config.
  local flag
  for flag in enableClaudeUser enableCodexUser enablePiUser; do
    if grep -qE "^[[:space:]]*${flag}:[[:space:]]*false" "$REPO_DIR/harnesses/omp/config.yml"; then
      pass "omp config disables cross-discovery toggle '$flag'"
    else
      fail "omp/config.yml" "cross-discovery toggle '$flag' is not set to false"
    fi
  done

  # (b) No config root holds a symlink resolving into a SIBLING harness module.
  if root_leaks_into_module "$tmphome/.omp/agent" "harnesses/claude"; then
    fail "isolation" "~/.omp/agent contains a symlink into the harnesses/claude module"
  else
    pass "isolation: oh-my-pi root has no symlink into the harnesses/claude module"
  fi
  if root_leaks_into_module "$tmphome/.claude" "harnesses/omp"; then
    fail "isolation" "~/.claude contains a symlink into the harnesses/omp module"
  else
    pass "isolation: claude root has no symlink into the harnesses/omp module"
  fi

  # test-the-test: a planted sibling link MUST be detected, or the check is vacuous.
  mkdir -p "$tmphome/.omp/agent/skills"
  ln -sf "$REPO_DIR/harnesses/claude/settings.json" "$tmphome/.omp/agent/skills/_leak.json"
  if root_leaks_into_module "$tmphome/.omp/agent" "harnesses/claude"; then
    pass "isolation check catches a planted sibling leak"
  else
    fail "isolation" "planted sibling leak was NOT detected (test-the-test failed)"
  fi

  rm -rf "$tmphome"
}

# ---------------------------------------------------------------------------
# 13b. Install loop behavior (ADR-0010)
#
# The generic install loop must be idempotent, prune dangling links, skip
# pending modules, and treat each module directory as the unit of add/remove.
# Module add/remove is exercised against a throwaway HARNESSES_DIR so the
# repo's own harnesses/ is never touched.
# ---------------------------------------------------------------------------

test_install_behavior() {
  section "Install loop: idempotency, prune, module add/remove"
  local tmphome tmpmods
  tmphome="$(mktemp -d)"

  if HOME="$tmphome" bash "$REPO_DIR/install.sh" >/dev/null 2>&1; then
    pass "install.sh succeeds into a throwaway HOME"
  else
    fail "install-behavior" "install.sh failed"
    rm -rf "$tmphome"
    return
  fi
  [[ -e "$tmphome/.claude/settings.json" ]] && pass "claude module installed" \
    || fail "install-behavior" "claude settings.json missing"
  [[ -e "$tmphome/.omp/agent/config.yml" ]] && pass "oh-my-pi module installed" \
    || fail "install-behavior" "omp config.yml missing"
  [[ ! -e "$tmphome/.pi" ]] && pass "pending pi module installs nothing" \
    || fail "install-behavior" "pending pi module created ~/.pi"

  # Idempotency: a second run succeeds and a known link still resolves.
  if HOME="$tmphome" bash "$REPO_DIR/install.sh" >/dev/null 2>&1 \
     && [[ -e "$tmphome/.claude/settings.json" ]]; then
    pass "re-running install is idempotent"
  else
    fail "install-behavior" "second install run was not idempotent"
  fi

  # Prune: a dangling link in a managed category dir is removed on re-install.
  ln -s "/nonexistent-$(basename "$tmphome")" "$tmphome/.omp/agent/skills/_dangling"
  HOME="$tmphome" bash "$REPO_DIR/install.sh" >/dev/null 2>&1
  if [[ -L "$tmphome/.omp/agent/skills/_dangling" ]]; then
    fail "install-behavior" "dangling symlink not pruned on re-install"
  else
    pass "re-install prunes dangling symlinks"
  fi

  # Add/remove: a throwaway module dir is picked up by the loop; deleting the
  # directory removes that harness with nothing else disturbed.
  tmpmods="$(mktemp -d)"
  mkdir -p "$tmpmods/alpha"
  cat >"$tmpmods/alpha/manifest.sh" <<'EOF'
config_root="$HOME/.alpha-harness"
consumed_categories=(skills)
install_module() { :; }
EOF
  HARNESSES_DIR="$tmpmods" HOME="$tmphome" bash "$REPO_DIR/install.sh" >/dev/null 2>&1
  if [[ -d "$tmphome/.alpha-harness/skills" ]]; then
    pass "adding a module directory installs a new harness"
  else
    fail "install-behavior" "added module was not installed"
  fi
  rm -rf "$tmpmods/alpha"
  if HARNESSES_DIR="$tmpmods" HOME="$tmphome" bash "$REPO_DIR/install.sh" >/dev/null 2>&1; then
    pass "deleting a module directory removes it cleanly (install still succeeds)"
  else
    fail "install-behavior" "install failed after module removal"
  fi

  rm -rf "$tmphome" "$tmpmods"
}

# The TypeScript guard suite (guard core + adapters + conformance) runs under
# bun via the `test/guard` Make target, not here — this script stays pure
# static / structural validation so the self-test can re-run it cheaply.
# `make test` runs content, install, guard, and meta together.

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

# content: the shared authoring contract — skills/commands/agents/rules markdown
# is well-formed and internally consistent.
run_content() {
  run test_frontmatter_skills
  run test_frontmatter_agents
  run test_frontmatter_commands
  run test_phase_grill
  run test_phase_prd
  run test_phase_tasks
  run test_phase_implement
  run test_phase_implement_coach
  run test_phase_implement_coach_holding_line
  run test_phase_orchestrator
  run test_cross_references
  run test_agent_rule_deps
  run test_symlink_targets
  run test_guide_skill_sync
  run test_ttsr_rule_frontmatter
  run test_rulebook_rule_frontmatter
  run test_no_forbidden_claude_centric_phrasing
  run test_stale_stubs
}

# install: the install system and harness modules — manifests, omp config/hooks,
# cross-harness isolation, and idempotent/prune install behavior.
run_install() {
  run test_harness_modules
  run test_omp_yaml_valid
  run test_omp_hook_shape
  run test_isolation
  run test_install_behavior
}

# Usage: test-pipeline.sh [content|install]   (no arg runs both)
main() {
  _cache_agent_names
  local category="${1:-all}" label
  case "$category" in
    content) label="authoring contract" ;;
    install) label="install + harness modules" ;;
    all)     label="content + install" ;;
    *) printf 'unknown category %q — use: content | install (or none for all)\n' "$category" >&2; exit 2 ;;
  esac
  printf '\n  %s▌%s %sai-config%s %s— %s%s\n\n' "$C" "$N" "$B" "$N" "$D" "$label" "$N"

  case "$category" in
    content) run_content ;;
    install) run_install ;;
    all)     run_content; run_install ;;
  esac

  if [[ "${#ERRORS[@]}" -eq 0 ]]; then
    printf '\n  %s✓ %d checks passed%s\n\n' "$G$B" "$PASS" "$N"
  else
    printf '\n  %s✗ %d passed · %d failed%s\n\n  Failures:\n' "$R$B" "$PASS" "$FAIL" "$N"
    for err in "${ERRORS[@]}"; do
      printf '    %s✗%s %s\n' "$R" "$N" "$err"
    done
    printf '\n'
    exit 1
  fi
}

main "$@"
