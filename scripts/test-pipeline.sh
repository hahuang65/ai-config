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
  check_content_cached "$content" "$label" "draft the spec"
}

# ---------------------------------------------------------------------------
# 5. Phase: spec
# ---------------------------------------------------------------------------

test_phase_spec() {
  section "Phase: spec"
  local file="$REPO_DIR/skills/spec/SKILL.md"
  local label="skills/spec/SKILL.md"
  [[ -f "$file" ]] || { fail "$label" "file not found"; return; }
  local content
  content="$(gather_skill_content spec)"

  check_content_cached "$content" "$label" "[Rr]ead [Cc]ontext"
  check_content_cached "$content" "$label" "CONTEXT\.md"
  check_content_cached "$content" "$label" "[Ss]ynthesize"
  check_content_cached "$content" "$label" "[Dd]eep module"
  check_content_cached "$content" "$label" "testable-interfaces\.md"
  check_content_cached "$content" "$label" "[Tt]est surface"
  check_content_cached "$content" "$label" "[Dd]o not ask.*which modules (need|get) tests|should not have to answer.*which modules get tests"
  if [[ "$content" =~ Which[[:space:]]+should[[:space:]]+have[[:space:]]+tests[[:space:]]+written[[:space:]]+for[[:space:]]+them ]]; then
    fail "$label" "must not ask the user 'Which should have tests written for them?'"
  else
    pass "$label does not ask the user to choose tested modules"
  fi
  check_content_cached "$content" "$label" "Write the spec"

  for section in "Problem Statement" Solution "User Stories" "Implementation Decisions" "Testing Decisions" "Out of Scope"; do
    check_content_cached "$content" "$label" "$section"
  done

  check_content_cached "$content" "$label" "[Aa]nnotat"
  check_content_cached "$content" "$label" "[Aa]ddress"
  check_content_cached "$content" "$label" "//"
  check_content_cached "$content" "$label" "visualize"
  check_content_cached "$content" "$label" "specs\.html"

  # Domain consultants: the module sketch consults the api-designer /
  # frontend-architect agents when the feature touches their domain.
  check_content_cached "$content" "$label" "api-designer"
  check_content_cached "$content" "$label" "frontend-architect"
}

# ---------------------------------------------------------------------------
# 5b. Phase: tasks
# ---------------------------------------------------------------------------

test_phase_todo() {
  section "Phase: todo"
  local file="$REPO_DIR/skills/todo/SKILL.md"
  local label="skills/todo/SKILL.md"
  [[ -f "$file" ]] || { fail "$label" "file not found"; return; }
  local content
  content="$(gather_skill_content todo)"

  check_content_cached "$content" "$label" "vertical slice|vertical-slice|tracer bullet"
  check_content_cached "$content" "$label" "[Hh]oriz" # rejects horizontal slices
  check_content_cached "$content" "$label" "HITL"
  check_content_cached "$content" "$label" "AFK"
  check_content_cached "$content" "$label" "[Aa]cceptance criteria"
  check_content_cached "$content" "$label" "[Bb]locked by"
  check_content_cached "$content" "$label" "[Tt]est surface"
  check_content_cached "$content" "$label" "tasks\.md"
  check_content_cached "$content" "$label" "tasks\.html"
  check_content_cached "$content" "$label" "visualize"
}

# ---------------------------------------------------------------------------
# 6. Phase: code
# ---------------------------------------------------------------------------

test_phase_code_core() {
  local content="$1"
  local label="$2"
  check_content_cached "$content" "$label" "tasks\.md"
  check_content_cached "$content" "$label" "tdd-guide|RED.*GREEN|red-green-refactor"
  check_content_cached "$content" "$label" "vertical slice|vertical-slice|one slice at a time"
  check_content_cached "$content" "$label" "[Tt]racer bullet"
  check_content_cached "$content" "$label" "[Oo]ne test at a time|one test, one impl"
  check_content_cached "$content" "$label" "public interface"
  check_content_cached "$content" "$label" "[Tt]est surface|testable-interfaces\.md"
  check_content_cached "$content" "$label" "[Tt]ype check"
  check_content_cached "$content" "$label" "[Ll]int"
  check_content_cached "$content" "$label" "test suite|full test"
  check_content_cached "$content" "$label" "[Bb]uild"
  check_content_cached "$content" "$label" "database-reviewer"
}

