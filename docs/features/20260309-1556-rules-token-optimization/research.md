# Research: Skills MUST Steps & Token Optimization

## Overview

This research catalogs every mandatory step ("MUST", "non-negotiable", "not optional", "NEVER") across the user's custom skills in `/Users/hhhuang/.dotfiles/ai/skills/` and `/Users/hhhuang/.dotfiles/ai/commands/`, maps the dependency chain when `/build-feature` runs, and identifies token usage patterns and optimization opportunities.

## Architecture

The skill system has three layers:

1. **Commands** (`commands/*.md`) — thin wrappers that load a skill and pass arguments. 8-107 lines each.
2. **Skills** (`skills/*/SKILL.md`) — the actual workflow logic. 76-413 lines each.
3. **Rules** (`rules/*.md`) — always-loaded CLAUDE.md instructions. 10-41 lines each.
4. **Visual-explainer references** (`skills/visual-explainer/references/` and `templates/`) — read on-demand by visual-explainer. 212-1733 lines each.

## Key Files

| File | Lines | Role |
|------|-------|------|
| `skills/build-feature/SKILL.md` | 164 | Orchestrator — chains research → plan → implement |
| `skills/research/SKILL.md` | 96 | Phase 1: deep codebase investigation |
| `skills/plan/SKILL.md` | 175 | Phase 2: plan writing + annotation cycles |
| `skills/implement/SKILL.md` | 111 | Phase 3: execute plan with TDD |
| `skills/visual-explainer/SKILL.md` | 413 | HTML diagram generation (loaded at each phase transition) |
| `skills/api-design/SKILL.md` | 79 | Reference: REST API patterns (loaded by plan if API work detected) |
| `skills/frontend-patterns/SKILL.md` | 76 | Reference: frontend patterns (loaded by plan if frontend work detected) |
| `commands/diff-review.md` | 68 | Command: visual diff review |
| `commands/fact-check.md` | 63 | Command: verify document accuracy |
| `commands/generate-visual-plan.md` | 107 | Command: HTML implementation plan |
| `commands/generate-web-diagram.md` | 10 | Command: generic HTML diagram |
| `commands/project-recap.md` | 61 | Command: project mental model snapshot |
| `commands/plan-review.md` | 86 | Command: plan vs codebase comparison |
| `commands/model-route.md` | 35 | Command: model tier recommendation |
| `rules/coding-style.md` | 12 | Always loaded in CLAUDE.md |
| `rules/testing.md` | 10 | Always loaded in CLAUDE.md |
| `rules/security.md` | 10 | Always loaded in CLAUDE.md |
| `rules/performance.md` | 20 | Always loaded in CLAUDE.md |
| `rules/git-workflow.md` | 41 | Always loaded in CLAUDE.md |
| `visual-explainer/references/css-patterns.md` | 1733 | CSS reference (read by VE before generating) |
| `visual-explainer/references/libraries.md` | 543 | Library/CDN reference |
| `visual-explainer/references/responsive-nav.md` | 212 | Nav patterns for multi-section pages |
| `visual-explainer/references/slide-patterns.md` | 1403 | Slide deck patterns |
| `visual-explainer/templates/architecture.html` | 596 | Template for architecture diagrams |
| `visual-explainer/templates/data-table.html` | 540 | Template for data tables |
| `visual-explainer/templates/mermaid-flowchart.html` | 435 | Template for flowcharts |
| `visual-explainer/templates/slide-deck.html` | 913 | Template for slide decks |

## MUST Steps by Skill

### build-feature/SKILL.md

| # | Mandatory Step | Keyword |
|---|---------------|---------|
| 1 | After research phase completes, STOP and tell the user | "Wait for the user to confirm before proceeding" |
| 2 | Plan phase complete when user explicitly approves | "explicitly approves" |
| 3 | Wait for user to trigger implementation | "Wait for the user to trigger implementation" |
| 4 | Never write code before plan is approved | "Never write code before the plan is approved" |

### research/SKILL.md

