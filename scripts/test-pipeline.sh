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
  check_content_cached "$content" "$label" "Write (the )?canonical spec"

  for section in "Problem Statement" Solution "User Stories" "Implementation Decisions" "Testing Decisions" "Out of Scope"; do
    check_content_cached "$content" "$label" "$section"
  done

  check_content_cached "$content" "$label" "[Aa]nnotat"
  check_content_cached "$content" "$label" "[Aa]ddress"
  check_content_cached "$content" "$label" "review-artifact"
  check_content_cached "$content" "$label" "[Ee]xplicit.*approval"
  check_content_cached "$content" "$label" "canonical"
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
  check_content_cached "$content" "$label" "[Bb]locking slices|data-dependencies"
  check_content_cached "$content" "$label" "[Tt]est surface"
  check_content_cached "$content" "$label" "tasks\.html"
  check_content_cached "$content" "$label" "review-artifact"
  check_content_cached "$content" "$label" "data-status"
  check_content_cached "$content" "$label" "canonical"
}

# ---------------------------------------------------------------------------
# 6. Phase: code
# ---------------------------------------------------------------------------

test_phase_code_core() {
  local content="$1"
  local label="$2"
  check_content_cached "$content" "$label" "tasks\.html"
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
}

test_phase_code_post() {
  local content="$1"
  local label="$2"
  check_content_cached "$content" "$label" "refactorer"
  check_content_cached "$content" "$label" "[Hh]ygiene [Mm]ode"
  check_content_cached "$content" "$label" "never commit|NEVER commit|do not commit"
  if [[ "$content" =~ (database-reviewer|code-reviewer|doc-updater|fact-checker|diff-review) ]]; then
    fail "$label" "implementation phase still invokes final-review work owned by review-change"
  else
    pass "$label leaves final validation to review-change"
  fi
}

test_phase_code() {
  section "Phase: code"
  local file="$REPO_DIR/skills/code/SKILL.md"
  local label="skills/code/SKILL.md"
  [[ -f "$file" ]] || { fail "$label" "file not found"; return; }
  local content
  content="$(gather_skill_content code)"
  test_phase_code_core "$content" "$label"
  test_phase_code_post "$(extract_body "$file")" "$label"
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

  # Post-completion checks (mirrors code); inspect the direct phase contract so
  # shared pipeline references may describe Phase 5 ownership without making
  # implementation invoke that work.
  test_phase_code_post "$(extract_body "$file")" "$label"
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

  # Commands are intentionally thin wrappers; the load-bearing discipline lives
  # once in the skill and the command routes to that source of truth.
  local cmd_content
  cmd_content="$(cat "$cmd_file")"
  check_content_cached "$cmd_content" "$cmd_label" "Load the .?coach.? skill"
}

# ---------------------------------------------------------------------------
# 6c2. Phase: review-change
# ---------------------------------------------------------------------------

