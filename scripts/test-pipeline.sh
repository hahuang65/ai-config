#!/usr/bin/env bash
# Validates internal consistency of the shared skills, agents, rules, and
# harness configuration.
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
    if [[ -f "$f" ]]; then
      local agent_basename="${f##*/}"
      AGENT_NAMES+=("${agent_basename%.md}")
    fi
  done
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

extract_frontmatter() {
  awk '
    /^---$/ { delimiter += 1; next }
    delimiter == 1 { print }
    delimiter >= 2 { exit }
  ' "$1"
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

check_ordered_file_patterns() {
  local file="$1" label="$2"
  shift 2
  local pattern match line previous_line=0
  for pattern in "$@"; do
    match="$(grep -niE -m 1 -- "$pattern" "$file" || true)"
    line="${match%%:*}"
    if [[ -z "$line" || "$line" -le "$previous_line" ]]; then
      fail "$label" "missing or out-of-order '$pattern'"
      return
    fi
    previous_line="$line"
  done
  pass "$label keeps its required sequence"
}

count_matches() {
  grep -cE "$1" "$2" 2>/dev/null || echo 0
}

extract_markdown_reference_targets() {
  grep -oE '\]\([^)]*references/[^)#]+[.]md(#[^)]+)?\)' "$1" 2>/dev/null \
    | sed -E 's/^\]\(//; s/\)$//' | sort -u || true
}

extract_markdown_reference_paths() {
  # Return local or external references/...md targets without optional
  # fragments so callers can classify or resolve the underlying file.
  extract_markdown_reference_targets "$1" | sed -E 's/#.*$//' | sort -u
}

extract_markdown_headings() {
  awk '
    /^[[:space:]]*#{1,6}([[:space:]]+|$)/ {
      heading = $0
      sub(/^[[:space:]]*#+[[:space:]]*/, "", heading)
      sub(/[[:space:]]+#+[[:space:]]*$/, "", heading)
      print heading
      previous = ""
      next
    }
    previous != "" && /^[[:space:]]*(=+|-+)[[:space:]]*$/ {
      print previous
      previous = ""
      next
    }
    /^[[:space:]]*$/ { previous = ""; next }
    { previous = $0 }
  ' "$1"
}

github_heading_fragment() {
  printf '%s' "$1" \
    | sed -E 's/<[^>]*>//g' \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^[:alnum:] _-]//g; s/[[:space:]]/-/g'
}

markdown_fragment_exists() {
  local file="$1" fragment="$2" escaped_fragment heading slug count candidate
  escaped_fragment="$(printf '%s' "$fragment" | sed 's,[][\\.^$*+?(){}|/],\\&,g')"
  if grep -Eq "<[aA][[:space:]][^>]*([iI][dD]|[nN][aA][mM][eE])[[:space:]]*=[[:space:]]*(\"$escaped_fragment\"|'$escaped_fragment'|$escaped_fragment([[:space:]]|>))" "$file"; then
    return 0
  fi

  declare -A slug_counts=()
  while IFS= read -r heading; do
    slug="$(github_heading_fragment "$heading")"
    [[ -n "$slug" ]] || continue
    count="${slug_counts[$slug]:-0}"
    candidate="$slug"
    [[ "$count" -eq 0 ]] || candidate="$slug-$count"
    slug_counts[$slug]=$((count + 1))
    [[ "$candidate" == "$fragment" ]] && return 0
  done < <(extract_markdown_headings "$file")
  return 1
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
  done < <(extract_markdown_reference_paths "$skill_file")
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
    local skill_path="${skill_dir%/}"
    label="skills/${skill_path##*/}/SKILL.md"
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
    local label="agents/${agent_file##*/}"
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
# 3. Shared command prompts
# ---------------------------------------------------------------------------

test_command_prompts() {
  section "Shared command prompts"
  [[ -d "$REPO_DIR/commands" ]] || { fail "commands/" "shared command source is missing"; return; }

  local command_file name fm link
  local names=()
  for command_file in "$REPO_DIR"/commands/*.md; do
    [[ -f "$command_file" ]] || continue
    name="${command_file##*/}"
    name="${name%.md}"
    names+=("$name")
    fm="$(extract_frontmatter "$command_file")"
    if grep -q '^description:' <<<"$fm"; then
      pass "commands/$name.md has description:"
    else
      fail "commands/$name.md" "missing description frontmatter"
    fi
    if [[ -f "$REPO_DIR/skills/$name/SKILL.md" ]]; then
      fail "commands/$name.md" "duplicates a same-named skill"
    else
      pass "commands/$name.md has no same-named skill"
    fi
    while read -r link; do
      [[ -z "$link" || "$link" =~ ^https?: ]] && continue
      fail "commands/$name.md" "local Markdown link '$link' is unsafe after prompt expansion; load skills through advertised locations"
    done < <(grep -oE '\]\([^)]+[.]md\)' "$command_file" 2>/dev/null | sed -E 's/^\]\(//; s/\)$//' || true)
  done

  if grep -Eqi 'by relative path|command-relative' "$REPO_DIR"/commands/*.md; then
    fail "commands/" "prompt templates must not depend on their source-file path"
  else
    pass "commands do not depend on prompt source-file paths"
  fi

  local actual_names
  actual_names="$(printf '%s\n' "${names[@]}" | sort | paste -sd' ' -)"
  [[ "$actual_names" == "deliver rebase" ]] \
    && pass "commands/ contains the curated alias and composition set" \
    || fail "commands/" "expected only: deliver rebase; found: $actual_names"
  if grep -Fq 'Load and follow the `orchard` skill' "$REPO_DIR/commands/rebase.md" \
     && grep -Fq 'load the `resolve-conflicts` skill' "$REPO_DIR/commands/rebase.md" \
     && grep -Fq 'needs-conflict-resolution' "$REPO_DIR/commands/rebase.md" \
     && grep -Fq -- '--finalize-operation' "$REPO_DIR/commands/rebase.md"; then
    pass "rebase composes Orchard lifecycle with conflict resolution"
  else
    fail "commands/rebase.md" "rebase must compose Orchard with conflict resolution"
  fi
  if [[ ! -e "$REPO_DIR/skills/deliver/SKILL.md" ]] \
     && [[ ! -e "$REPO_DIR/skills/merge/SKILL.md" ]] \
     && grep -Fq 'classify the checkout using Git only' "$REPO_DIR/commands/deliver.md" \
     && grep -Fq 'load the `orchard` skill' "$REPO_DIR/commands/deliver.md" \
     && grep -Fq 'Never invoke Orchard for an ordinary local branch' "$REPO_DIR/commands/deliver.md" \
     && grep -Fq 'git merge --ff-only' "$REPO_DIR/commands/deliver.md" \
     && grep -Fq '`commit` skill' "$REPO_DIR/commands/deliver.md" \
     && grep -Fq 'automatically aborted' "$REPO_DIR/commands/deliver.md" \
     && grep -Fq 'load the `resolve-conflicts` skill' "$REPO_DIR/commands/deliver.md" \
     && grep -Fq 'retry Orchard delivery' "$REPO_DIR/commands/deliver.md"; then
    pass "deliver routes managed worktrees through Orchard and resolves delivery rebase conflicts"
  else
    fail "commands/deliver.md" "must separate managed Orchard delivery from ordinary Git delivery and resolve managed rebase conflicts"
  fi

  grep -q '^command_target="commands"' "$REPO_DIR/harnesses/claude/manifest.sh" \
    && pass "Claude projects commands into commands/" \
    || fail "harnesses/claude/manifest.sh" "must set command_target=commands"
  grep -q '^command_target="prompts"' "$REPO_DIR/harnesses/pi/manifest.sh" \
    && pass "pi projects commands into prompts/" \
    || fail "harnesses/pi/manifest.sh" "must set command_target=prompts"

  check_content_cached "$(cat "$REPO_DIR/harness-system-prompt.md")" "harness-system-prompt.md" "Treat a project as A5 only when its originating repository has effective .ai[.]projectFamily=a5. from global or system Git configuration"
  local stale_a5_paths
  stale_a5_paths="$(grep -RFl '~/Projects/a5/' "$REPO_DIR/harness-system-prompt.md" "$REPO_DIR/skills" "$REPO_DIR/commands" "$REPO_DIR/agents" "$REPO_DIR/rules" 2>/dev/null || true)"
  if [[ -z "$stale_a5_paths" ]]; then
    pass "A5 classification uses trusted Git metadata without path duplication"
  else
    fail "A5 project classification" "stale filesystem convention found in: $(echo "$stale_a5_paths" | sed "s|$REPO_DIR/||" | paste -sd, -)"
  fi
}

# ---------------------------------------------------------------------------
# 4. Domain modeling and grill
# ---------------------------------------------------------------------------

test_skill_model_domain() {
  section "Skill: model-domain"
  local file="$REPO_DIR/skills/model-domain/SKILL.md"
  local label="skills/model-domain/SKILL.md"
  [[ -f "$file" ]] || { fail "$label" "file not found"; return; }
  local content
  content="$(gather_skill_content model-domain)"

  check_content_cached "$content" "$label" "[Uu]biquitous language"
  check_content_cached "$content" "$label" "domain experts.*documentation.*tests.*code"
  check_content_cached "$content" "$label" "[Bb]uild [Ff]rom [Ss]cratch"
  check_content_cached "$content" "$label" "[Aa]ugment"
  check_content_cached "$content" "$label" "[Aa]udit and [Cc]ondense"
  check_content_cached "$content" "$label" "CONTEXT-MAP\.md"
  check_content_cached "$content" "$label" "[Cc]hallenge [Aa]gainst the [Gg]lossary"
  check_content_cached "$content" "$label" "[Ss]harpen [Ff]uzzy [Ll]anguage"
  check_content_cached "$content" "$label" "[Cc]ross-[Rr]eference [Ww]ith [Cc]ode"
  check_content_cached "$content" "$label" "[Uu]pdate [Cc]ontext [Ff]iles [Ii]nline"
  check_content_cached "$content" "$label" "[Hh]ard to reverse"
  check_content_cached "$content" "$label" "real trade-off"
}

test_ubiquitous_language_contract() {
  section "Ubiquitous language contract"
  local baseline content context_file skill_file skill_name stale_aliases
  baseline="$(cat "$REPO_DIR/harness-system-prompt.md")"
  check_content_cached "$baseline" "harness-system-prompt.md" '`CONTEXT\.md` and `CONTEXT-MAP\.md` collectively as \*\*context files\*\*'
  check_content_cached "$baseline" "harness-system-prompt.md" "[Uu]biquitous language.*domain experts.*documentation.*tests.*code"
  check_content_cached "$baseline" "harness-system-prompt.md" "durable record of that language, not the language itself"

  for skill_name in build grill prototype review-code spec todo; do
    skill_file="$REPO_DIR/skills/$skill_name/SKILL.md"
    content="$(cat "$skill_file")"
    check_content_cached "$content" "skills/$skill_name/SKILL.md" "../model-domain/SKILL\.md"
    check_content_cached "$content" "skills/$skill_name/SKILL.md" "[Cc]ontext files"
  done

  for context_file in \
    skills/coach/SKILL.md \
    skills/code/SKILL.md \
    skills/model-domain/SKILL.md \
    skills/review-change/references/workflow.md \
    skills/review-code/SKILL.md \
    skills/spec/SKILL.md \
    skills/todo/SKILL.md \
    skills/visualize/SKILL.md; do
    check_content_cached "$(cat "$REPO_DIR/$context_file")" "$context_file" "[Cc]ontext files"
    check_content_cached "$(cat "$REPO_DIR/$context_file")" "$context_file" "[Uu]biquitous language"
  done

  while read -r context_file; do
    [[ -z "$context_file" ]] && continue
    check_content_cached "$(cat "$context_file")" "${context_file#"$REPO_DIR/"}" "[Cc]ontext files"
    check_content_cached "$(cat "$context_file")" "${context_file#"$REPO_DIR/"}" "[Uu]biquitous language"
  done < <(grep -RIlEi 'CONTEXT\.md|CONTEXT-MAP\.md|ubiquitous language' "$REPO_DIR/skills" "$REPO_DIR/agents" --include='*.md' | sort)

  stale_aliases="$(grep -REil 'CONTEXT\.md.{0,15}vocabular|domain language|project vocabulary|context artifacts' "$REPO_DIR/skills" "$REPO_DIR/agents" --include='*.md' || true)"
  [[ -z "$stale_aliases" ]] \
    && pass "skills and agents use ubiquitous language instead of glossary aliases" \
    || fail "ubiquitous language" "stale aliases found in: $(echo "$stale_aliases" | sed "s|$REPO_DIR/||" | paste -sd, -)"
}

test_phase_grill() {
  section "Phase: grill"
  local file="$REPO_DIR/skills/grill/SKILL.md"
  local label="skills/grill/SKILL.md"
  [[ -f "$file" ]] || { fail "$label" "file not found"; return; }
  local content
  content="$(gather_skill_content grill)"

  check_content_cached "$content" "$label" "design tree"
  check_content_cached "$content" "$label" "whole frontier in one round"
  check_content_cached "$content" "$label" "wait for the user's answers"
  check_content_cached "$content" "$label" "[Dd]efer.*dependent question"
  check_content_cached "$content" "$label" "recommended answer"
  check_content_cached "$content" "$label" "../model-domain/SKILL\.md"
  check_content_cached "$content" "$label" "[Uu]biquitous language"
  check_content_cached "$content" "$label" "CONTEXT\.md"
  check_content_cached "$content" "$label" "docs/adr/"
  check_content_cached "$content" "$label" "draft the spec"
  check_content_cached "$content" "$label" "[Ii]nside.*build.*return.*orchestrator.*mockup relevance"
}

# ---------------------------------------------------------------------------
# 4b. Skill: mockup
# ---------------------------------------------------------------------------

test_skill_mockup() {
  section "Skill: mockup"
  local file="$REPO_DIR/skills/mockup/SKILL.md"
  local label="skills/mockup/SKILL.md"
  local content direct_content
  content="$(gather_skill_content mockup)"
  direct_content="$(<"$file")"

  if [[ -f "$file" ]] \
    && grep -Eqi 'canonical.*mockups[.]html|mockups[.]html.*canonical' <<<"$content" \
    && grep -Fq '`review-artifact`' <<<"$content" \
    && grep -Eqi 'same (live )?artifact' <<<"$content" \
    && grep -Eqi 'explicit approval' <<<"$content"; then
    pass "$label carries one standalone UI mockup to explicit approval"
  else
    fail "$label" "must create canonical mockups.html, update the same live artifact through review-artifact, and wait for explicit approval"
  fi

  if grep -Eqi 'names.*docs/features/.*reuse.*supplied Feature directory' <<<"$direct_content" \
    && grep -Eqi 'otherwise.*feature description.*derive.*docs/features/<YYYYMMDD-HHMM>-<slug>/' <<<"$direct_content" \
    && grep -Fq '../shared/references/build-pipeline.md#file-conventions' <<<"$direct_content" \
    && grep -Eqi 'create.*resolved directory.*before writing.*mockups[.]html' <<<"$direct_content"; then
    pass "$label deterministically resolves a supplied directory or standalone feature description"
  else
    fail "$label" "must reuse a supplied Feature directory or derive and create a timestamped Feature directory from the standalone feature description before writing mockups.html"
  fi

  check_content_cached "$content" "$label" "browser.*terminal|terminal.*browser"
  check_content_cached "$content" "$label" "[Mm]aterially changed.*(layout|interaction flow|information hierarchy|responsive behavior|visual state)"
  check_content_cached "$content" "$label" "copy.*mechanical.*small defect"
  check_content_cached "$content" "$label" "affected surfaces"
  check_content_cached "$content" "$label" "realistic content.*important states"
  check_content_cached "$content" "$label" "responsive intent.*accessibility behavior"
  check_content_cached "$content" "$label" "data-artifact-kind=.mockup"
  check_content_cached "$content" "$label" "one recommended.*design.*default"
  check_content_cached "$content" "$label" "two or three.*alternatives.*(unresolved|real).*fork"
  check_content_cached "$content" "$label" "structurally different"
  check_content_cached "$content" "$label" "selected design.*rationale.*rejected alternatives"
  check_content_cached "$content" "$label" "information hierarchy.*interaction behavior.*important states.*responsive intent.*accessibility behavior"
  check_content_cached "$content" "$label" "dimensions.*decorative styling.*directional"

  check_ordered_file_patterns "$file" "$label approval readiness" \
    'before any approval review.*one recommended design.*visibly selected.*rationale' \
    'unresolved alternatives.*review-artifact.*feedback or decision interaction.*settle' \
    'after the selection settles.*same.*mockups[.]html.*selected design.*rationale.*rejected alternatives' \
    'only after.*decision record.*start or resume.*approval review'

  local contract="$REPO_DIR/skills/mockup/references/mockup-contract.md"
  check_ordered_file_patterns "$contract" "skills/mockup/references/mockup-contract.md approval readiness" \
    'before any approval review.*visibly select one recommended design.*rationale' \
    'alternatives remain unresolved.*review-artifact.*feedback or decision interaction.*settle.*before requesting approval' \
    'after the selection settles.*same.*mockups[.]html.*selected design.*rationale.*rejected alternative' \
    'only after.*decision record.*start or resume.*approval review'

  local guide="$REPO_DIR/skills/mockup/guide.html"
  if [[ -f "$guide" ]] \
    && grep -Fq 'mockups.html' "$guide" \
    && grep -Fq 'Design→Spec' "$guide" \
    && grep -Eqi 'one recommended.*design' "$guide"; then
    pass "skills/mockup/guide.html explains the reviewed workflow"
  else
    fail "skills/mockup/guide.html" "must explain mockups.html, Design→Spec, and the default recommended design"
  fi
  check_ordered_file_patterns "$guide" "skills/mockup/guide.html approval readiness" \
    'feedback or decision interaction.*settle the selection' \
    'after the selection settles.*selected design.*rationale.*rejected alternatives' \
    'only then start or resume the approval review' \
    'explicit approval is the Design→Spec signal'
}

test_prototype_mockup_routing() {
  section "Skill: prototype mockup routing"
  local file="$REPO_DIR/skills/prototype/SKILL.md"
  local label="skills/prototype/SKILL.md"
  local content first_route logic_content
  content="$(gather_skill_content prototype)"
  first_route="$(grep -Ei '^- [*][*]First[*][*]' "$file" || true)"
  logic_content="$(<"$REPO_DIR/skills/prototype/references/logic.md")"

  if grep -Eqi 'end-user interface design.*(subject|feature under test).*[[:space:]]or[[:space:]].*imperative prerequisite' <<<"$first_route" \
    && ! grep -Eqi '(subject|feature under test).*[[:space:]]and[[:space:]].*imperative prerequisite' <<<"$first_route" \
    && grep -Eqi '(logic|data).*(manual processing|state).*primary question first.*mockup.*last' <<<"$content" \
    && grep -Eqi '(without|no).*UI design question.*skip.*mockup' <<<"$content" \
    && grep -Eqi 'visual-only design.*route directly.*mockup' <<<"$logic_content"; then
    pass "Prototype routes mockup first, last, or skips it from the primary question"
  else
    fail "$label" "must route mockup first for interface-design subjects or imperative prerequisites, last for presentation-only UI, and skip it when no UI design question exists"
  fi
  check_content_cached "$content" "$label" "host application.*(integration|real data density|state behavior).*standalone"
  check_content_cached "$content" "$label" "(mockup|prototype) code.*never|never.*(mockup|prototype) code.*production|not.*promote.*production"

  local guide="$REPO_DIR/skills/prototype/guide.html"
  check_content_cached "$(<"$guide")" "skills/prototype/guide.html" "mockup"
  check_content_cached "$(<"$guide")" "skills/prototype/guide.html" "[Ff]irst.*[Ll]ast.*[Ss]kip"
  check_content_cached "$(<"$guide")" "skills/prototype/guide.html" "host application.*real data density"
  check_content_cached "$(<"$REPO_DIR/README.md")" "README.md" "prototype.*(mockup.*host application|host application.*mockup)"
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
  check_content_cached "$content" "$label" "(missing.*relevant.*mockups\.html|relevant.*mockups\.html.*missing).*(load|invoke|run).*mockup.*before.*(synthesi|draft|write)"
  check_content_cached "$content" "$label" "[Rr]ead.*mockups\.html.*when present"
  check_content_cached "$content" "$label" "[Ss]ummarize.*[Ll]ink.*selected design.*without duplicat"

  check_ordered_file_patterns "$file" "$label material UI feedback return path" \
    'Spec feedback materially redesigns the UI.*return path' \
    'Pause.*Spec approval review' \
    'changed.*mockups[.]html.*(load and run|run).*mockup.*review-artifact.*explicit approval' \
    'Synchroni[sz]e.*specs[.]html.*approved mockup.*resume.*Spec approval review' \
    'Continue to Tasks only after explicit Spec approval.*renew.*prior Spec approval.*invalidated'

  local guide="$REPO_DIR/skills/spec/guide.html"
  check_ordered_file_patterns "$guide" "skills/spec/guide.html material UI feedback return path" \
    'Material UI feedback return path.*Pause.*Spec approval review' \
    'changed.*mockups[.]html.*mockup.*review-artifact.*explicit approval' \
    'synchroni[sz]e.*specs[.]html.*approved mockup.*resume.*Spec approval review' \
    'Continue to Tasks only after explicit Spec approval.*renew.*prior Spec approval.*invalidated'

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

  check_ordered_file_patterns "$file" "$label material UI redesign return path" \
    'task feedback materially redesigns UI.*return path' \
    'pause.*Tasks approval review' \
    'changed.*mockups[.]html.*mockup.*review-artifact.*explicit approval' \
    'then synchronize.*specs[.]html.*tasks[.]html.*renew.*Spec approval.*Tasks approval' \
    'continue to implementation only after.*approvals.*explicitly renewed'

  local guide="$REPO_DIR/skills/todo/guide.html"
  check_ordered_file_patterns "$guide" "skills/todo/guide.html material UI redesign return path" \
    'task feedback materially redesigns UI.*pause.*Tasks approval review' \
    'changed.*mockups[.]html.*mockup.*review-artifact.*explicit approval' \
    'then synchronize.*specs[.]html.*tasks[.]html.*renew.*Spec approval.*Tasks approval' \
    'continue to implementation only after.*approvals.*explicitly renewed'
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
  check_content_cached "$(cat "$REPO_DIR/harness-system-prompt.md")" "harness-system-prompt.md" "Do not stage, commit, push, or deliver unless"
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
  [[ -f "$skill_file" ]] || { fail "$skill_label" "file not found"; return; }

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
}

# ---------------------------------------------------------------------------
# 6c2. Approved mockup remains Authoritative intent downstream
# ---------------------------------------------------------------------------

test_authoritative_intent_thread() {
  section "Authoritative-intent thread"
  local todo_content code_content coach_content build_review_content review_build_content
  local mockup_intent_pattern='(read|receive|pass).*approved.*mockups[.]html'

  todo_content="$(extract_body "$REPO_DIR/skills/todo/SKILL.md")"
  code_content="$(extract_body "$REPO_DIR/skills/code/SKILL.md")"
  coach_content="$(extract_body "$REPO_DIR/skills/coach/SKILL.md")"
  build_review_content="$(awk '
    /^### Phase 5: Review Change/ { in_section = 1 }
    /^## Key Principles/ { in_section = 0 }
    in_section
  ' "$REPO_DIR/skills/build/SKILL.md")"
  review_build_content="$(<"$REPO_DIR/skills/review-change/references/build-mode.md")"

  if [[ "${todo_content,,}" =~ $mockup_intent_pattern ]] \
    && [[ "${todo_content,,}" == *"authoritative intent"* ]] \
    && [[ "${todo_content,,}" == *"information hierarchy"* ]] \
    && [[ "${todo_content,,}" == *"interaction behavior"* ]] \
    && [[ "${todo_content,,}" == *"important states"* ]] \
    && [[ "${todo_content,,}" == *"responsive intent"* ]] \
    && [[ "${todo_content,,}" == *"accessibility"* ]] \
    && [[ "${todo_content,,}" == *"acceptance criteria"* ]] \
    && [[ "${todo_content,,}" == *"test surfaces"* ]] \
    && [[ "${code_content,,}" =~ $mockup_intent_pattern ]] \
    && [[ "${code_content,,}" == *"authoritative intent"* ]] \
    && [[ "${coach_content,,}" =~ $mockup_intent_pattern ]] \
    && [[ "${coach_content,,}" == *"authoritative intent"* ]] \
    && [[ "${build_review_content,,}" =~ $mockup_intent_pattern ]] \
    && [[ "${build_review_content,,}" == *"authoritative intent"* ]] \
    && [[ "${review_build_content,,}" =~ $mockup_intent_pattern ]] \
    && [[ "${review_build_content,,}" == *"authoritative intent"* ]]; then
    pass "approved mockup remains Authoritative intent from Tasks through build-mode Review change"
  else
    fail "approved mockup remains Authoritative intent from Tasks through build-mode Review change" "one or more downstream consumers dropped the approved UI contract"
  fi

  local guide_file
  for guide_file in todo code coach build; do
    check_content_cached "$(<"$REPO_DIR/skills/$guide_file/guide.html")" "skills/$guide_file/guide.html" "mockups\.html"
  done
  check_content_cached "$(<"$REPO_DIR/skills/shared/references/implementation-completion.md")" "skills/shared/references/implementation-completion.md" "mockups\.html"

  local implementation_mode implementation_content implementation_label
  for implementation_mode in code coach; do
    implementation_label="skills/$implementation_mode/SKILL.md"
    implementation_content="$(extract_body "$REPO_DIR/$implementation_label")"
    check_content_cached "$implementation_content" "$implementation_label" "[Ss]top the affected slice"
    check_content_cached "$implementation_content" "$implementation_label" "[Uu]pdate.*mockups[.]html.*review.*review-artifact.*explicit approval"
    check_content_cached "$implementation_content" "$implementation_label" "[Ss]ynchroni[sz]e.*specs[.]html.*tasks[.]html"
    check_content_cached "$implementation_content" "$implementation_label" "[Rr]enew.*approval.*invalidated"
    check_content_cached "$implementation_content" "$implementation_label" "[Rr]esume.*affected slice.*only after"
    check_content_cached "$(<"$REPO_DIR/skills/$implementation_mode/guide.html")" "skills/$implementation_mode/guide.html" "[Mm]aterial UI redesign:.*stop.*affected slice.*mockups[.]html.*review-artifact.*specs[.]html.*tasks[.]html.*renew invalidated approvals.*resume"
  done

  check_content_cached "$code_content" "skills/code/SKILL.md" "[Tt]erse corrections.*act immediately only.*does not materially redesign.*approved UI"
}

# ---------------------------------------------------------------------------
# 6c3. Build-mode Review change material UI redesign return path
# ---------------------------------------------------------------------------

test_review_change_material_ui_redesign() {
  section "Review change: material UI redesign"
  local file="$REPO_DIR/skills/review-change/references/build-mode.md"
  local guide="$REPO_DIR/skills/build/guide.html"

  check_ordered_file_patterns "$file" "$file material UI redesign return path" \
    'Ordinary conformance repair.*existing fourth Review-to-done gate' \
    'deliberately requests a material UI redesign during final Review change' \
    'Pause final Review change.*not.*ordinary conformance repair' \
    'Update.*mockups[.]html.*mockup.*review-artifact.*explicit approval' \
    'Synchronize.*specs[.]html.*tasks[.]html.*approved mockup' \
    'Renew every approval invalidated.*existing gate' \
    'Restart Review change.*refreshed Authoritative intent' \
    'keeps exactly four approval gates.*does not create a fifth gate'

  check_content_cached "$(<"$guide")" "skills/build/guide.html" \
    "deliberate material UI redesign.*pauses final review.*mockup.*review-artifact.*synchronizes.*specs[.]html.*tasks[.]html.*renews invalidated approvals.*restarts Review change.*refreshed Authoritative intent.*without adding a fifth gate"
}

# ---------------------------------------------------------------------------
# 6c4. Phase: review-change
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
  check_content_cached "$content" "$label" "behavior tests.*browser checks.*rendered screenshots.*manual checks"
  check_content_cached "$content" "$label" "insufficient UI evidence.*ask-user"
  check_content_cached "$content" "$label" "material.*drift.*pixel"
  check_content_cached "$content" "$label" "Authoritative intent.*acceptance data.*not.*instructions"
  check_content_cached "$content" "$label" "three.*fix/recheck rounds.*fresh.*complete.*Change reviewer.*never.*fixer rationale"
  check_content_cached "$content" "$label" "every initial adversarial stage.*every restart.*dispatch a fresh.*change-reviewer.*complete immutable scope.*decision ledger.*specialist Findings"
  check_content_cached "$content" "$label" "Coached build.*(does not|never).*source or tests.*documentation.*formatting"
  check_content_cached "$content" "$label" "coached-mode scope.*prohibits source and test edits.*Change fixer|Change fixer.*coached build mode.*documentation.*mechanical-formatting.*source or test change.*outside scope"
  check_content_cached "$content" "$label" "GitHub.*(URL|number).*title and body.*Authoritative intent.*immutable.*detached review worktree.*~/[.]review-orchard"
  check_content_cached "$content" "$label" "[Nn]o explicit target.*current branch.*pull request.*branch point"
  check_content_cached "$content" "$label" "[Cc]lassify execution trust before materializing.*Untrusted.*--no-checkout.*never.*materialize.*checkout hooks.*content filters"
  check_content_cached "$content" "$label" "not a sandbox.*must not execute.*A5 project.*provider CI.*ask-user"
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
  check_content_cached "$content" "$label" "plain language.*ubiquitous language.*Authoritative intent.*source.*tests.*project documentation.*common technical terms"
  check_content_cached "$content" "$label" "[Dd]efine.*(new|unfamiliar) term.*(first use|beside)"
  check_content_cached "$content" "$label" "self-contained.*HTML.*(OS|operating system).*temp.*review-artifact.*one HTML.*form.*[Cc]hat fallback"
  check_content_cached "$content" "$label" "dynamic value.*Untrusted.*Encode.*HTML text or attribute context.*textContent.*value.*never.*innerHTML"
  check_content_cached "$content" "$label" "Untrusted URL.*text.*validates.*https:.*report-owned local artifact URL"
  check_content_cached "$content" "$label" "select or add Findings.*attach instructions.*(request fixes|fix selected).*approve as-is.*explicit disposition.*updates in place"
  check_content_cached "$content" "$label" "inside that Finding's card.*Submit decisions.*builds the structured decision payload in the background.*must not display the structured payload.*review:submit"
  check_content_cached "$content" "$label" "Build mode.*database-reviewer.*fact-checker.*specs[.]html.*tasks[.]html"
  check_content_cached "$content" "$label" "fact-checker's changed-file result.*artifact changed.*restart at documentation check.*rerun lint.*cold fact-checking.*three-round limit"
  check_content_cached "$content" "$label" "second clean pass.*byte-for-byte unchanged"
  check_content_cached "$content" "$label" "final implementation verification command.*scope.*outcome.*prior broad Validation evidence.*never rerun"
  check_content_cached "$content" "$label" "review-artifact.*foreground poll.*approved.*never clear"
  check_content_cached "$content" "$label" "[Nn]ot generate a Markdown companion or automatic diff-review"
  check_content_cached "$content" "$label" "Every CLI (target|invocation).*read-only.*disposable isolated clone|disposable isolated clone.*Every CLI.*read-only"
  check_content_cached "$content" "$label" "CLI-specific pi guard.*model|model.*CLI-specific pi guard"
}

test_review_change_branch_freshness_docs() {
  section "Review change branch freshness docs"
  local relative_path content
  local public_surfaces=(
    README.md
    skills/review-change/SKILL.md
    skills/review-change/bin/review-change.mjs
    skills/review-change/references/cli-mode.md
    skills/review-change/references/workflow.md
    docs/adr/0022-run-standalone-review-change-through-pi.md
  )

  for relative_path in "${public_surfaces[@]}"; do
    content="$(tr '\n' ' ' < "$REPO_DIR/$relative_path" | tr -s '[:space:]' ' ')"
    check_content_cached "$content" "$relative_path" "configured matching remote"
    check_content_cached "$content" "$relative_path" "capture(s|d)?.*before isolation"
    check_content_cached "$content" "$relative_path" "credential-safe.*workspace.*fetch|fetch.*credential-safe.*workspace"
    check_content_cached "$content" "$relative_path" "descendant.*local.*matching.remote tips"
    check_content_cached "$content" "$relative_path" "fetched repository default branch.*remote"
    check_content_cached "$content" "$relative_path" "[Ee]xplicit.*origin/<branch>.*use(s|d| of)?.*origin"
    check_content_cached "$content" "$relative_path" "exact selected local head|exact selected descendant"
    check_content_cached "$content" "$relative_path" "tracked patch.*untracked files"
    check_content_cached "$content" "$relative_path" "[Rr]eplay conflict.*(cleanup|stale evidence)"
    check_content_cached "$content" "$relative_path" "[Ee]xplicit.*range.*(does not|not).*rematerialize"
    check_content_cached "$content" "$relative_path" "canonical.*nameWithOwner"
    check_content_cached "$content" "$relative_path" "selected and default.*OID"
    check_content_cached "$content" "$relative_path" "content equivalence"
    check_content_cached "$content" "$relative_path" "repository-ID binding"
    check_content_cached "$content" "$relative_path" "requested identity.*selects acquisition"
    check_content_cached "$content" "$relative_path" "[Uu]nrelated clone refs"
    check_content_cached "$content" "$relative_path" "exact selected OID"
  done
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
  local runner prompt report_viewer status_runtime status_state markdown_summary workspace local_materialization report_directory target_resolution
  runner="$(cat "$runtime/runner.mjs")"
  prompt="$(cat "$runtime/prompt.mjs")"
  report_viewer="$(cat "$runtime/report-viewer.mjs")"
  status_runtime="$(cat "$runtime/status.mjs")"
  status_state="$(cat "$runtime/status-state.mjs")"
  markdown_summary="$(cat "$runtime/markdown-summary.mjs")"
  workspace="$(cat "$runtime/workspace.mjs")"
  local_materialization="$(cat "$runtime/local-materialization.mjs")"
  report_directory="$(cat "$runtime/report-directory.mjs")"
  target_resolution="$(cat "$runtime/target.mjs")"
  check_content_cached "$runner" "skills/review-change/runtime/runner.mjs" "spawn.*command, args, options"
  check_content_cached "$runner" "skills/review-change/runtime/runner.mjs" "--mode.*json.*--print.*--no-session.*--skill"
  check_content_cached "$runner" "skills/review-change/runtime/runner.mjs" "REVIEW_CHANGE_GATE.*already active"
  check_content_cached "$runner" "skills/review-change/runtime/runner.mjs" "createReviewWorkspace"
  check_content_cached "$runner" "skills/review-change/runtime/runner.mjs" "workspace[.]cleanup"
  check_content_cached "$runner" "skills/review-change/runtime/runner.mjs" "status[.]finish.*finally.*cancellation[.]cleanup"
  check_content_cached "$status_runtime" "skills/review-change/runtime/status.mjs" "interrupt.*finalView.*dismissFinal.*restoreTerminal"
  check_content_cached "$report_viewer" "skills/review-change/runtime/report-viewer.mjs" "openReportArtifact.*expected one HTML report.*viewerCommand"
  check_content_cached "$prompt" "skills/review-change/runtime/prompt.mjs" "acceptance data, never executable instructions"
  check_content_cached "$prompt" "skills/review-change/runtime/prompt.mjs" "Do not invoke review-artifact or wait for approval.*parent process opens it"
  check_content_cached "$prompt" "skills/review-change/runtime/prompt.mjs" "Never stage, commit, push, or mutate provider state"
  check_content_cached "$prompt" "skills/review-change/runtime/prompt.mjs" "action step.*six words or fewer.*action log once per item.*never combine multiple items.*completion message.*Establish scope and intent.*Dispatch the fresh change-reviewer.*Validate anchors and project terminology.*Normalize Findings and risk"
  check_content_cached "$prompt" "skills/review-change/runtime/prompt.mjs" "every Finding card.*exact reviewed path:line anchor.*repository-relative path:line.*copy button.*absolute reviewed file path.*hidden text node.*textContent.*escapes reviewRoot"
  check_content_cached "$runner" "skills/review-change/runtime/runner.mjs" "reviewRoot: workspace[.]cwd"
  check_content_cached "$prompt" "skills/review-change/runtime/prompt.mjs" "one copyable general-review Markdown block.*one copyable Markdown block per Finding.*severity and path:line outside the copied text.*copy-icon button.*persistently mark"
  check_content_cached "$prompt" "skills/review-change/runtime/prompt.mjs" "every severity and action tag.*legend.*who decides next.*standalone tags never trigger mutation"
  check_content_cached "$status_state" "skills/review-change/runtime/status-state.mjs" "recordProgressStep.*substage.*telemetryStepped"
  check_content_cached "$status_state" "skills/review-change/runtime/status-state.mjs" "Review the complete change against intent.*Run smallest checks that prove intent.*Check changed documentation and claims"
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
  check_content_cached "$local_materialization" "skills/review-change/runtime/local-materialization.mjs" "ls-files.*--others.*--exclude-standard"
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
# no live authoring surface (skills, agents, rules, harness modules,
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
  if [[ -e "$REPO_DIR/skills/prd" ]]; then
    fail "retired" "skills/prd still exists (renamed to spec)"
  else
    pass "skills/prd is absent (renamed to spec)"
  fi

  # The improve-codebase skill was renamed to review-code and remains the
  # optional standalone architectural workflow (whole-codebase or area scope).
  # Review change owns the final /build gate.
  if [[ -e "$REPO_DIR/skills/improve-codebase" ]]; then
    fail "retired" "skills/improve-codebase still exists (renamed to review-code)"
  else
    pass "skills/improve-codebase is absent (renamed to review-code)"
  fi
  if [[ -f "$REPO_DIR/skills/review-code/SKILL.md" ]]; then
    pass "skills/review-code/SKILL.md exists"
  else
    fail "retired" "skills/review-code/SKILL.md missing (replacement for improve-codebase)"
  fi

  # The 2026-07 naming pass: short imperative verbs. specs->spec,
  # tasks->todo, implement->code, implement-coach->coach,
  # visual-explainer->visualize, diff-review->visualize-diff.
  # Canonical pipeline artifacts are specs.html and tasks.html;
  # visualize-diff still uses diff-review.html when invoked standalone.
  local old_name
  for old_name in specs tasks implement implement-coach visual-explainer diff-review; do
    if [[ -e "$REPO_DIR/skills/$old_name" ]]; then
      fail "retired" "skills/$old_name still exists (renamed in the verb naming pass)"
    else
      pass "skills/$old_name is absent (renamed)"
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
    if [[ -e "$REPO_DIR/skills/$old_name" ]]; then
      fail "retired" "skills/$old_name still exists (removed as unused)"
    else
      pass "skills/$old_name is absent (removed as unused)"
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
    "$REPO_DIR/skills" "$REPO_DIR/agents" "$REPO_DIR/rules" "$REPO_DIR/harnesses" \
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
  for phase in grill mockup spec todo code coach review-change; do
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
  check_content_cached "$content" "$label" "Design→Spec.*Spec→Tasks.*Tasks→Implement.*Review→done"
  check_content_cached "$content" "$label" "[Rr]elevant UI.*mockup approval clears the Design→Spec gate.*without another confirmation"
  check_content_cached "$content" "$label" "scope and (inspected|existing) (code|interface).*ambiguous"
  check_content_cached "$content" "$label" "mockups\.html"
  check_content_cached "$content" "$label" "[Pp]ost-grill chat confirmation.*no.*relevant UI"

  check_content_cached "$content" "$label" "Mandatory Phase Loading"
  check_content_cached "$content" "$label" "At the start of each phase"
  check_content_cached "$content" "$label" "available_skills"
  for phase in grill spec todo code coach review-change; do
    check_content_cached "$content" "$label" "../$phase/SKILL\.md"
  done
  check_content_cached "$content" "$label" "Conditional.*../mockup/SKILL\.md"

  local pipeline_protocol
  pipeline_protocol="$(<"$REPO_DIR/skills/shared/references/build-pipeline.md")"
  check_content_cached "$pipeline_protocol" "skills/shared/references/build-pipeline.md" "Design→Spec"
  check_content_cached "$pipeline_protocol" "skills/shared/references/build-pipeline.md" "mockups\.html"
  check_content_cached "$pipeline_protocol" "skills/shared/references/build-pipeline.md" "explicit mockup approval.*post-grill chat confirmation|post-grill chat confirmation.*explicit mockup approval"

  local build_guide
  build_guide="$(<"$REPO_DIR/skills/build/guide.html")"
  check_content_cached "$build_guide" "skills/build/guide.html" "Design→Spec"
  check_content_cached "$build_guide" "skills/build/guide.html" "mockups\.html"
  check_content_cached "$(<"$REPO_DIR/README.md")" "README.md" "Design→Spec"
  check_content_cached "$(<"$REPO_DIR/README.md")" "README.md" "/mockup"

  local bootstrap
  bootstrap="$(<"$REPO_DIR/harness-system-prompt.md")"
  check_content_cached "$bootstrap" "harness-system-prompt.md" "Use a named feature branch, never trunk"
  check_content_cached "$bootstrap" "harness-system-prompt.md" "Name it .user-initials/short-intent."
  check_content_cached "$bootstrap" "harness-system-prompt.md" "Ordinary work stays in the current checkout on a local task branch"
  check_content_cached "$bootstrap" "harness-system-prompt.md" "If currently on trunk, create the task branch there"
  check_content_cached "$bootstrap" "harness-system-prompt.md" "Use Orchard only for .[/]build. or explicit lifecycle requests"
  check_content_cached "$bootstrap" "harness-system-prompt.md" "passing the same .short-intent."
  check_content_cached "$bootstrap" "harness-system-prompt.md" "Treat a project as A5 only when its originating repository has effective .ai[.]projectFamily=a5. from global or system Git configuration"
  check_content_cached "$bootstrap" "harness-system-prompt.md" "Use mise-managed toolchains.*invoke tools directly.*never activate or recommend rbenv, rvm, chruby, asdf, nvm, or pyenv"
  check_content_cached "$bootstrap" "harness-system-prompt.md" "Favor quality, simplicity, robustness, scalability, and maintainability over development cost"
  check_content_cached "$bootstrap" "harness-system-prompt.md" "Communicate clearly and concisely"
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
  for phase in grill mockup spec todo code coach review-change; do
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
        local skill_parent="${skill_file%/*}"
        pass "agents/${agent_name}.md exists (referenced from ${skill_parent##*/}/SKILL.md)"
      else
        fail "cross-ref" "agents/${agent_name}.md not found (referenced from $skill_file)"
      fi
    done < <(grep -oE '`[a-z][a-z0-9-]+`' "$skill_file" | tr -d '`' | grep -Ff <(echo "$agent_names_str") || true)
  done
}