| # | Mandatory Step | Keyword |
|---|---------------|---------|
| 1 | Document MUST include: Overview, Architecture, Key Files, Data Flow, Patterns & Conventions, Dependencies, Edge Cases & Gotchas, Current State | "MUST include" |
| 2 | Generate visual architecture diagram; output MUST be written to `architecture.html` | "MUST be written" |
| 3 | Do NOT proceed to planning or implementation | "Do NOT proceed" |
| 4 | Do NOT make changes to any code during research | "Do NOT make changes" |
| 5 | Do NOT propose solutions or plans | "Do NOT propose" |

### plan/SKILL.md

| # | Mandatory Step | Keyword |
|---|---------------|---------|
| 1 | Never write code until plan is reviewed and approved | "Never write code" |
| 2 | Testing Strategy MUST include concrete, specific test cases | "MUST include" |
| 3 | Every test case in Testing Strategy MUST appear as a task in Todo List | "MUST appear" |
| 4 | Test tasks are mandatory in the Todo List | "mandatory" |
| 5 | Todo List MUST include tasks for every test case from Testing Strategy | "MUST include" |
| 6 | Do NOT implement yet (after annotation cycle) | "Do NOT implement" |
| 7 | Visual plan output MUST be written to `visual-plan.html` | "MUST be written" |
| 8 | Still do NOT implement (after visual plan generated) | "do NOT implement" |
| 9 | Every annotation from the user must be addressed; never ignore feedback | "never ignore" |

### implement/SKILL.md

| # | Mandatory Step | Keyword |
|---|---------------|---------|
| 1 | MUST use the `test-driven-development` skill (superpowers) | "MUST use" |
| 2 | TDD is non-negotiable | "non-negotiable" |
| 3 | Each change MUST have test coverage — hard requirement | "MUST have", "hard requirement" |
| 4 | Test structure: maximize shared setup | "Maximize shared setup" |
| 5 | MUST run systematic verification loop (type check, lint, test, build) — not optional | "MUST run", "not optional" |
| 6 | MUST scan changed files for security issues — not optional | "MUST scan", "not optional" |
| 7 | MUST invoke `/simplify` | "MUST invoke" |
| 8 | MUST review all changed files with quality lens — not optional | "MUST review", "not optional" |
| 9 | MUST invoke `/fact-check` on plan document — not optional | "MUST invoke", "not optional" |
| 10 | NEVER commit to version control | "NEVER commit" |

### visual-explainer/SKILL.md

| # | Mandatory Step | Keyword |
|---|---------------|---------|
| 1 | Never fall back to ASCII art when this skill is loaded | "Never fall back" |
| 2 | Always use `theme: 'base'` with custom themeVariables for Mermaid | "Always use" |
| 3 | Always center Mermaid diagrams | "Always center" |
| 4 | Every `.mermaid-wrap` container must have zoom controls | "must have" |
| 5 | Never define `.node` as a page-level CSS class | "Never define" |
| 6 | Multi-line node labels: never use `\n` — use `<br/>` | "never use" |
| 7 | Forbidden fonts, colors, animations, and patterns (extensive list) | "Forbidden", "never" |

## Data Flow: What Happens When `/build-feature` Runs

### Token loading sequence