test_phase_code_post() {
  local content="$1"
  local label="$2"
  check_content_cached "$content" "$label" "refactorer"
  check_content_cached "$content" "$label" "[Hh]ygiene [Mm]ode"
  check_content_cached "$content" "$label" "code-reviewer"
  check_content_cached "$content" "$label" "OWASP"
  check_content_cached "$content" "$label" "doc-updater"
  check_content_cached "$content" "$label" "fact-checker"
  check_content_cached "$content" "$label" "specs\.html|tasks\.html"
  check_content_cached "$content" "$label" "diff-review"
  check_content_cached "$content" "$label" "never commit|NEVER commit|do not commit"
}

test_phase_code() {
  section "Phase: code"
  local file="$REPO_DIR/skills/code/SKILL.md"
  local label="skills/code/SKILL.md"
  [[ -f "$file" ]] || { fail "$label" "file not found"; return; }
  local content
  content="$(gather_skill_content code)"
  test_phase_code_core "$content" "$label"
  test_phase_code_post "$content" "$label"
}

# ---------------------------------------------------------------------------
# 6b. Phase: coach
# ---------------------------------------------------------------------------

test_phase_coach() {
  section "Phase: coach"
  local file="$REPO_DIR/skills/coach/SKILL.md"
  local label="skills/coach/SKILL.md"
  [[ -f "$file" ]] || { fail "$label" "file not found"; return; }
  local content
  content="$(gather_skill_content coach)"

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
  check_content_cached "$content" "$label" "refactorer"
  check_content_cached "$content" "$label" "[Hh]ygiene [Mm]ode"
  check_content_cached "$content" "$label" "code-reviewer"
  check_content_cached "$content" "$label" "OWASP"
  check_content_cached "$content" "$label" "doc-updater"
  check_content_cached "$content" "$label" "fact-checker"
  check_content_cached "$content" "$label" "specs\.html|tasks\.html"
  check_content_cached "$content" "$label" "diff-review"
  check_content_cached "$content" "$label" "never commit|NEVER commit|do not commit"
}

# ---------------------------------------------------------------------------
# 6c. Phase: coach holding-line discipline
#
# Coach mode's load-bearing rule is "yielding to the user IS the deliverable".
# A prior session rationalized its way out of waiting after the harness's
# `N incomplete todos - reminder K/M` injection fired: it polled the user's
# files for silent progress, then silently switched to /code (then named
# /implement) and took
# over both tests and code. The skill grew a Holding-the-line / Todo-hygiene
# section to forbid each of those moves. These assertions are the gate that
# stops a future edit from softening or deleting that section.
# ---------------------------------------------------------------------------

test_phase_coach_holding_line() {
  section "Phase: coach holding-line discipline"
  local skill_file="$REPO_DIR/skills/coach/SKILL.md"
  local skill_label="skills/coach/SKILL.md"
  local cmd_file="$REPO_DIR/commands/coach.md"
  local cmd_label="commands/coach.md"
  [[ -f "$skill_file" ]] || { fail "$skill_label" "file not found"; return; }
  [[ -f "$cmd_file" ]] || { fail "$cmd_label" "file not found"; return; }

  local skill_content
  skill_content="$(gather_skill_content coach)"

  # One assertion per named rationalization. Phrasing is tight because the
  # failure mode is precise: drift here is almost always softening, not
  # legitimate rewording.
  check_content_cached "$skill_content" "$skill_label" "Holding the line"
  check_content_cached "$skill_content" "$skill_label" "[Ii]ncomplete-criteria reminders are not advance signals"
  check_content_cached "$skill_content" "$skill_label" "[Nn]ever poll"
  check_content_cached "$skill_content" "$skill_label" "[Nn]ever switch modes unilaterally"
  check_content_cached "$skill_content" "$skill_label" "[Ss]ilence is not consent"
  check_content_cached "$skill_content" "$skill_label" "switch to .?/code"
  check_content_cached "$skill_content" "$skill_label" "Todo hygiene"
  check_content_cached "$skill_content" "$skill_label" "coach actions"

  # The command file carries a one-paragraph copy so the rule lands before
  # the skill body unrolls. Drift either way (skill vs command) is a gap.
  local cmd_content
  cmd_content="$(cat "$cmd_file")"
  check_content_cached "$cmd_content" "$cmd_label" "[Ww]aiting is the deliverable"
  check_content_cached "$cmd_content" "$cmd_label" "switch to .?/code"
  check_content_cached "$cmd_content" "$cmd_label" "[Ss]ilence is not consent"
}

