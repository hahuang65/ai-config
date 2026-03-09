# Research: Skill & Command Token Optimization

## Overview

This document catalogs the token footprint of every skill, command, agent, and rule file in the dotfiles-ai system. It maps what gets loaded during a `/build-feature` run, identifies redundancy patterns, and proposes optimization opportunities — all while preserving every MUST step and workflow requirement.

## Architecture

The system has four layers:

1. **Rules** (`rules/*.md`) — constraints that skills and agents must follow. Loaded into context as CLAUDE.md global instructions. Always present.
2. **Skills** (`skills/*/SKILL.md`) — multi-step workflows invoked via the Skill tool. Each loads its full SKILL.md into context.
3. **Commands** (`commands/*.md`) — thin wrappers that load a skill and pass arguments. Also used as standalone "prompt templates" for visual-explainer outputs.
4. **Agents** (`agents/*.md`) — specialized sub-agents invoked via the Agent tool. Each gets its own context window.

## Key Files: Size Inventory

### Skills (7 files, 70,590 chars total)

| File | Lines | Chars | Notes |
|------|-------|-------|-------|
| `skills/visual-explainer/SKILL.md` | 413 | 33,179 | **Largest file in system.** Loaded every time any VE command runs. |
| `skills/plan/SKILL.md` | 185 | 10,598 | Loaded once per /plan or /build-feature Phase 2 |
| `skills/build-feature/SKILL.md` | 164 | 8,079 | Orchestrator. Loaded once at start. |
| `skills/implement/SKILL.md` | 101 | 7,872 | Loaded once per /implement or /build-feature Phase 3 |
| `skills/research/SKILL.md` | 96 | 4,815 | Loaded once per /research or /build-feature Phase 1 |
| `skills/frontend-patterns/SKILL.md` | 76 | 3,598 | Optional, loaded by /plan when frontend detected |
| `skills/api-design/SKILL.md` | 79 | 2,349 | Optional, loaded by /plan when API detected |

### Commands (12 files, 45,670 chars total)

| File | Lines | Chars | Notes |
|------|-------|-------|-------|
| `commands/plan-review.md` | 86 | 9,606 | Standalone VE command |
| `commands/diff-review.md` | 68 | 8,747 | Used in /build-feature Phase 3 |
| `commands/generate-visual-plan.md` | 107 | 7,526 | Used in /plan Step 6 and /implement Step 13 |
| `commands/project-recap.md` | 61 | 7,496 | Standalone VE command |
| `commands/fact-check.md` | 63 | 4,784 | Used in /implement Step 12 and /build-feature Phase 3 |
| `commands/generate-slides.md` | 18 | 2,399 | Standalone VE command |
| `commands/model-route.md` | 35 | 1,384 | Standalone utility |
| `commands/generate-web-diagram.md` | 10 | 1,295 | Used in /research Step 4 |
| `commands/build-feature.md` | 11 | 668 | Thin wrapper → build-feature skill |
| `commands/plan.md` | 8 | 615 | Thin wrapper → plan skill |
| `commands/research.md` | 8 | 581 | Thin wrapper → research skill |
| `commands/implement.md` | 8 | 569 | Thin wrapper → implement skill |

### Agents (7 files, 21,230 chars total)

| File | Lines | Chars | Notes |
|------|-------|-------|-------|
| `agents/code-reviewer.md` | 106 | 4,376 | Used in /implement Step 10 |
| `agents/security-reviewer.md` | 80 | 3,386 | Used in /implement Step 6 |
| `agents/architect.md` | 97 | 3,081 | Used in /plan Step 1c |
| `agents/database-reviewer.md` | 71 | 2,954 | Conditional: /implement Step 7 |
| `agents/tdd-guide.md` | 79 | 2,614 | Used in /implement Step 2 |
| `agents/refactor-cleaner.md` | 76 | 2,565 | Used in /implement Step 9 |
| `agents/doc-updater.md` | 62 | 2,254 | Conditional: /implement Step 11 |

### Rules (6 files, 6,322 chars total — always loaded)

| File | Lines | Chars |
|------|-------|-------|
| `rules/git-workflow.md` | 41 | 1,327 |
| `rules/performance.md` | 20 | 1,174 |
| `rules/security.md` | 10 | 1,136 |
| `rules/coding-style.md` | 12 | 1,013 |
| `rules/testing.md` | 10 | 948 |
| `rules/development-workflow.md` | 26 | 724 |

### Visual-Explainer References & Templates (read during VE invocations)