```
User runs: /build-feature <description>

1. commands/build-feature.md loaded (11 lines)
   → "Load the build-feature skill"

2. skills/build-feature/SKILL.md loaded (164 lines)
   → Phase 1: "Use the Skill tool to invoke `research`"

3. skills/research/SKILL.md loaded (96 lines)
   → [User does research work]
   → "invoke /generate-web-diagram"

4. skills/visual-explainer/SKILL.md loaded (413 lines)
   → VE reads references: css-patterns.md (1733), libraries.md (543)
   → VE reads template: architecture.html (596) or mermaid-flowchart.html (435)
   → [Generates architecture.html]

   --- PHASE GATE: User confirms research ---

5. skills/plan/SKILL.md loaded (175 lines)
   → Step 1b: MAY load frontend-patterns/SKILL.md (76 lines) if frontend detected
   → Step 1c: MAY load api-design/SKILL.md (79 lines) if API work detected
   → [User annotation cycles]
   → Step 6: "invoke /generate-visual-plan"

6. commands/generate-visual-plan.md loaded (107 lines)
   → "Load the visual-explainer skill"

7. skills/visual-explainer/SKILL.md loaded AGAIN (413 lines)
   → VE reads references AGAIN: css-patterns.md (1733), libraries.md (543)
   → VE reads template AGAIN
   → [Generates visual-plan.html]

   --- PHASE GATE: User approves plan ---

8. skills/implement/SKILL.md loaded (111 lines)
   → "MUST use the `test-driven-development` skill"

9. superpowers:test-driven-development loaded (~lines unknown, external)
   → [Implementation work]
   → Step 7: "MUST invoke /simplify"

10. simplify skill loaded (external — from superpowers or similar)
    → [Code review pass]

11. Step 9: "MUST invoke /fact-check"

12. commands/fact-check.md loaded (63 lines)
    → "Load the visual-explainer skill"

13. skills/visual-explainer/SKILL.md loaded AGAIN (413 lines)
    → VE reads css-patterns.md AGAIN (1733 lines) for styling the verification summary

    --- build-feature orchestrator resumes ---

14. Diff review: "follow the /diff-review workflow"

15. commands/diff-review.md loaded (68 lines)
    → "Load the visual-explainer skill"

16. skills/visual-explainer/SKILL.md loaded AGAIN (413 lines)
    → VE reads references AGAIN: css-patterns.md (1733), libraries.md (543)
    → VE reads template AGAIN
    → [Generates diff-review.html]

17. Fact-check on diff review: another /fact-check invocation
    → VE loaded AGAIN
```

### Token consumption estimate (a single /build-feature run)

**Always-loaded (rules in CLAUDE.md):** ~93 lines
- coding-style.md: 12
- testing.md: 10
- security.md: 10
- performance.md: 20
- git-workflow.md: 41

**Skill loading (cumulative through workflow):**

| Load event | Content | Lines |
|-----------|---------|-------|
| build-feature command | commands/build-feature.md | 11 |
| build-feature skill | skills/build-feature/SKILL.md | 164 |
| research skill | skills/research/SKILL.md | 96 |
| VE skill (1st load — architecture diagram) | skills/visual-explainer/SKILL.md | 413 |
| VE references (1st) | css-patterns.md + libraries.md | ~2,276 |
| VE template (1st) | architecture.html or mermaid-flowchart.html | ~596 |
| plan skill | skills/plan/SKILL.md | 175 |
| VE skill (2nd load — visual plan) | skills/visual-explainer/SKILL.md | 413 |
| VE references (2nd) | css-patterns.md + libraries.md | ~2,276 |
| generate-visual-plan command | commands/generate-visual-plan.md | 107 |
| implement skill | skills/implement/SKILL.md | 111 |
| TDD skill (superpowers) | external | ~100+ |
| simplify skill | external | ~50+ |
| fact-check command | commands/fact-check.md | 63 |
| VE skill (3rd load — fact-check styling) | skills/visual-explainer/SKILL.md | 413 |
| VE references (3rd) | css-patterns.md | ~1,733 |
| diff-review command | commands/diff-review.md | 68 |
| VE skill (4th load — diff review) | skills/visual-explainer/SKILL.md | 413 |
| VE references (4th) | css-patterns.md + libraries.md | ~2,276 |
| fact-check (2nd — on diff review) | commands/fact-check.md | 63 |
| VE skill (5th load) | skills/visual-explainer/SKILL.md | 413 |
| VE references (5th) | css-patterns.md | ~1,733 |

**Estimated total skill content loaded:** ~13,700+ lines

**Key observation:** The visual-explainer SKILL.md (413 lines) gets loaded 4-5 times. Its references (css-patterns.md at 1,733 lines, libraries.md at 543 lines) get read 3-5 times each. This is by far the biggest token consumer.

## Patterns & Conventions