# Every `references/...md` link inside a SKILL.md must resolve to a real file —
# generalizes check_ve_paths to all skills. Guards progressive-disclosure
# imports (a skill's own references/ and ../shared/references/).
check_skill_reference_links() {
  local skill_file
  for skill_file in "$REPO_DIR"/skills/*/SKILL.md; do
    local skill_dir="${skill_file%/*}"
    local skill_name="${skill_dir##*/}"
    local target rel fragment target_file
    while read -r target; do
      [[ -z "$target" ]] && continue
      [[ "$target" =~ ^https?: ]] && continue
      rel="${target%%#*}"
      target_file="$skill_dir/$rel"
      if [[ ! -f "$target_file" ]]; then
        fail "cross-ref" "skills/$skill_name/SKILL.md: reference '$target' does not resolve"
        continue
      fi
      if [[ "$target" != *#* ]]; then
        pass "skills/$skill_name/SKILL.md: reference '$target' resolves"
        continue
      fi
      fragment="${target#*#}"
      if markdown_fragment_exists "$target_file" "$fragment"; then
        pass "skills/$skill_name/SKILL.md: reference '$target' resolves"
      else
        fail "cross-ref" "skills/$skill_name/SKILL.md: fragment '#$fragment' does not resolve in '$rel'"
      fi
    done < <(extract_markdown_reference_targets "$skill_file")
  done
}

test_cross_references() {
  section "Cross-references"
  check_skill_references_phases
  check_agent_files_exist
  check_skill_reference_links
}

# ---------------------------------------------------------------------------
# 9. Agent rule dependencies
# ---------------------------------------------------------------------------

test_agent_rule_deps() {
  section "Agent rule dependencies"
  local agent_file
  for agent_file in "$REPO_DIR"/agents/*.md; do
    local label="agents/${agent_file##*/}"
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
    local skill_path="${skill_dir%/}"
    local skill_name="${skill_path##*/}"
    [[ "$skill_name" == "shared" ]] && continue
    local skill_file="$skill_dir/SKILL.md"
    if [[ -f "$skill_file" ]]; then
      pass "skills/$skill_name/SKILL.md exists"
    else
      fail "skills/$skill_name" "SKILL.md not found"
    fi
  done

  for dir in rules agents; do
    local f
    for f in "$REPO_DIR/$dir"/*.md; do
      if [[ -f "$f" ]]; then
        pass "$dir/${f##*/} exists"
      else
        fail "$dir" "${f##*/} is not a regular file"
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