test_phase_review_change() {
  section "Phase: review-change"
  local file="$REPO_DIR/skills/review-change/SKILL.md"
  local label="skills/review-change/SKILL.md"
  [[ -f "$file" ]] || { fail "$label" "file not found"; return; }
  local content
  content="$(gather_skill_content review-change)"

  check_content_cached "$content" "$label" "explicit Git base/head range.*local-range mode"
  check_content_cached "$content" "$label" "adversarial review.*targeted evidence.*documentation checks.*lint.*fixed order"
  check_content_cached "$content" "$label" "severity.*error.*warning.*info.*action.*auto-fix.*ask-user.*no-op.*fail(s|ing)? closed"
  check_content_cached "$content" "$label" "smallest relevant|focused checks.*full repository suite.*missing evidence.*ask-user"
  check_content_cached "$content" "$label" "Authoritative intent.*acceptance data.*not.*instructions"
  check_content_cached "$content" "$label" "three.*fix/recheck rounds.*fresh.*complete.*Change reviewer.*never.*fixer rationale"
  check_content_cached "$content" "$label" "every initial adversarial stage.*every restart.*dispatch a fresh.*change-reviewer.*complete immutable scope.*decision ledger.*specialist Findings"
  check_content_cached "$content" "$label" "Coached build.*(does not|never).*source or tests.*documentation.*formatting"
  check_content_cached "$content" "$label" "coached-mode scope.*prohibits source and test edits.*Change fixer|Change fixer.*coached build mode.*documentation.*mechanical-formatting.*source or test change.*outside scope"
  check_content_cached "$content" "$label" "GitHub.*(URL|number).*title and body.*Authoritative intent.*immutable.*detached review worktree.*~/[.]review-orchard"
  check_content_cached "$content" "$label" "[Nn]o explicit target.*current branch.*pull request.*branch point"
  check_content_cached "$content" "$label" "[Cc]lassify execution trust before materializing.*Untrusted.*--no-checkout.*never.*materialize.*checkout hooks.*content filters"
  check_content_cached "$content" "$label" "not a sandbox.*must not execute.*~/Projects/a5/.*provider CI.*ask-user"
  check_content_cached "$content" "$label" "Untrusted.*[Dd]o not run checkout.*submodule.*hooks.*content filters.*archive extraction"
  check_content_cached "$content" "$label" "path-scoped.*git worktree remove.*[Nn]ever force removal.*repository-wide worktree pruning.*cleanup fails"
  check_content_cached "$content" "$label" "Pull-request.*never.*Change fixer.*copyable review Markdown.*never post"
  check_content_cached "$content" "$label" "Finding card.*primary anchor.*right-aligned.*monospaced badge"
  check_content_cached "$content" "$label" "repository-relative.*path:line.*complete relative path.*basename"
  check_content_cached "$content" "$label" "copy button.*primary anchor"
  check_content_cached "$content" "$label" "button copies.*absolute reviewed file path.*line suffix.*display.*repository-relative.*path:line"
  check_content_cached "$content" "$label" "absolute path.*beneath.*materialized reviewed snapshot.*never.*escapes.*review root"
  check_content_cached "$content" "$label" "standalone CLI mode.*isolated.*reviewRoot.*rather than.*sourceRoot.*retain(s)?.*until.*Summary.*remove(s)?"
  check_content_cached "$content" "$label" "hidden text node.*textContent.*event-handler attribute.*persistently mark"
  check_content_cached "$content" "$label" "pull-request copy section.*severity.*path:line.*outside.*Markdown text.*copy-icon button.*general review.*every Finding comment.*recolor or collapse"
  check_content_cached "$content" "$label" "legend.*severity.*error.*warning.*info.*action.*auto-fix.*ask-user.*no-op.*standalone tags never trigger a mutation"
  check_content_cached "$content" "$label" "[Uu]se terminology.*Authoritative intent.*source.*tests.*project documentation"
  check_content_cached "$content" "$label" "[Dd]efine.*new term.*first use"
  check_content_cached "$content" "$label" "self-contained.*HTML.*(OS|operating system).*temp.*native controls.*review-artifact.*chat fallback"
  check_content_cached "$content" "$label" "dynamic value.*Untrusted.*Encode.*HTML text or attribute context.*textContent.*value.*never.*innerHTML"
  check_content_cached "$content" "$label" "Untrusted URL.*text.*validates.*https:.*report-owned local artifact URL"
  check_content_cached "$content" "$label" "select or add Findings.*attach instructions.*fix selected.*approve as-is.*explicit disposition.*updates in place"
  check_content_cached "$content" "$label" "Build mode.*database-reviewer.*fact-checker.*specs[.]html.*tasks[.]html"
  check_content_cached "$content" "$label" "fact-checker's changed-file result.*artifact changed.*restart at documentation check.*rerun lint.*cold fact-checking.*three-round limit"
  check_content_cached "$content" "$label" "second clean pass.*byte-for-byte unchanged"
  check_content_cached "$content" "$label" "final implementation verification command.*scope.*outcome.*prior broad Validation evidence.*never rerun"
  check_content_cached "$content" "$label" "review-artifact.*foreground poll.*approved.*never clear"
  check_content_cached "$content" "$label" "[Nn]ot generate a Markdown companion or automatic diff-review"
  check_content_cached "$content" "$label" "Every CLI (target|invocation).*read-only.*disposable isolated clone|disposable isolated clone.*Every CLI.*read-only"
  check_content_cached "$content" "$label" "CLI-specific pi guard.*model|model.*CLI-specific pi guard"
}