### Mandatory step enforcement mechanisms
The skills use several patterns to express mandatory behavior:
1. **"MUST" + description** — strongest signal (implement/SKILL.md uses this 6 times)
2. **"non-negotiable"** — used for TDD requirement
3. **"not optional"** — used for verification, security, code review, fact-check
4. **"Do NOT" / "NEVER"** — prohibitions
5. **"mandatory"** — used for test tasks

### Rule coverage gaps
The current rules (93 lines total) are concise but don't explicitly enforce several behaviors that the skills mandate:

| Skill MUST Step | Corresponding Rule | Gap? |
|----------------|-------------------|------|
| TDD (implement) | testing.md: "TDD is the default" | Partial — rule says "default", skill says "non-negotiable" |
| Security scan (implement) | security.md exists | Partial — rule lists principles but doesn't mandate a scan pass |
| Verification loop (implement) | None | **GAP** — no rule requires type-check/lint/test/build loop |
| `/simplify` pass (implement) | coding-style.md partial overlap | **GAP** — no rule requires a simplify/review pass |
| `/fact-check` on plan (implement) | None | **GAP** — no rule requires fact-checking |
| Code review pass (implement) | coding-style.md partial overlap | **GAP** — no rule requires self-review of changed files |
| Never commit (implement) | git-workflow.md doesn't mention this | **GAP** — no rule says "don't auto-commit" |
| Max shared test setup (implement) | testing.md: "Maximize shared setup" | Covered |
| Every annotation addressed (plan) | None | **GAP** — no rule about annotation handling |

## Dependencies

### Internal dependencies (skill → skill)
- `build-feature` → `research`, `plan`, `implement`
- `research` → `visual-explainer` (via `/generate-web-diagram`)
- `plan` → `visual-explainer` (via `/generate-visual-plan`), optionally `api-design`, `frontend-patterns`
- `implement` → `visual-explainer` (via `/fact-check`, `/diff-review`), `simplify` (external), `test-driven-development` (external/superpowers)

### External dependencies (superpowers)
- `superpowers:test-driven-development` — loaded by implement
- `superpowers:simplify` or equivalent `/simplify` — loaded by implement
- `superpowers:brainstorming` — loaded by using-superpowers before any creative work
- `superpowers:verification-before-completion` — overlaps with implement's verification loop

## Edge Cases & Gotchas

1. **`/simplify` references a skill that doesn't exist in the user's skills directory.** It appears in the skill registry (system-reminder lists it as `simplify: Review changed code for reuse, quality, and efficiency, then fix any issues found`) but there's no `skills/simplify/SKILL.md` in the dotfiles. It may come from superpowers or another plugin.

2. **Visual-explainer's repeated loading is the dominant token cost.** Each load of VE + its references costs ~2,700-3,300 lines. This happens 4-5 times in a full `/build-feature` run.

3. **The `using-superpowers` skill triggers brainstorming before creative work.** This means `/build-feature` may also trigger brainstorming, adding more skill loading overhead.

4. **Rules say "TDD is the default" but implement says "TDD is non-negotiable".** The rule's softer language ("default") doesn't match the skill's mandate.

5. **No rule enforces the verification loop.** The implement skill mandates type-check → lint → test → build, but there's no rule in `rules/` that would enforce this outside the implement skill context.

6. **Context compaction risk.** In a long `/build-feature` session, earlier skill content gets compacted. The MUST steps from earlier phases may be lost from context, though the persistent markdown artifacts compensate.

## Current State

### Strengths
- Skills are well-structured with clear phase gates
- Mandatory steps are explicitly marked with strong language
- Persistent artifacts (research.md, plan.md) survive context compaction
- Visual integration is gracefully optional

### Weaknesses
- Rules don't mirror all skill MUST steps → inconsistent enforcement outside skill context
- Massive token overhead from repeated VE loading (~10,000+ lines across a full run)
- No mechanism to avoid re-reading VE references within a single session
- Some MUST steps reference external skills (simplify, TDD) that may or may not be present
- The `generate-visual-plan.md` command (107 lines) duplicates much of what VE already knows about implementation plans