test_guide_skill_sync() {
  section "Guide/skill sync"
  local skill_dir
  for skill_dir in "$REPO_DIR"/skills/*/; do
    local skill_path="${skill_dir%/}"
    local skill_name="${skill_path##*/}"
    local guide_file="$skill_dir/guide.html"
    local skill_file="$skill_dir/SKILL.md"
    [[ -f "$guide_file" && -f "$skill_file" ]] || continue
    check_guide_agents_exist "$guide_file" "$skill_name"
    check_guide_contains_skill_agents "$guide_file" "$skill_file" "$skill_name"
  done
}

# ---------------------------------------------------------------------------
# 11a. Agent-facing CLI guidance stays paired with its lazy-load route
# ---------------------------------------------------------------------------

test_cli_ergonomics_rule_routing() {
  section "Agent-facing CLI advisory routing"
  local rule_file="$REPO_DIR/rules/cli-ergonomics.md"
  local trigger="before designing, implementing, or reviewing an Agent-facing CLI"
  local description="description: Read $trigger."
  local route="- \`cli-ergonomics.md\` — $trigger"

  if [[ -f "$rule_file" ]] \
     && extract_frontmatter "$rule_file" | grep -Fqx "$description" \
     && grep -Fqx -- "$route" "$REPO_DIR/harness-system-prompt.md"; then
    pass "CLI ergonomics guidance and its lazy-load trigger are paired"
  else
    fail "Agent-facing CLI advisory routing" "rules/cli-ergonomics.md and its bootstrap trigger must use the same relevance boundary"
  fi
}