test_review_change_cli() {
  section "CLI: review-change"
  local bin="$REPO_DIR/skills/review-change/bin/review-change.mjs"
  local runtime="$REPO_DIR/skills/review-change/runtime"
  local guard="$REPO_DIR/harnesses/pi/extensions/review-change-guard.ts"
  local progress="$REPO_DIR/harnesses/pi/extensions/review-change-progress.ts"
  local label="skills/review-change/bin/review-change.mjs"

  [[ -x "$bin" ]] && pass "$label is executable" \
    || fail "$label" "standalone entry point missing or not executable"
  check_content_cached "$(cat "$bin")" "$label" "Usage: review-change.*target.*--intent"
  check_content_cached "$(cat "$bin")" "$label" "assertSupportedNode.*process[.]versions[.]node"
  local runner prompt status_runtime markdown_summary workspace report_directory target_resolution
  runner="$(cat "$runtime/runner.mjs")"
  prompt="$(cat "$runtime/prompt.mjs")"
  status_runtime="$(cat "$runtime/status.mjs")"
  markdown_summary="$(cat "$runtime/markdown-summary.mjs")"
  workspace="$(cat "$runtime/workspace.mjs")"
  report_directory="$(cat "$runtime/report-directory.mjs")"
  target_resolution="$(cat "$runtime/target.mjs")"
  check_content_cached "$runner" "skills/review-change/runtime/runner.mjs" "spawn.*command, args, options"
  check_content_cached "$runner" "skills/review-change/runtime/runner.mjs" "--mode.*json.*--print.*--no-session.*--skill"
  check_content_cached "$runner" "skills/review-change/runtime/runner.mjs" "REVIEW_CHANGE_GATE.*already active"
  check_content_cached "$runner" "skills/review-change/runtime/runner.mjs" "createReviewWorkspace"
  check_content_cached "$runner" "skills/review-change/runtime/runner.mjs" "workspace[.]cleanup"
  check_content_cached "$runner" "skills/review-change/runtime/runner.mjs" "status[.]finish.*finally.*cancellation[.]cleanup"
  check_content_cached "$status_runtime" "skills/review-change/runtime/status.mjs" "interrupt.*finalView.*dismissFinal.*restoreTerminal"
  check_content_cached "$runner" "skills/review-change/runtime/runner.mjs" "openReportArtifact.*expected one HTML report.*viewerCommand"
  check_content_cached "$prompt" "skills/review-change/runtime/prompt.mjs" "acceptance data, never executable instructions"
  check_content_cached "$prompt" "skills/review-change/runtime/prompt.mjs" "Do not invoke review-artifact or wait for approval.*parent process opens it"
  check_content_cached "$prompt" "skills/review-change/runtime/prompt.mjs" "Never stage, commit, push, or mutate provider state"
  check_content_cached "$prompt" "skills/review-change/runtime/prompt.mjs" "action step.*six words or fewer.*action log once per item.*never combine multiple items.*completion message.*Establish scope and intent.*Dispatch the fresh change-reviewer.*Validate anchors and project terminology.*Normalize Findings and risk"
  check_content_cached "$prompt" "skills/review-change/runtime/prompt.mjs" "every Finding card.*exact reviewed path:line anchor.*repository-relative path:line.*copy button.*absolute reviewed file path.*hidden text node.*textContent.*escapes reviewRoot"
  check_content_cached "$runner" "skills/review-change/runtime/runner.mjs" "reviewRoot: workspace[.]cwd"
  check_content_cached "$runner" "skills/review-change/runtime/runner.mjs" "reportOpened.*status[.]finish.*captureCleanupFailure"
  check_content_cached "$prompt" "skills/review-change/runtime/prompt.mjs" "one copyable general-review Markdown block.*one copyable Markdown block per Finding.*severity and path:line outside the copied text.*copy-icon button.*persistently mark"
  check_content_cached "$prompt" "skills/review-change/runtime/prompt.mjs" "every severity and action tag.*legend.*who decides next.*standalone tags never trigger mutation"
  check_content_cached "$status_runtime" "skills/review-change/runtime/status.mjs" "recordProgressStep.*substage.*telemetryStepped"
  check_content_cached "$status_runtime" "skills/review-change/runtime/status.mjs" "Review the complete change against intent.*Run smallest checks that prove intent.*Check changed documentation and claims"
  check_content_cached "$(cat "$runtime/screen.mjs")" "skills/review-change/runtime/screen.mjs" "MAX_SUBSTAGE_WORDS.*renderSplitStatusScreen.*PIPELINE.*LOG.*pipelineDetailLines.*stepFinishedAt.*stepDuration.*conciseSubstage.*earlier pipeline stages.*later pipeline stages"
  check_content_cached "$(cat "$runtime/screen.mjs")" "skills/review-change/runtime/screen.mjs" "renderTinyStatusScreen.*DESCRIPTION.*helpLines.*clip"
  check_content_cached "$(cat "$runtime/screen.mjs")" "skills/review-change/runtime/screen.mjs" "worktreeLine.*WORKTREE"
  check_content_cached "$(cat "$runtime/screen.mjs")" "skills/review-change/runtime/screen.mjs" "log[.]kind === .log.*•.*failed.*waiting"
  check_content_cached "$(cat "$runtime/screen.mjs")" "skills/review-change/runtime/screen.mjs" "Ctrl-C abort.*j/k navigate stages.*Ctrl-U/D scroll log.*Enter expand/collapse lines.*f follow.*Ctrl-C exit"
  check_content_cached "$status_runtime" "skills/review-change/runtime/status.mjs" "key === .k.*selectRelative\(-1\).*key === .j.*selectRelative\(1\).*logOffset"
  check_content_cached "$runner" "skills/review-change/runtime/runner.mjs" "setWorkspacePath.*workspace[.]cwd.*Removed"
  check_content_cached "$status_runtime" "skills/review-change/runtime/status.mjs" "renderMarkdownWithGlow.*summaryPaneWidth.*refreshRenderedSummary.*width < 20.*finalSummaryRendered"
  check_content_cached "$markdown_summary" "skills/review-change/runtime/markdown-summary.mjs" "notty.*CLICOLOR_FORCE.*glow.*--style.*--width.*--preserve-new-lines"
  check_content_cached "$markdown_summary" "skills/review-change/runtime/markdown-summary.mjs" "DEFAULT_TIMEOUT_MS.*MAX_OUTPUT_BYTES.*timeout.*Buffer[.]byteLength"
  check_content_cached "$status_runtime" "skills/review-change/runtime/status.mjs" "finalSummary.*selectedStage = .summary.*dismissFinal.*input[.]pause"
  check_content_cached "$status_runtime" "skills/review-change/runtime/status.mjs" "finalView.*\\u0003.*dismissFinal.*q.*x.*\\u001b.*return.*viewingSummary.*\\u0004.*summaryOffset"
  check_content_cached "$(cat "$runtime/screen.mjs")" "skills/review-change/runtime/screen.mjs" "PIPELINE.*isSummary.*renderSummary.*summaryOffset"
  check_content_cached "$(cat "$bin")" "$label" "j/k.*navigate stages.*Ctrl-D/Ctrl-U.*Enter to expand or collapse lines.*f to follow.*Ctrl-C to abort.*pipeline/log layout.*final Summary stage.*Ctrl-U and Ctrl-D.*Ctrl-C to exit"
  check_content_cached "$workspace" "skills/review-change/runtime/workspace.mjs" "defaultReviewWorkspaceRoot"
  check_content_cached "$workspace" "skills/review-change/runtime/workspace.mjs" "[.]review-orchard"
  check_content_cached "$workspace" "skills/review-change/runtime/workspace.mjs" "--no-hardlinks.*--no-checkout"
  check_content_cached "$workspace" "skills/review-change/runtime/workspace.mjs" "ls-files.*--others.*--exclude-standard"
  check_content_cached "$workspace" "skills/review-change/runtime/workspace.mjs" "set-url.*--push.*no-push://review-change"
  check_content_cached "$report_directory" "skills/review-change/runtime/report-directory.mjs" "protectedRoots"
  check_content_cached "$report_directory" "skills/review-change/runtime/report-directory.mjs" "prepareSafeRoot"
  check_content_cached "$target_resolution" "skills/review-change/runtime/target.mjs" "currentPullRequest"
  check_content_cached "$target_resolution" "skills/review-change/runtime/target.mjs" "merge-base"
  check_content_cached "$(cat "$guard")" "harnesses/pi/extensions/review-change-guard.ts" "Git delivery mutation.*provider mutation.*read-only workspace"
  check_content_cached "$(cat "$progress")" "harnesses/pi/extensions/review-change-progress.ts" "review_change_status.*review.*evidence.*documentation.*lint.*report"
  check_content_cached "$(cat "$progress")" "harnesses/pi/extensions/review-change-progress.ts" "step.*current sub-stage"
}