| File | Lines | Chars | When read |
|------|-------|-------|-----------|
| `references/css-patterns.md` | 1,733 | 42,300 | Every VE invocation |
| `references/slide-patterns.md` | 1,403 | 44,900 | Only /generate-slides |
| `references/libraries.md` | 543 | 19,200 | Every VE invocation |
| `references/responsive-nav.md` | 212 | 5,800 | Pages with 4+ sections |
| `templates/slide-deck.html` | 913 | 34,700 | Only /generate-slides |
| `templates/architecture.html` | 596 | 17,500 | Architecture diagrams |
| `templates/data-table.html` | 540 | 16,200 | Table-heavy pages |
| `templates/mermaid-flowchart.html` | 435 | 13,100 | Mermaid diagrams |

## Data Flow: What Loads During /build-feature

### Phase 1: Research

| Step | What loads | Chars |
|------|-----------|-------|
| Orchestrator | build-feature/SKILL.md | 8,079 |
| Research skill | research/SKILL.md | 4,815 |
| Architecture diagram | generate-web-diagram command | 1,295 |
| VE skill (1st load) | visual-explainer/SKILL.md | 33,179 |
| VE references | css-patterns.md + libraries.md + template | ~78,800 |
| **Phase 1 subtotal** | | **~126,168** |

### Phase 2: Plan

| Step | What loads | Chars |
|------|-----------|-------|
| Plan skill | plan/SKILL.md | 10,598 |
| Architect agent | architect.md (own context) | 3,081 |
| Visual plan | generate-visual-plan command | 7,526 |
| VE skill (2nd load) | visual-explainer/SKILL.md | 33,179 |
| VE references | css-patterns.md + libraries.md + template | ~78,800 |
| **Phase 2 subtotal** | | **~133,184** |

### Phase 3: Implement

| Step | What loads | Chars |
|------|-----------|-------|
| Implement skill | implement/SKILL.md | 7,872 |
| TDD guide agent | tdd-guide.md (own context) | 2,614 |
| Security reviewer agent | security-reviewer.md (own context) | 3,386 |
| Refactor cleaner agent | refactor-cleaner.md (own context) | 2,565 |
| Code reviewer agent | code-reviewer.md (own context) | 4,376 |
| Fact-check plan | fact-check command | 4,784 |
| VE skill (3rd load) | visual-explainer/SKILL.md | 33,179 |
| VE reference | css-patterns.md | 42,300 |
| Visual plan refresh (if needed) | generate-visual-plan command | 7,526 |
| VE skill (4th load) | visual-explainer/SKILL.md | 33,179 |
| VE references | css-patterns.md + libraries.md + template | ~78,800 |
| Diff review | diff-review command | 8,747 |
| VE skill (5th load) | visual-explainer/SKILL.md | 33,179 |
| VE references | css-patterns.md + libraries.md + template | ~78,800 |
| Fact-check diff review | fact-check command | 4,784 |
| VE skill (6th load) | visual-explainer/SKILL.md | 33,179 |
| VE reference | css-patterns.md | 42,300 |
| **Phase 3 subtotal** | | **~421,570** |

### Grand Total: ~680,922 chars loaded in a full /build-feature run

**Note:** Agents run in their own context windows so their chars don't count toward the main conversation's token budget. The main conversation token cost is approximately:

- Skills + commands loading into main context: ~300K chars (excluding agent-only loads)
- VE reloads account for: 33,179 × 6 = ~199K chars (VE SKILL.md alone)
- VE reference re-reads account for: ~78,800 × 4-5 = ~315-394K chars

## Patterns & Redundancy Analysis

### Pattern 1: Visual-Explainer Reload Problem (BIGGEST issue)

The VE skill (33K chars) loads every time any VE command is invoked. In a full /build-feature run, it loads **4-6 times**:
1. `/generate-web-diagram` (research phase)
2. `/generate-visual-plan` (plan phase)
3. `/fact-check` on plan (implement phase)
4. `/generate-visual-plan` refresh (implement phase, conditional)
5. `/diff-review` (implement phase)
6. `/fact-check` on diff-review (implement phase)

Each load also re-reads reference files (css-patterns.md at 42K, libraries.md at 19K, plus a template at 13-17K).

**Total VE waste per /build-feature run: ~199K (SKILL.md) + ~315K (references) = ~514K chars of redundant reloads.**

### Pattern 2: Command Files as Mega-Prompts

The VE-based commands (diff-review, plan-review, generate-visual-plan, project-recap, fact-check) are not thin wrappers — they are **self-contained mega-prompts** averaging 4.8-9.6K chars each. They contain:

- Detailed section-by-section structure definitions (what sections to include)
- Data gathering instructions (what git commands to run, what files to read)
- Verification checkpoint instructions (extract claims, verify, produce fact sheet)
- Visual treatment notes (overflow prevention, Mermaid zoom, surface depth)

These are **complementary to** (not redundant with) the VE skill. The VE skill says "how to make good HTML" while commands say "what content this specific page should have." However, they **do repeat** certain VE patterns:

#### Repeated across multiple commands:
- **"Overflow prevention"** block (min-width: 0, overflow-wrap, no flex on `<li>`) — appears in: diff-review, plan-review, generate-visual-plan (3 times, ~100 chars each)
- **"Mermaid zoom controls"** reference — appears in: diff-review, plan-review, generate-visual-plan, project-recap (4 times, ~80 chars each)
- **"Verification checkpoint"** block — appears in: diff-review, plan-review, project-recap, generate-visual-plan (4 times, ~300-400 chars each)
- **"Write to docs/claude/... Open in browser"** — appears in: ALL visual commands (6 times, ~150 chars each)
- **"Optional surf illustrations"** block — appears in: diff-review, plan-review, project-recap, generate-visual-plan, generate-web-diagram (5 times, ~150 chars each)
- **"Ultrathink"** — appears in: diff-review, plan-review, project-recap, fact-check (4 times)
- **"Visual hierarchy"** guidance — appears in: diff-review, plan-review, generate-visual-plan (3 times, ~150 chars each)
- **VE preamble** ("Load the visual-explainer skill... references at ~/.claude/skills/visual-explainer/references/...") — appears in: ALL visual commands (7 times, ~250 chars each)

Total repeated boilerplate across commands: ~5,000-7,000 chars

### Pattern 3: Skill Prose Verbosity

Some skill sections use multiple sentences where bullet points would suffice:

- `implement/SKILL.md` "Feedback Loop" section (lines 69-80): 12 lines that could be 4
- `implement/SKILL.md` "Referencing Existing Code" (lines 82-83): 2 lines repeating what's obvious
- `plan/SKILL.md` annotation example block (lines 107-121): 15 lines of example that could be 5
- `build-feature/SKILL.md` "Visual-Explainer Integration Notes" (lines 147-157): 11 lines repeating what's already clear from the workflow

### Pattern 4: fact-check Loads VE Unnecessarily

`fact-check.md` starts with "Load the visual-explainer skill" even though fact-checking a markdown file doesn't need VE at all. It only needs css-patterns.md for HTML file styling. Loading the full 33K VE skill is wasteful when only ~1K of css-patterns.md context is needed for the verification summary banner.

## Edge Cases & Gotchas

1. **Context compaction**: In long sessions, earlier skill loads get compacted but the same skill reloads at full size. This means VE reloads after compaction are especially wasteful since the compacted context already has the gist.

2. **Agent context isolation**: Agents get their own context, so their file sizes don't pollute the main conversation. However, agents that invoke skills (which none currently do) would create nested context cost.

3. **Rules are always loaded**: The 6,322 chars of rules are always in context as CLAUDE.md instructions. This is not redundant — it's by design. Rules should NOT be moved to on-demand loading.

4. **Command descriptions in skill listings**: The system-reminder listing available skills includes the `description` field from each command's frontmatter. This is unavoidable overhead (~2K chars) but not actionable.

5. **Slide-specific content**: `slide-patterns.md` (44.9K) and `slide-deck.html` (34.7K) only load for `/generate-slides`. These are already optimized — they don't load during /build-feature.

## Current State: Optimization Opportunities Summary

### High Impact (>50K chars savings per /build-feature run)

1. **Eliminate VE reloads** — The VE skill loads 4-6 times at 33K each. If it loaded once and subsequent commands said "follow the VE workflow already loaded," savings: **~133-166K chars**.

2. **Eliminate VE reference re-reads** — css-patterns.md (42K) and libraries.md (19K) are re-read 4-5 times each. If read once and cached in context, savings: **~183-244K chars**.

3. **Make fact-check not load VE** — fact-check only needs css-patterns.md for HTML styling, not the full VE skill. Savings: **~33K chars per invocation** (invoked twice in a full run = ~66K).

### Medium Impact (5-30K chars savings)

4. **Extract shared command boilerplate** — Move repeated patterns (overflow prevention, Mermaid zoom, verification checkpoint, output location, surf illustrations) to a shared reference that commands point to instead of inlining. Savings: **~5-7K chars** across commands.

5. **Tighten skill prose** — Compress verbose sections in implement, plan, and build-feature skills. Savings: **~2-4K chars**.

6. **Split VE SKILL.md** — The 33K VE skill contains sections only relevant to specific diagram types (slide deck mode: lines 291-309 = ~2K, anti-patterns: lines 346-413 = ~3K). These could be moved to reference files read only when needed. Savings: **~5K chars per VE load**.

### Low Impact (<5K chars savings)

7. **Compress command descriptions** — The thin wrapper commands (build-feature, plan, research, implement) are already minimal at 569-668 chars each.

8. **Deduplicate "Write to docs/claude/" instructions** — This appears in every command but is only ~150 chars each. Not worth extracting.