test_cli_ergonomics_rule_content() {
  section "Agent-facing CLI advisory outcomes"
  local content
  content="$(<"$REPO_DIR/rules/cli-ergonomics.md")"
  local marker
  for marker in \
    "Minimal bounded defaults" \
    "Explicit truncation" \
    "Cheap aggregates" \
    "Definitive empty states" \
    "Strict invocation validation" \
    "Meaningful exit codes" \
    "Deterministic automation paths" \
    "Concise corrective and contextual help" \
    "Purpose-specific formats"; do
    check_content_cached "$content" "rules/cli-ergonomics.md" "$marker"
  done
}

test_cli_ergonomics_rule_inventory() {
  section "Agent-facing CLI advisory inventory"
  local readme context
  readme="$(<"$REPO_DIR/README.md")"
  context="$(<"$REPO_DIR/CONTEXT.md")"
  check_content_cached "$readme" "README.md" "Rules [(]7 advisory files[)]"
  check_content_cached "$readme" "README.md" "rules/.*7 on-demand advisory rules"
  check_content_cached "$readme" "README.md" '[|] `cli-ergonomics` [|]'
  check_content_cached "$readme" "README.md" "kunchenguid/axi/tree/93c5f334d6ec074c29ca8d74fa629530dd298a43"
  check_content_cached "$context" "CONTEXT.md" "cli-ergonomics"
}