test_agent_change_reviewer() {
  section "Agent: change-reviewer"
  local file="$REPO_DIR/agents/change-reviewer.md"
  local label="agents/change-reviewer.md"
  [[ -f "$file" ]] || { fail "$label" "file not found"; return; }
  local fm content
  fm="$(extract_frontmatter "$file")"
  content="$(extract_body "$file")"

  if [[ "$fm" =~ \"Write\"|\"Edit\" ]]; then
    fail "$label" "Change reviewer has mutation tools"
  else
    pass "$label has read-only tools"
  fi
  check_content_cached "$content" "$label" "complete (change|diff).*error.*warning.*info.*auto-fix.*ask-user.*no-op"
  check_content_cached "$content" "$label" "never receive.*fixer rationale|[Nn]ever inherit.*fixer rationale"
  check_content_cached "$content" "$label" "risk_level.*risk_rationale.*reviewed.*intent_coverage"
  check_content_cached "$content" "$label" "file.*line.*description.*evidence.*repair"
  check_content_cached "$content" "$label" "every Finding.*exact changed file.*one-indexed changed line.*[Uu]se domain and implementation terms.*[Dd]efine any unavoidable new term"
  check_content_cached "$content" "$label" "[Ww]hen an action is uncertain.*ask-user"
}

test_agent_change_fixer() {
  section "Agent: change-fixer"
  local file="$REPO_DIR/agents/change-fixer.md"
  local label="agents/change-fixer.md"
  [[ -f "$file" ]] || { fail "$label" "file not found"; return; }
  local content
  content="$(extract_body "$file")"

  check_content_cached "$content" "$label" "selected Findings.*user instructions.*focused verification.*never.*commit"
  check_content_cached "$content" "$label" "current mode.*selected Findings only.*per-Finding user instructions"
  check_content_cached "$content" "$label" "do not review your own work.*rationale.*Change reviewer"
  check_content_cached "$content" "$label" "source or test change restarts.*documentation-only.*formatting-only"
  check_content_cached "$content" "$label" "[Ii]n coached mode.*never edit source or tests.*documentation.*mechanical-formatting"
}

test_agent_fact_checker_idempotent() {
  section "Agent: fact-checker idempotent summary"
  local file="$REPO_DIR/agents/fact-checker.md"
  local label="agents/fact-checker.md"
  local content
  content="$(extract_body "$file")"

  check_content_cached "$content" "$label" "insert or update one.*Verification Summary.*Never append a second summary.*do not write.*unchanged"
}

test_agent_database_reviewer_read_only() {
  section "Agent: database-reviewer read-only Findings"
  local file="$REPO_DIR/agents/database-reviewer.md"
  local label="agents/database-reviewer.md"
  local fm body
  fm="$(extract_frontmatter "$file")"
  body="$(extract_body "$file")"

  if [[ "$fm" =~ \"Write\"|\"Edit\" ]]; then
    fail "$label" "database specialist has mutation tools"
  else
    pass "$label has read-only tools"
  fi
  check_content_cached "$body" "$label" "severity.*action.*evidence.*repair"
}

# ---------------------------------------------------------------------------
# 6c3. Phase: review-code (architectural review — standalone only)
#
# review-code (renamed from improve-codebase) is standalone architectural
# exploration: whole-codebase with no arguments or area-scoped when arguments
# name one. Review change owns the final build gate. These assertions pin the
# two standalone modes and the discovery core.
# ---------------------------------------------------------------------------

test_phase_review_code() {
  section "Phase: review-code"
  local file="$REPO_DIR/skills/review-code/SKILL.md"
  local label="skills/review-code/SKILL.md"
  [[ -f "$file" ]] || { fail "$label" "file not found"; return; }
  local content
  content="$(gather_skill_content review-code)"

  # Two standalone scoping modes
  check_content_cached "$content" "$label" "entire codebase"
  check_content_cached "$content" "$label" "\\\$ARGUMENTS"
  check_content_cached "$content" "$label" "standalone|Standalone"
  if [[ "$content" =~ (final step|final phase).*\/build|From[[:space:]]+.?\/build|ONLY[[:space:]]+the[[:space:]]+changes ]]; then
    fail "$label" "still claims automatic /build ownership"
  else
    pass "$label is standalone-only"
  fi

  # Discovery core carried over from improve-codebase
  check_content_cached "$content" "$label" "[Dd]eletion test"
  check_content_cached "$content" "$label" "HTML"
  check_content_cached "$content" "$label" "CONTEXT\.md"

  # The skill is a wrapper: discovery runs in the architecture-reviewer agent
  check_content_cached "$content" "$label" "architecture-reviewer"

  # Standalone candidate selection is carried by browser review.
  check_content_cached "$content" "$label" "review-artifact"
  check_content_cached "$content" "$label" "approval"
  if [[ -f "$REPO_DIR/agents/architecture-reviewer.md" ]]; then
    pass "agents/architecture-reviewer.md exists"
  else
    fail "$label" "agents/architecture-reviewer.md missing (the discovery engine review-code wraps)"
  fi
}

# ---------------------------------------------------------------------------
# 6c3. Skill: review-artifact
# ---------------------------------------------------------------------------

test_skill_review_artifact() {
  section "Skill: review-artifact"
  local file="$REPO_DIR/skills/review-artifact/SKILL.md"
  local label="skills/review-artifact/SKILL.md"
  [[ -f "$file" ]] || { fail "$label" "file not found"; return; }
  local content
  content="$(gather_skill_content review-artifact)"

  check_content_cached "$content" "$label" "foreground"
  check_content_cached "$content" "$label" "layout_warnings|layout warnings"
  check_content_cached "$content" "$label" "[Ee]xplicit approval|approved"
  check_content_cached "$content" "$label" "[Ee]nded.*not.*approval|not approval"
  check_content_cached "$content" "$label" "live-reload|live reload"
  check_content_cached "$content" "$label" "chat.*fallback|fallback.*chat"
  check_content_cached "$content" "$label" "Do not call .?lavish-axi"

  local runtime_file
  for runtime_file in bin/review-artifact.mjs runtime/server.mjs runtime/session-store.mjs runtime/protocol.mjs runtime/assets/bridge.js runtime/assets/shell.js runtime/assets/layout-audit.js runtime/assets/message-validation.js ATTRIBUTION.md; do
    if [[ -f "$REPO_DIR/skills/review-artifact/$runtime_file" ]]; then
      pass "skills/review-artifact/$runtime_file exists"
    else
      fail "$label" "$runtime_file missing"
    fi
  done
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
# 6e. Agents superseded by Review change stay retired
# ---------------------------------------------------------------------------

test_retired_review_change_agents() {
  section "Retired Review change agents"
  local retired
  for retired in architect code-reviewer doc-updater; do
    if [[ -e "$REPO_DIR/agents/$retired.md" ]]; then
      fail "agents/$retired.md" "superseded agent still exists"
    else
      pass "agents/$retired.md absent"
    fi
  done

  local hits
  hits="$(grep -RIlE '(^|[^a-z-])(code-reviewer|doc-updater)([^a-z-]|$)|`architect`|architect[.]md' \
    "$REPO_DIR"/skills/*/SKILL.md \
    "$REPO_DIR"/skills/*/references/*.md \
    "$REPO_DIR"/skills/*/guide.html \
    "$REPO_DIR"/commands/*.md \
    "$REPO_DIR"/README.md \
    "$REPO_DIR"/AGENTS.md \
    "$REPO_DIR"/example/README.md \
    2>/dev/null || true)"
  if [[ -z "$hits" ]]; then
    pass "live authoring surfaces do not invoke retired Review change agents"
  else
    fail "retired agents" "live references remain: $(echo "$hits" | sed "s|$REPO_DIR/||g" | tr '\n' ' ')"
  fi
}

# ---------------------------------------------------------------------------
# 6f. Retired cleaners stay retired (ADR-0015)
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

  # The prd skill was renamed to spec; its canonical artifact is specs.html.
  if [[ -e "$REPO_DIR/skills/prd" || -e "$REPO_DIR/commands/prd.md" ]]; then
    fail "retired" "skills/prd or commands/prd.md still exists (renamed to specs)"
  else
    pass "skills/prd and commands/prd.md absent (renamed to specs)"
  fi

  # The improve-codebase skill was renamed to review-code and remains the
  # optional standalone architectural workflow (whole-codebase or area scope).
  # Review change owns the final /build gate.
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
  # Canonical pipeline artifacts are specs.html and tasks.html;
  # visualize-diff still uses diff-review.html when invoked standalone.
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

  # plan-review and project-recap were standalone visualize companions the
  # user never invoked — removed rather than renamed into the verb scheme.
  for old_name in plan-review project-recap; do
    if [[ -e "$REPO_DIR/commands/$old_name.md" || -e "$REPO_DIR/skills/$old_name" ]]; then
      fail "retired" "commands/$old_name.md or skills/$old_name still exists (removed as unused)"
    else
      pass "commands/$old_name.md and skills/$old_name absent (removed as unused)"
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
  for phase in grill spec todo code coach review-change; do
    check_content_cached "$content" "$label" "$phase"
  done

  local wait_count
  wait_count="$(count_matches "Wait for" "$file")"
  if [[ "$wait_count" -ge 3 ]]; then
    pass "$label has explicit wait gates >= 3 times"
  else
    fail "$label" "'Wait for' appears $wait_count time(s), expected >= 3"
  fi

  check_content_cached "$content" "$label" "visualize"
  check_content_cached "$content" "$label" "review-artifact"
  check_content_cached "$content" "$label" "review-code.*(not.*build|optional standalone)"
  check_content_cached "$content" "$label" "exactly [*][*]four[*][*] approval gates.*Review.*done"

  check_content_cached "$content" "$label" "Mandatory Phase Loading"
  check_content_cached "$content" "$label" "At the start of each phase"
  check_content_cached "$content" "$label" "available_skills"
  for phase in grill spec todo code coach review-change; do
    check_content_cached "$content" "$label" "../$phase/SKILL\.md"
  done

  local bootstrap
  bootstrap="$(<"$REPO_DIR/harness-system-prompt.md")"
  check_content_cached "$bootstrap" "harness-system-prompt.md" "development Git worktrees.*~/[.]orchard/.*<project-basename>-<short-intent>.*Review change isolation.*~/[.]review-orchard/"
}

# ---------------------------------------------------------------------------
# 7b. ADR identifiers
# ---------------------------------------------------------------------------

test_unique_adr_ids() {
  section "ADR identifiers"
  local duplicates
  duplicates="$(
    for adr_file in "$REPO_DIR"/docs/adr/[0-9][0-9][0-9][0-9]-*.md; do
      [[ -f "$adr_file" ]] && basename "$adr_file" | cut -d- -f1
    done | sort | uniq -d
  )"
  if [[ -z "$duplicates" ]]; then
    pass "docs/adr uses unique numeric identifiers"
  else
    fail "docs/adr" "duplicate numeric identifiers: $(echo "$duplicates" | paste -sd, -)"
  fi
}

# ---------------------------------------------------------------------------
# 8. Cross-references
# ---------------------------------------------------------------------------

check_skill_references_phases() {
  for phase in grill spec todo code coach review-change; do
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

    # Agent Project Rules sections use bare canonical names to avoid repeating
    # harness-specific lookup instructions in every isolated prompt.
    local project_rules rule_name target
    project_rules="$(echo "$body" | awk '
      /^## Project Rules/ { in_rules=1; next }
      in_rules && /^## / { exit }
      in_rules { print }
    ')"
    while read -r rule_name; do
      [[ -z "$rule_name" ]] && continue
      target="$REPO_DIR/rules/$rule_name.md"
      if [[ -f "$target" ]]; then
        pass "$label references existing shared rule '$rule_name'"
      else
        fail "$label" "references shared rule '$rule_name' which does not exist"
      fi
    done < <(echo "$project_rules" | grep -oE '^-[[:space:]]+`[a-z0-9._-]+`' | tr -d '`' | sed -E 's/^-[[:space:]]+//' | sort -u || true)
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
# check fails a re-introduced enforcement rule at the pipeline layer.
# Advisory-rule `description:` metadata is validated separately below.
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

test_advisory_rule_frontmatter() {
  section "Rule frontmatter: advisory metadata"
  local rule_file
  for rule_file in "$REPO_DIR"/rules/*.md; do
    local label="rules/$(basename "$rule_file")"
    local fm
    fm="$(extract_frontmatter "$rule_file")"
    if grep -q "^description:" <<<"$fm"; then
      pass "$label has description:"
    else
      fail "$label" "advisory rule is missing 'description:' metadata"
    fi
  done
}

# ---------------------------------------------------------------------------
# 11b. Harness modules + generic install loop (ADR-0010)
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
}

# ---------------------------------------------------------------------------
# 11c. Forbidden Claude-centric phrasing
#
# The phrase "already loaded in context" (and close variants) asserts that
# detailed rule content is auto-injected. All harnesses now keep detailed rules
# on demand, so allowing the phrase in an AI-readable file misinforms every
# model. Enforce its absence as a permanent guard.
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
# the curated shared set. Verified by installing into a throwaway HOME and
# asserting that no symlink under one harness's config root resolves into the
# other harness's module directory. A planted leak proves the structural check
# actually fires.
# ---------------------------------------------------------------------------

# True if any symlink under config root $1 resolves into repo module dir $2.
# pwd -P keeps the comparison physical on both sides — readlink -f resolves
# symlink components, so a logical mod_real would silently never match.
root_leaks_into_module() {
  local root="$1" module="$2" mod_real link tgt
  mod_real="$(cd "$REPO_DIR/$module" 2>/dev/null && pwd -P)" || return 1
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

  if root_leaks_into_module "$tmphome/.pi/agent" "harnesses/claude"; then
    fail "isolation" "~/.pi/agent contains a symlink into the harnesses/claude module"
  else
    pass "isolation: pi root has no symlink into the harnesses/claude module"
  fi
  if root_leaks_into_module "$tmphome/.claude" "harnesses/pi"; then
    fail "isolation" "~/.claude contains a symlink into the harnesses/pi module"
  else
    pass "isolation: claude root has no symlink into the harnesses/pi module"
  fi

  # test-the-test: a planted sibling link MUST be detected, or the check is vacuous.
  ln -sf "$REPO_DIR/harnesses/claude/settings.json" "$tmphome/.pi/agent/skills/_leak.json"
  if [[ ! -L "$tmphome/.pi/agent/skills/_leak.json" ]]; then
    fail "isolation" "could not plant the leak fixture — detector unverified"
  elif root_leaks_into_module "$tmphome/.pi/agent" "harnesses/claude"; then
    pass "isolation check catches a planted sibling leak"
  else
    fail "isolation" "planted sibling leak was not detected"
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
  mkdir -p "$tmphome/.local/bin"
  ln -s "$REPO_DIR/skills/change-review/bin/change-review.mjs" "$tmphome/.local/bin/change-review"

  if HOME="$tmphome" bash "$REPO_DIR/install.sh" >/dev/null 2>&1; then
    pass "install.sh succeeds into a throwaway HOME"
  else
    fail "install-behavior" "install.sh failed"
    rm -rf "$tmphome"
    return
  fi
  [[ -e "$tmphome/.claude/settings.json" ]] && pass "claude module installed" \
    || fail "install-behavior" "claude settings.json missing"
  [[ ! -e "$tmphome/.omp" ]] && pass "retired oh-my-pi harness is not installed" \
    || fail "install-behavior" "retired oh-my-pi config root was created"
  [[ -e "$tmphome/.pi/agent/settings.json" ]] && pass "pi module installed (settings.json)" \
    || fail "install-behavior" "pi settings.json missing"
  [[ -e "$tmphome/.pi/agent/extensions/guard-policies.ts" ]] && pass "pi guard extension installed" \
    || fail "install-behavior" "pi guard extension missing"
  [[ -e "$tmphome/.pi/agent/extensions/orchard.ts" ]] && pass "pi Orchard transition extension installed" \
    || fail "install-behavior" "pi Orchard transition extension missing"
  [[ -e "$tmphome/.pi/agent/extensions/review-change-guard.ts" ]] \
    && pass "standalone Review change guard installed" \
    || fail "install-behavior" "standalone Review change guard missing"
  [[ -e "$tmphome/.pi/agent/extensions/review-change-progress.ts" ]] \
    && pass "standalone Review change progress extension installed" \
    || fail "install-behavior" "standalone Review change progress extension missing"
  # pi does not realpath-resolve symlinked extensions, so the installed adapter
  # must be a self-contained bundle — no leftover relative imports it can't find.
  if [[ -f "$tmphome/.pi/agent/extensions/guard-policies.ts" ]] \
     && ! grep -qE 'from[[:space:]]*["'\''][.][.]?/' "$tmphome/.pi/agent/extensions/guard-policies.ts"; then
    pass "pi guard extension is self-contained (bundled, no relative imports)"
  else
    fail "install-behavior" "pi guard extension has relative imports pi can't resolve (must be bundled)"
  fi
  [[ -f "$tmphome/.pi/agent/AGENTS.md" ]] && pass "pi global bootstrap installed as AGENTS.md" \
    || fail "install-behavior" "pi AGENTS.md bootstrap missing"
  [[ ! -d "$tmphome/.pi/agent/rules" ]] && pass "pi uses the canonical shared rulebook without a mirror" \
    || fail "install-behavior" "pi rules/ mirror should not be installed"

  [[ -f "$tmphome/.claude/CLAUDE.md" ]] && pass "Claude global bootstrap installed as CLAUDE.md" \
    || fail "install-behavior" "Claude CLAUDE.md bootstrap missing"

  for target in \
    "$tmphome/.claude/skills/review-change/SKILL.md" \
    "$tmphome/.pi/agent/skills/review-change/SKILL.md" \
    "$tmphome/.claude/agents/change-reviewer.md" \
    "$tmphome/.claude/agents/change-fixer.md" \
    "$tmphome/.pi/agent/agents/change-reviewer.md" \
    "$tmphome/.pi/agent/agents/change-fixer.md"; do
    [[ -f "$target" ]] && pass "Review change primitive installed: ${target#"$tmphome"/}" \
      || fail "install-behavior" "Review change primitive missing: ${target#"$tmphome"/}"
  done
  [[ -x "$tmphome/.local/bin/review-change" ]] \
    && pass "standalone review-change executable installed" \
    || fail "install-behavior" "standalone review-change executable missing or not executable"
  [[ ! -L "$tmphome/.local/bin/change-review" ]] \
    && pass "renamed CLI removes the old repo-managed change-review link" \
    || fail "install-behavior" "old repo-managed change-review link remains"
  [[ ! -d "$tmphome/.claude/rules" ]] && pass "Claude has no repo-managed auto-loaded rules directory" \
    || fail "install-behavior" "Claude rules/ mirror should not be installed"
  [[ ! -d "$tmphome/.claude/rulebook" ]] && pass "Claude uses the canonical shared rulebook without a mirror" \
    || fail "install-behavior" "Claude rulebook/ mirror should not be installed"

  [[ -f "$tmphome/.pi/agent/extensions/subagent/index.ts" ]] && pass "pi subagent extension index.ts installed" \
    || fail "install-behavior" "pi subagent extension index.ts missing"
  [[ -f "$tmphome/.pi/agent/extensions/subagent/agents.ts" ]] && pass "pi subagent extension agents.ts installed" \
    || fail "install-behavior" "pi subagent extension agents.ts missing"
  [[ -f "$tmphome/.pi/agent/extensions/subagent/tool-names.ts" ]] \
    && [[ -f "$tmphome/.pi/agent/extensions/subagent/model-selection.ts" ]] \
    && grep -q "parseAgentTools" "$tmphome/.pi/agent/extensions/subagent/agents.ts" \
    && grep -q 'from "[.]/tool-names[.]ts"' "$tmphome/.pi/agent/extensions/subagent/agents.ts" \
    && grep -q 'from "[.]/model-selection[.]ts"' "$tmphome/.pi/agent/extensions/subagent/agents.ts" \
    && pass "pi subagent adapter accepts shared tools and CLI model inheritance" \
    || fail "install-behavior" "pi subagent tool/model adapter missing"

  # Migration + idempotency: remove old repo-managed Claude/pi rule mirrors
  # without touching unrelated user rules, then verify a second run succeeds.
  mkdir -p "$tmphome/.claude/rules" "$tmphome/.claude/rulebook" "$tmphome/.pi/agent/rules"
  ln -sf "$REPO_DIR/rules/git-commit.md" "$tmphome/.claude/rules/git-commit.md"
  ln -sf "$REPO_DIR/rules/testing.md" "$tmphome/.claude/rulebook/testing.md"
  ln -sf "$REPO_DIR/rules/mise.md" "$tmphome/.pi/agent/rules/mise.md"
  printf '%s\n' '# User rule' >"$tmphome/.claude/rules/custom.md"
  rm -f "$tmphome/.local/bin/review-change"
  printf '%s\n' '#!/bin/sh' 'echo user-owned' >"$tmphome/.local/bin/review-change"
  chmod +x "$tmphome/.local/bin/review-change"
  if HOME="$tmphome" bash "$REPO_DIR/install.sh" >/dev/null 2>&1 \
     && [[ -e "$tmphome/.claude/settings.json" ]]; then
    pass "re-running install is idempotent"
  else
    fail "install-behavior" "second install run was not idempotent"
  fi
  [[ ! -e "$tmphome/.claude/rules/git-commit.md" ]] && pass "re-install removes a legacy auto-loaded Claude rule" \
    || fail "install-behavior" "legacy Claude rules/git-commit.md was not removed"
  [[ ! -e "$tmphome/.claude/rulebook/testing.md" ]] && pass "re-install removes a legacy Claude rulebook mirror" \
    || fail "install-behavior" "legacy Claude rulebook/testing.md was not removed"
  [[ ! -e "$tmphome/.pi/agent/rules/mise.md" ]] && pass "re-install removes a legacy pi rule mirror" \
    || fail "install-behavior" "legacy pi rules/mise.md was not removed"
  [[ -f "$tmphome/.claude/rules/custom.md" ]] && pass "re-install preserves unrelated Claude rules" \
    || fail "install-behavior" "unrelated Claude rules/custom.md was removed"
  grep -q "user-owned" "$tmphome/.local/bin/review-change" \
    && pass "re-install preserves an unrelated review-change executable" \
    || fail "install-behavior" "unrelated review-change executable was overwritten"

  # Prune: dangling and retired links in managed category dirs are removed on re-install.
  ln -s "/nonexistent-$(basename "$tmphome")" "$tmphome/.pi/agent/skills/_dangling"
  for retired in architect code-reviewer doc-updater; do
    ln -s "$REPO_DIR/agents/$retired.md" "$tmphome/.pi/agent/agents/$retired.md"
  done
  HOME="$tmphome" bash "$REPO_DIR/install.sh" >/dev/null 2>&1
  if [[ -L "$tmphome/.pi/agent/skills/_dangling" ]]; then
    fail "install-behavior" "dangling symlink not pruned on re-install"
  else
    pass "re-install prunes dangling symlinks"
  fi
  for retired in architect code-reviewer doc-updater; do
    [[ ! -L "$tmphome/.pi/agent/agents/$retired.md" ]] \
      && pass "re-install prunes retired agent link: $retired" \
      || fail "install-behavior" "retired agent link remains: $retired"
  done

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
  run test_phase_review_change
  run test_review_change_cli
  run test_agent_change_reviewer
  run test_agent_change_fixer
  run test_agent_fact_checker_idempotent
  run test_agent_database_reviewer_read_only
  run test_phase_review_code
  run test_skill_review_artifact
  run test_agent_refactorer
  run test_retired_review_change_agents
  run test_retired_cleaners
  run test_skill_refactor
  run test_phase_orchestrator
  run test_unique_adr_ids
  run test_cross_references
  run test_agent_rule_deps
  run test_symlink_targets
  run test_guide_skill_sync
  run test_no_ttsr_frontmatter
  run test_advisory_rule_frontmatter
  run test_pi_bundle_current
  run test_no_forbidden_claude_centric_phrasing
  run test_stale_stubs
}

# install: the install system, harness modules, cross-harness isolation, and
# idempotent/prune install behavior.
run_install() {
  run test_harness_modules
  run test_isolation
  run test_install_behavior
}

# Run one named check for the meta-suite. Keeping this allowlist explicit avoids
# turning a command-line argument into arbitrary shell function execution.
run_selected() {
  case "$1" in
    frontmatter-skills)        run test_frontmatter_skills ;;
    frontmatter-agents)        run test_frontmatter_agents ;;
    cross-references)          run test_cross_references ;;
    unique-adr-ids)            run test_unique_adr_ids ;;
    agent-rule-deps)           run test_agent_rule_deps ;;
    stale-stubs)               run test_stale_stubs ;;
    forbidden-phrasing)        run test_no_forbidden_claude_centric_phrasing ;;
    no-ttsr-frontmatter)       run test_no_ttsr_frontmatter ;;
    pi-bundle-current)         run test_pi_bundle_current ;;
    advisory-frontmatter)      run test_advisory_rule_frontmatter ;;
    symlink-targets)           run test_symlink_targets ;;
    coach-holding-line)        run test_phase_coach_holding_line ;;
    phase-orchestrator)        run test_phase_orchestrator ;;
    harness-modules)           run test_harness_modules ;;
    isolation)                 run test_isolation ;;
    *) printf 'unknown check %q\n' "$1" >&2; exit 2 ;;
  esac
}

# Usage: test-pipeline.sh [content|install] [check]   (no arg runs both)
# The optional check selector is for test-pipeline-self-test.sh, which plants
# one error at a time and exercises only the detector responsible for it.
main() {
  _cache_agent_names
  local category="${1:-all}" selected="${2:-}" label
  case "$category" in
    content) label="authoring contract" ;;
    install) label="install + harness modules" ;;
    all)     label="content + install" ;;
    *) printf 'unknown category %q — use: content | install (or none for all)\n' "$category" >&2; exit 2 ;;
  esac
  if [[ -n "$selected" ]]; then
    label="$label / $selected"
  fi
  printf '\n  %s▌%s %sai-config%s %s— %s%s\n\n' "$C" "$N" "$B" "$N" "$D" "$label" "$N"

  if [[ -n "$selected" ]]; then
    run_selected "$selected"
  else
    case "$category" in
      content) run_content ;;
      install) run_install ;;
      all)     run_content; run_install ;;
    esac
  fi

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