# ---------------------------------------------------------------------------
# 6c2. Phase: review-code (architectural review — final /build step)
#
# review-code (renamed from improve-codebase) closes the /build pipeline:
# diff-scoped there (only the feature's changes), whole-codebase standalone
# with no arguments, area-scoped when arguments name one. These assertions
# pin the three scoping modes and the discovery core.
# ---------------------------------------------------------------------------

test_phase_review_code() {
  section "Phase: review-code"
  local file="$REPO_DIR/skills/review-code/SKILL.md"
  local label="skills/review-code/SKILL.md"
  [[ -f "$file" ]] || { fail "$label" "file not found"; return; }
  local content
  content="$(gather_skill_content review-code)"

  # Three scoping modes
  check_content_cached "$content" "$label" "ONLY the changes|only the changes"
  check_content_cached "$content" "$label" "entire codebase"
  check_content_cached "$content" "$label" "\\\$ARGUMENTS"
  check_content_cached "$content" "$label" "branch point|git diff"

  # Discovery core carried over from improve-codebase
  check_content_cached "$content" "$label" "[Dd]eletion test"
  check_content_cached "$content" "$label" "HTML"
  check_content_cached "$content" "$label" "CONTEXT\.md"

  # The skill is a wrapper: discovery runs in the architecture-reviewer agent
  check_content_cached "$content" "$label" "architecture-reviewer"

  # The pipeline-terminal decision: the user chooses commit vs act on findings
  check_content_cached "$content" "$label" "commit"

  if [[ -f "$REPO_DIR/agents/architecture-reviewer.md" ]]; then
    pass "agents/architecture-reviewer.md exists"
  else
    fail "$label" "agents/architecture-reviewer.md missing (the discovery engine review-code wraps)"
  fi
}

# ---------------------------------------------------------------------------
# 6d. Agent: refactorer engine (one engine, two modes — ADR-0015)
#
# The refactorer agent is the single engine for behavior-preserving change:
# plan mode executes an approved transformation plan; hygiene mode sweeps
# changed files with no plan (it absorbed code-cleaner + refactor-cleaner).
# These assertions pin the two-mode contract so a future edit can't quietly
# drop a mode, a hygiene duty, or the never-commit rule.
# ---------------------------------------------------------------------------

test_agent_refactorer() {
  section "Agent: refactorer engine"
  local file="$REPO_DIR/agents/refactorer.md"
  local label="agents/refactorer.md"
  [[ -f "$file" ]] || { fail "$label" "file not found"; return; }
  local content
  content="$(extract_body "$file")"

  # The two entry modes, switched by input shape
  check_content_cached "$content" "$label" "[Pp]lan [Mm]ode"
  check_content_cached "$content" "$label" "[Hh]ygiene [Mm]ode"
  check_content_cached "$content" "$label" "changed files"

  # Hygiene duties — the union of the two retired cleaners
  check_content_cached "$content" "$label" "[Dd]ead code"
  check_content_cached "$content" "$label" "[Uu]nused import"
  check_content_cached "$content" "$label" "[Uu]nused dependenc"
  check_content_cached "$content" "$label" "[Dd]uplicat"
  check_content_cached "$content" "$label" "[Ss]implif"

  # Risk policy: SAFE applied, CAREFUL/RISKY reported — grep-verified
  check_content_cached "$content" "$label" "SAFE"
  check_content_cached "$content" "$label" "CAREFUL"
  check_content_cached "$content" "$label" "RISKY"
  check_content_cached "$content" "$label" "grep"
  check_content_cached "$content" "$label" "[Rr]eport.*(CAREFUL|RISKY)|(CAREFUL|RISKY).*report"

  # Safety rules shared by both modes
  check_content_cached "$content" "$label" "never commit|NEVER commit|do not commit"
  check_content_cached "$content" "$label" "[Nn]ever change behavior"
}