# ---------------------------------------------------------------------------
# 11b. Rules are advisory-only — TTSR is retired (ADR-0012)
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
    local label="rules/${rule_file##*/}"
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
    local label="rules/${rule_file##*/}"
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
    local module_path="${mod%/}"
    name="${module_path##*/}"
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
    local label="${label_prefix}/${stub_file##*/}"
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
  bun "$REPO_DIR/scripts/check-symlink-leak.mjs" "$1" "$REPO_DIR/$2"
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

  local scan_status
  if root_leaks_into_module "$tmphome/.pi/agent" "harnesses/claude"; then
    fail "isolation" "~/.pi/agent contains a symlink into the harnesses/claude module"
  else
    scan_status=$?
    if [[ $scan_status -eq 1 ]]; then
      pass "isolation: pi root has no symlink into the harnesses/claude module"
    else
      fail "isolation" "could not scan the pi root for cross-harness links"
    fi
  fi
  if root_leaks_into_module "$tmphome/.claude" "harnesses/pi"; then
    fail "isolation" "~/.claude contains a symlink into the harnesses/pi module"
  else
    scan_status=$?
    if [[ $scan_status -eq 1 ]]; then
      pass "isolation: claude root has no symlink into the harnesses/pi module"
    else
      fail "isolation" "could not scan the Claude root for cross-harness links"
    fi
  fi

  # test-the-test: a planted sibling link MUST be detected, or the check is vacuous.
  ln -sf "$REPO_DIR/harnesses/claude/settings.json" "$tmphome/.pi/agent/skills/_leak.json"
  if [[ ! -L "$tmphome/.pi/agent/skills/_leak.json" ]]; then
    fail "isolation" "could not plant the leak fixture — detector unverified"
  elif root_leaks_into_module "$tmphome/.pi/agent" "harnesses/claude"; then
    pass "isolation check catches a planted sibling leak"
  else
    scan_status=$?
    if [[ $scan_status -eq 1 ]]; then
      fail "isolation" "planted sibling leak was not detected"
    else
      fail "isolation" "planted sibling leak could not be scanned"
    fi
  fi

  if root_leaks_into_module "$tmphome/.pi/agent" "harnesses/missing-module" 2>/dev/null; then
    fail "isolation" "scanner accepted a missing module root"
  else
    scan_status=$?
    [[ $scan_status -eq 2 ]] \
      && pass "isolation scanner reports operational errors" \
      || fail "isolation" "scanner did not distinguish an operational error"
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
  section "Install loop: projection, migration, idempotency, prune"
  local tmphome
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
  [[ -e "$tmphome/.pi/agent/extensions/write-tool-highlights.ts" ]] \
    && pass "pi write tool highlight extension installed" \
    || fail "install-behavior" "pi write tool highlight extension missing"
  [[ -e "$tmphome/.pi/agent/themes/catppuccin-mocha.json" ]] \
    && pass "pi Catppuccin Mocha theme installed" \
    || fail "install-behavior" "pi Catppuccin Mocha theme missing"
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
  [[ -f "$tmphome/.claude/commands/deliver.md" ]] \
    && [[ -f "$tmphome/.claude/commands/rebase.md" ]] \
    && [[ ! -e "$tmphome/.claude/commands/resolve-conflicts.md" ]] \
    && pass "Claude command prompts installed into commands/ without skill duplicates" \
    || fail "install-behavior" "Claude command prompt set is incorrect"
  [[ -f "$tmphome/.pi/agent/prompts/deliver.md" ]] \
    && [[ -f "$tmphome/.pi/agent/prompts/rebase.md" ]] \
    && [[ ! -e "$tmphome/.pi/agent/prompts/implement.md" ]] \
    && [[ ! -e "$tmphome/.pi/agent/prompts/implement-and-review.md" ]] \
    && [[ ! -e "$tmphome/.pi/agent/prompts/scout-and-plan.md" ]] \
    && [[ ! -e "$tmphome/.pi/agent/prompts/resolve-conflicts.md" ]] \
    && pass "pi installs only curated command prompts" \
    || fail "install-behavior" "pi command prompt set is incorrect"
  [[ ! -e "$tmphome/.claude/skills/deliver/SKILL.md" ]] \
    && [[ ! -e "$tmphome/.pi/agent/skills/deliver/SKILL.md" ]] \
    && pass "deliver has no duplicate skill" \
    || fail "install-behavior" "deliver skill should stay retired"
  [[ ! -d "$tmphome/.pi/agent/commands" ]] && pass "pi legacy commands/ location stays retired" \
    || fail "install-behavior" "pi legacy commands/ should not be installed"

  for target in \
    "$tmphome/.claude/skills/mockup/SKILL.md" \
    "$tmphome/.pi/agent/skills/mockup/SKILL.md" \
    "$tmphome/.claude/skills/review-change/SKILL.md" \
    "$tmphome/.pi/agent/skills/review-change/SKILL.md" \
    "$tmphome/.claude/agents/change-reviewer.md" \
    "$tmphome/.claude/agents/change-fixer.md" \
    "$tmphome/.pi/agent/agents/change-reviewer.md" \
    "$tmphome/.pi/agent/agents/change-fixer.md"; do
    [[ -f "$target" ]] && pass "shared primitive installed: ${target#"$tmphome"/}" \
      || fail "install-behavior" "shared primitive missing: ${target#"$tmphome"/}"
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

  # Migration + idempotency: remove old repo-managed rule mirrors, retired
  # delivery skills/prompts, and pi's commands/ location without touching
  # unrelated user files, then verify a second run succeeds.
  mkdir -p "$tmphome/.claude/rules" "$tmphome/.claude/rulebook" "$tmphome/.pi/agent/rules" \
    "$tmphome/.claude/commands" "$tmphome/.pi/agent/commands" "$tmphome/user-commands"
  ln -sf "$REPO_DIR/rules/git-commit.md" "$tmphome/.claude/rules/git-commit.md"
  ln -sf "$REPO_DIR/rules/testing.md" "$tmphome/.claude/rulebook/testing.md"
  ln -sf "$REPO_DIR/rules/mise.md" "$tmphome/.pi/agent/rules/mise.md"
  ln -s "$REPO_DIR/commands/commit.md" "$tmphome/.pi/agent/commands/commit.md"
  ln -s "$REPO_DIR/commands/merge.md" "$tmphome/.claude/commands/merge.md"
  ln -s "$REPO_DIR/commands/merge.md" "$tmphome/.pi/agent/prompts/merge.md"
  ln -s "$REPO_DIR/commands/resolve-conflicts.md" "$tmphome/.claude/commands/resolve-conflicts.md"
  ln -s "$REPO_DIR/commands/resolve-conflicts.md" "$tmphome/.pi/agent/prompts/resolve-conflicts.md"
  ln -s "$REPO_DIR/skills/deliver" "$tmphome/.claude/skills/deliver"
  ln -s "$REPO_DIR/skills/deliver" "$tmphome/.pi/agent/skills/deliver"
  ln -s "$REPO_DIR/skills/merge" "$tmphome/.claude/skills/merge"
  ln -s "$REPO_DIR/skills/merge" "$tmphome/.pi/agent/skills/merge"
  printf '%s\n' '# User command' >"$tmphome/user-commands/custom.md"
  ln -s "$tmphome/user-commands/custom.md" "$tmphome/.claude/commands/custom.md"
  printf '%s\n' '# User rule' >"$tmphome/.claude/rules/custom.md"
  rm -f "$tmphome/.local/bin/review-change"
  printf '%s\n' '#!/bin/sh' 'echo user-owned' >"$tmphome/.local/bin/review-change"
  chmod +x "$tmphome/.local/bin/review-change"

  # Plant prune fixtures before the idempotency run so one reinstall proves
  # migration, preservation, idempotency, and pruning together.
  ln -s "/nonexistent-${tmphome##*/}" "$tmphome/.pi/agent/skills/_dangling"
  for retired in architect code-reviewer doc-updater; do
    ln -s "$REPO_DIR/agents/$retired.md" "$tmphome/.pi/agent/agents/$retired.md"
  done

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
  [[ -L "$tmphome/.claude/commands/deliver.md" ]] \
    && [[ -L "$tmphome/.claude/commands/rebase.md" ]] \
    && pass "re-install preserves canonical Claude command prompts" \
    || fail "install-behavior" "canonical Claude command prompt missing"
  [[ ! -L "$tmphome/.claude/commands/merge.md" ]] \
    && [[ ! -L "$tmphome/.pi/agent/prompts/merge.md" ]] \
    && [[ ! -L "$tmphome/.claude/commands/resolve-conflicts.md" ]] \
    && [[ ! -L "$tmphome/.pi/agent/prompts/resolve-conflicts.md" ]] \
    && pass "re-install removes retired command prompts" \
    || fail "install-behavior" "retired command prompt was not pruned"
  [[ ! -L "$tmphome/.claude/skills/deliver" ]] \
    && [[ ! -L "$tmphome/.pi/agent/skills/deliver" ]] \
    && [[ ! -L "$tmphome/.claude/skills/merge" ]] \
    && [[ ! -L "$tmphome/.pi/agent/skills/merge" ]] \
    && pass "re-install removes retired delivery skills" \
    || fail "install-behavior" "retired deliver or merge skill was not pruned"
  [[ ! -L "$tmphome/.pi/agent/commands/commit.md" ]] && pass "re-install removes the legacy pi command wrapper" \
    || fail "install-behavior" "legacy pi commands/commit.md was not removed"
  [[ -L "$tmphome/.claude/commands/custom.md" ]] && pass "re-install preserves unrelated Claude commands" \
    || fail "install-behavior" "unrelated Claude commands/custom.md was removed"
  [[ -f "$tmphome/.claude/rules/custom.md" ]] && pass "re-install preserves unrelated Claude rules" \
    || fail "install-behavior" "unrelated Claude rules/custom.md was removed"
  grep -q "user-owned" "$tmphome/.local/bin/review-change" \
    && pass "re-install preserves an unrelated review-change executable" \
    || fail "install-behavior" "unrelated review-change executable was overwritten"

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

  rm -rf "$tmphome"
}

test_install_module_lifecycle() {
  section "Install loop: module add/remove"
  local lifecycle_results result
  lifecycle_results="$(
    tmphome=""
    tmpmods=""
    tmphome="$(mktemp -d)"
    tmpmods="$(mktemp -d)"
    trap 'rm -rf "$tmphome" "$tmpmods"' EXIT
    mkdir -p "$tmpmods/alpha"
    cat >"$tmpmods/alpha/manifest.sh" <<'EOF'
config_root="$HOME/.alpha-harness"
consumed_categories=(skills)
install_module() { :; }
EOF
    if HARNESSES_DIR="$tmpmods" HOME="$tmphome" bash "$REPO_DIR/install.sh" >/dev/null 2>&1 \
        && [[ -d "$tmphome/.alpha-harness/skills" ]]; then
      printf '%s\n' add-pass
    else
      printf '%s\n' add-fail
    fi
    rm -rf "$tmpmods/alpha"
    if HARNESSES_DIR="$tmpmods" HOME="$tmphome" bash "$REPO_DIR/install.sh" >/dev/null 2>&1; then
      printf '%s\n' remove-pass
    else
      printf '%s\n' remove-fail
    fi
  )"
  while IFS= read -r result; do
    case "$result" in
      add-pass) pass "adding a module directory installs a new harness" ;;
      add-fail) fail "install-module-lifecycle" "added module was not installed" ;;
      remove-pass) pass "deleting a module directory removes it cleanly (install still succeeds)" ;;
      remove-fail) fail "install-module-lifecycle" "install failed after module removal" ;;
    esac
  done <<<"$lifecycle_results"
}