# ---------------------------------------------------------------------------
# 6e. Retired cleaners stay retired (ADR-0015)
#
# The code-cleaner skill and refactor-cleaner agent were absorbed into the
# refactorer engine's hygiene mode. The component files must not return, and
# no live authoring surface (skills, agents, commands, rules, harness modules,
# README/AGENTS/example) may instruct the model to invoke either retired name.
# Deliberately exempt: docs/features/ and docs/adr/ (historical records),
# CONTEXT.md (its glossary _Avoid_ lists must name the retired vocabulary),
# and this script (the names below are the detector).
# ---------------------------------------------------------------------------

test_retired_cleaners() {
  section "Retired cleaners stay retired"

  if [[ -e "$REPO_DIR/skills/code-cleaner" ]]; then
    fail "retired" "skills/code-cleaner/ still exists (absorbed into refactorer hygiene mode)"
  else
    pass "skills/code-cleaner/ absent"
  fi

  if [[ -e "$REPO_DIR/agents/refactor-cleaner.md" ]]; then
    fail "retired" "agents/refactor-cleaner.md still exists (absorbed into refactorer hygiene mode)"
  else
    pass "agents/refactor-cleaner.md absent"
  fi

  # The prd skill was renamed to specs; the artifact is specs.md/specs.html.
  if [[ -e "$REPO_DIR/skills/prd" || -e "$REPO_DIR/commands/prd.md" ]]; then
    fail "retired" "skills/prd or commands/prd.md still exists (renamed to specs)"
  else
    pass "skills/prd and commands/prd.md absent (renamed to specs)"
  fi

  # The improve-codebase skill was renamed to review-code and became the
  # final step of the /build pipeline (diff-scoped there; whole-codebase or
  # area-scoped standalone).
  if [[ -e "$REPO_DIR/skills/improve-codebase" || -e "$REPO_DIR/commands/improve-codebase.md" ]]; then
    fail "retired" "skills/improve-codebase or commands/improve-codebase.md still exists (renamed to review-code)"
  else
    pass "skills/improve-codebase and commands/improve-codebase.md absent (renamed to review-code)"
  fi
  if [[ -f "$REPO_DIR/skills/review-code/SKILL.md" && -f "$REPO_DIR/commands/review-code.md" ]]; then
    pass "skills/review-code and commands/review-code.md exist"
  else
    fail "retired" "skills/review-code/SKILL.md or commands/review-code.md missing (replacement for improve-codebase)"
  fi

  # The 2026-07 naming pass: short imperative verbs. specs->spec,
  # tasks->todo, implement->code, implement-coach->coach,
  # visual-explainer->visualize, diff-review->visualize-diff.
  # Artifact names (specs.md, tasks.md, diff-review.html) are unchanged.
  local old_name
  for old_name in specs tasks implement implement-coach visual-explainer diff-review; do
    if [[ -e "$REPO_DIR/skills/$old_name" || -e "$REPO_DIR/commands/$old_name.md" ]]; then
      fail "retired" "skills/$old_name or commands/$old_name.md still exists (renamed in the verb naming pass)"
    else
      pass "skills/$old_name and commands/$old_name.md absent (renamed)"
    fi
  done
  local new_name
  for new_name in spec todo code coach visualize visualize-diff; do
    if [[ -f "$REPO_DIR/skills/$new_name/SKILL.md" ]]; then
      pass "skills/$new_name/SKILL.md exists"
    else
      fail "retired" "skills/$new_name/SKILL.md missing (target of the verb naming pass)"
    fi
  done

  # The fact-checker skill became an agent: verification needs no session
  # context, and independence from the session that authored the documents
  # is a feature — the author shouldn't grade its own homework.
  if [[ -e "$REPO_DIR/skills/fact-checker" ]]; then
    fail "retired" "skills/fact-checker still exists (converted to the fact-checker agent)"
  else
    pass "skills/fact-checker absent (converted to agent)"
  fi
  if [[ -f "$REPO_DIR/agents/fact-checker.md" ]]; then
    pass "agents/fact-checker.md exists"
  else
    fail "retired" "agents/fact-checker.md missing (replacement for the fact-checker skill)"
  fi

  # The api-design and frontend-patterns reference skills were converted into
  # consultant agents (api-designer, frontend-architect) wired into the specs
  # phase — their old plan-phase wiring died with the plan format.
  if [[ -e "$REPO_DIR/skills/api-design" || -e "$REPO_DIR/skills/frontend-patterns" ]]; then
    fail "retired" "skills/api-design or skills/frontend-patterns still exists (converted to consultant agents)"
  else
    pass "skills/api-design and skills/frontend-patterns absent (converted to agents)"
  fi
  local consultant
  for consultant in api-designer frontend-architect; do
    if [[ -f "$REPO_DIR/agents/${consultant}.md" ]]; then
      pass "agents/${consultant}.md exists"
    else
      fail "retired" "agents/${consultant}.md missing (replacement for the retired reference skill)"
    fi
  done

  local hits
  hits="$(grep -rlE 'code-cleaner|refactor-cleaner' \
    "$REPO_DIR/skills" "$REPO_DIR/agents" "$REPO_DIR/commands" "$REPO_DIR/rules" \
    "$REPO_DIR/harnesses" \
    "$REPO_DIR/AGENTS.md" "$REPO_DIR/README.md" "$REPO_DIR/example" 2>/dev/null || true)"
  if [[ -n "$hits" ]]; then
    local f
    while read -r f; do
      [[ -z "$f" ]] && continue
      fail "retired" "${f#"$REPO_DIR"/} mentions a retired cleaner name"
    done <<< "$hits"
  else
    pass "no live authoring surface mentions code-cleaner or refactor-cleaner"
  fi
}