# The TypeScript guard suite (guard core + adapters + conformance) runs under
# bun via the `test/guard` Make target, not here — this script stays pure
# static / structural validation so the self-test can re-run it cheaply.
# `make test` runs content, install, guard, and meta together.

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

# content: the shared authoring contract — skills/agents/rules markdown is
# well-formed and internally consistent.
run_content_foundation() {
  run test_frontmatter_skills
  run test_frontmatter_agents
  run test_command_prompts
  run test_skill_model_domain
  run test_ubiquitous_language_contract
}

run_content_build() {
  run test_phase_grill
  run test_skill_mockup
  run test_prototype_mockup_routing
  run test_phase_spec
  run test_phase_todo
  run test_phase_code
  run test_phase_coach
  run test_phase_coach_holding_line
}

run_content_pipeline() {
  run_content_foundation
  run_content_build
  run test_authoritative_intent_thread
}

run_content_review() {
  run test_review_change_material_ui_redesign
  run test_phase_review_change
  run test_review_change_branch_freshness_docs
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
}

run_content_references() {
  run test_phase_orchestrator
  run test_unique_adr_ids
  run test_cross_references
  run test_agent_rule_deps
  run test_symlink_targets
  run test_guide_skill_sync
}

run_content_contracts() {
  run test_cli_ergonomics_rule_routing
  run test_cli_ergonomics_rule_content
  run test_cli_ergonomics_rule_inventory
  run test_no_ttsr_frontmatter
  run test_advisory_rule_frontmatter
  run test_pi_bundle_current
  run test_no_forbidden_claude_centric_phrasing
  run test_stale_stubs
}