# ---------------------------------------------------------------------------
# 6f. Skill: refactor (goal-specificity routing — ADR-0015)
#
# /refactor is the user-facing front-end of the refactorer engine. A specific
# structural goal takes the gated path: plan → explicit approval → plan mode.
# A vague goal ("clean up X") dispatches a hygiene sweep directly — the old
# reject-vague-goals rule is retired. These assertions pin both routes and
# the approval gate on the plan path.
# ---------------------------------------------------------------------------

test_skill_refactor() {
  section "Skill: refactor routing"
  local file="$REPO_DIR/skills/refactor/SKILL.md"
  local label="skills/refactor/SKILL.md"
  [[ -f "$file" ]] || { fail "$label" "file not found"; return; }
  local content
  content="$(gather_skill_content refactor)"

  # Both routes, in glossary vocabulary
  check_content_cached "$content" "$label" "[Dd]irected refactor"
  check_content_cached "$content" "$label" "[Hh]ygiene sweep"
  check_content_cached "$content" "$label" "vague"
  check_content_cached "$content" "$label" "refactorer"
  check_content_cached "$content" "$label" "[Hh]ygiene [Mm]ode"
  check_content_cached "$content" "$label" "[Pp]lan [Mm]ode"

  # The plan path keeps its hard approval gate
  check_content_cached "$content" "$label" "Do NOT proceed without explicit user approval"
  check_content_cached "$content" "$label" "[Tt]ransformation [Pp]lan"
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
  for phase in grill spec todo code coach review-code; do
    check_content_cached "$content" "$label" "$phase"
  done

  local wait_count
  wait_count="$(count_matches "Wait for the user" "$file")"
  if [[ "$wait_count" -ge 2 ]]; then
    pass "$label has 'Wait for the user' >= 2 times"
  else
    fail "$label" "'Wait for the user' appears $wait_count time(s), expected >= 2"
  fi

  check_content_cached "$content" "$label" "visualize"
  check_content_cached "$content" "$label" "diff-review"

  check_content_cached "$content" "$label" "Mandatory Phase Loading"
  check_content_cached "$content" "$label" "At the start of each phase"
  check_content_cached "$content" "$label" "available_skills"
  for phase in grill spec todo code coach review-code; do
    check_content_cached "$content" "$label" "../$phase/SKILL\.md"
  done
}

# ---------------------------------------------------------------------------
# 8. Cross-references
# ---------------------------------------------------------------------------

check_skill_references_phases() {
  for phase in grill spec todo code coach review-code; do
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
  local ve_dir="$REPO_DIR/skills/visualize"
  local cmd_file
  for cmd_file in "$REPO_DIR"/commands/*.md; do
    local cmd_label="commands/$(basename "$cmd_file")"
    local content
    content="$(<"$cmd_file")"
    # Check references/ and templates/ — strip "visual-explainer/" prefix since ve_dir already includes it
    local ve_subpath
    while read -r ve_subpath; do
      [[ -z "$ve_subpath" ]] && continue
      local rel_path="${ve_subpath#visualize/}"
      local target="$ve_dir/$rel_path"
      if [[ -f "$target" ]]; then
        pass "skills/visualize/$rel_path exists"
      else
        fail "cross-ref" "$target not found (referenced from $cmd_label)"
      fi
    done < <(echo "$content" | grep -oE "visualize/(references|templates)/[a-z._-]+" | sort -u || true)
    # Check core.md
    if [[ "$content" =~ visualize/core\.md ]]; then
      if [[ -f "$ve_dir/core.md" ]]; then
        pass "skills/visualize/core.md exists (referenced from $cmd_label)"
      else
        fail "cross-ref" "skills/visualize/core.md not found"
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
# 11a. Rules are advisory-only — TTSR is retired (ADR-0012)
#
# Every command/content guardrail enforcement now lives in the guard core, so
# no rule should carry stream-rule frontmatter (`condition:`/`scope:`). This
# check fails a re-introduced enforcement rule at the pipeline layer instead of
# letting it become a silently omp-only guardrail again. The rulebook
# `description:` shape is validated separately below.
# ---------------------------------------------------------------------------

test_no_ttsr_frontmatter() {
  section "Rules are advisory-only (TTSR retired)"
  local rule_file
  for rule_file in "$REPO_DIR"/rules/*.md; do
    local label="rules/$(basename "$rule_file")"
    local fm
    fm="$(extract_frontmatter "$rule_file")"
    if grep -qE "^(condition|scope):" <<<"$fm"; then
      fail "$label" "carries retired stream-rule frontmatter (condition:/scope:) — enforcement belongs in the guard core (ADR-0012)"
    else
      pass "$label is advisory (no condition:/scope:)"
    fi
  done
}

test_pi_bundle_current() {
  section "pi guard extension bundle is current"
  local committed="$REPO_DIR/harnesses/pi/guard-policies.bundle.ts"
  if [[ ! -f "$committed" ]]; then
    fail "harnesses/pi/guard-policies.bundle.ts" "missing — run 'make bundle'"
    return
  fi
  # The bundle is what pi actually loads (it can't resolve a symlinked
  # adapter's relative imports), so it must stay in sync with the adapter +
  # guard core. bun pins deterministically via mise, so a byte-diff is stable.
  if ! command -v bun >/dev/null 2>&1; then
    pass "guard bundle present (bun unavailable here; rebuild comparison skipped)"
    return
  fi
  local tmp
  tmp="$(mktemp --suffix=.ts)"
  if bun build "$REPO_DIR/harnesses/pi/extensions/guard-policies.ts" --target=bun --outfile "$tmp" >/dev/null 2>&1 \
     && diff -q "$tmp" "$committed" >/dev/null 2>&1; then
    pass "harnesses/pi/guard-policies.bundle.ts matches the adapter + guard core"
  else
    fail "harnesses/pi/guard-policies.bundle.ts" "stale — adapter/guard-core changed without rebuild; run 'make bundle'"
  fi
  rm -f "$tmp"
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
  check_stale_in_dir "$REPO_DIR/skills/visualize/references" "skills/visualize/references"
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
  # pi is the third owned config root: it must not link into a sibling module,
  # and no sibling root may link into the pi module.
  local sibling
  for sibling in harnesses/omp harnesses/claude; do
    if root_leaks_into_module "$tmphome/.pi/agent" "$sibling"; then
      fail "isolation" "~/.pi/agent contains a symlink into the $sibling module"
    else
      pass "isolation: pi root has no symlink into the $sibling module"
    fi
  done
  if root_leaks_into_module "$tmphome/.omp/agent" "harnesses/pi"; then
    fail "isolation" "~/.omp/agent contains a symlink into the harnesses/pi module"
  else
    pass "isolation: oh-my-pi root has no symlink into the harnesses/pi module"
  fi
  if root_leaks_into_module "$tmphome/.claude" "harnesses/pi"; then
    fail "isolation" "~/.claude contains a symlink into the harnesses/pi module"
  else
    pass "isolation: claude root has no symlink into the harnesses/pi module"
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
  [[ -e "$tmphome/.pi/agent/settings.json" ]] && pass "pi module installed (settings.json)" \
    || fail "install-behavior" "pi settings.json missing"
  [[ -e "$tmphome/.pi/agent/extensions/guard-policies.ts" ]] && pass "pi guard extension installed" \
    || fail "install-behavior" "pi guard extension missing"
  # pi does not realpath-resolve symlinked extensions, so the installed adapter
  # must be a self-contained bundle — no leftover relative imports it can't find.
  if [[ -f "$tmphome/.pi/agent/extensions/guard-policies.ts" ]] \
     && ! grep -qE 'from[[:space:]]*["'\''][.][.]?/' "$tmphome/.pi/agent/extensions/guard-policies.ts"; then
    pass "pi guard extension is self-contained (bundled, no relative imports)"
  else
    fail "install-behavior" "pi guard extension has relative imports pi can't resolve (must be bundled)"
  fi
  [[ -d "$tmphome/.pi/agent/rules" ]] && pass "pi has rules/ dir with on-demand rule files" \
    || fail "install-behavior" "pi rules/ directory missing — expected after switching to on-demand rules"
  for rule_file in coding-style testing security performance git-commit mise; do
    [[ -f "$tmphome/.pi/agent/rules/$rule_file.md" ]] && pass "pi rules/$rule_file.md present" \
      || fail "install-behavior" "pi rules/$rule_file.md missing"
  done
  [[ -f "$tmphome/.pi/agent/extensions/subagent/index.ts" ]] && pass "pi subagent extension index.ts installed" \
    || fail "install-behavior" "pi subagent extension index.ts missing"
  [[ -f "$tmphome/.pi/agent/extensions/subagent/agents.ts" ]] && pass "pi subagent extension agents.ts installed" \
    || fail "install-behavior" "pi subagent extension agents.ts missing"

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
  run test_phase_spec
  run test_phase_todo
  run test_phase_code
  run test_phase_coach
  run test_phase_coach_holding_line
  run test_phase_review_code
  run test_agent_refactorer
  run test_retired_cleaners
  run test_skill_refactor
  run test_phase_orchestrator
  run test_cross_references
  run test_agent_rule_deps
  run test_symlink_targets
  run test_guide_skill_sync
  run test_no_ttsr_frontmatter
  run test_rulebook_rule_frontmatter
  run test_pi_bundle_current
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