run_content_structure() {
  run_content_references
  run_content_contracts
}

run_content() {
  run_content_pipeline
  run_content_review
  run_content_structure
}

# install: the install system, harness modules, cross-harness isolation, and
# idempotent/prune install behavior.
run_install() {
  run test_harness_modules
  run test_isolation
  run test_install_behavior
  run test_install_module_lifecycle
}

# Run one named check for the meta-suite. Keeping this allowlist explicit avoids
# turning a command-line argument into arbitrary shell function execution.
run_selected() {
  case "$1" in
    frontmatter-skills)        run test_frontmatter_skills ;;
    frontmatter-agents)        run test_frontmatter_agents ;;
    command-prompts)           run test_command_prompts ;;
    ubiquitous-language)       run test_ubiquitous_language_contract ;;
    cross-references)          run test_cross_references ;;
    unique-adr-ids)            run test_unique_adr_ids ;;
    agent-rule-deps)           run test_agent_rule_deps ;;
    stale-stubs)               run test_stale_stubs ;;
    forbidden-phrasing)        run test_no_forbidden_claude_centric_phrasing ;;
    no-ttsr-frontmatter)       run test_no_ttsr_frontmatter ;;
    pi-bundle-current)         run test_pi_bundle_current ;;
    advisory-frontmatter)      run test_advisory_rule_frontmatter ;;
    cli-ergonomics-routing)    run test_cli_ergonomics_rule_routing ;;
    cli-ergonomics-outcomes)   run test_cli_ergonomics_rule_content ;;
    cli-ergonomics-inventory)  run test_cli_ergonomics_rule_inventory ;;
    symlink-targets)           run test_symlink_targets ;;
    coach-holding-line)        run test_phase_coach_holding_line ;;
    mockup-workflow)           run test_skill_mockup ;;
    spec-workflow)             run test_phase_spec ;;
    todo-workflow)             run test_phase_todo ;;
    mockup-intent-thread)      run test_authoritative_intent_thread ;;
    prototype-mockup-routing)  run test_prototype_mockup_routing ;;
    review-change-ui-redesign) run test_review_change_material_ui_redesign ;;
    review-branch-docs)        run test_review_change_branch_freshness_docs ;;
    phase-orchestrator)        run test_phase_orchestrator ;;
    harness-modules)           run test_harness_modules ;;
    isolation)                 run test_isolation ;;
    install-behavior)          run test_install_behavior ;;
    install-module-lifecycle)  run test_install_module_lifecycle ;;
    content-foundation)        run_content_foundation ;;
    content-build)             run_content_build ;;
    content-pipeline)          run_content_pipeline ;;
    content-review)            run_content_review ;;
    content-references)        run_content_references ;;
    content-contracts)         run_content_contracts ;;
    content-structure)         run_content_structure ;;
    *) printf 'unknown check %q\n' "$1" >&2; exit 2 ;;
  esac
}

# Usage: test-pipeline.sh [content|install] [check]   (no arg runs both)
# The optional check selector is for test-pipeline-self-test.sh, which plants
# one error at a time and exercises only the detector responsible for it.
pipeline_main() {
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

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  pipeline_main "$@"
fi
