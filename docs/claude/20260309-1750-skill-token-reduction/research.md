# Research: Skill Token Usage — Can We Reduce It Further?

## Overview

This research examines the full token cost picture of the Claude Code skill system at `~/.dotfiles/ai/`, identifies what optimizations have already been done, and maps the remaining opportunities for further reduction. The system comprises 7 skills, 12 commands, 7 agents, and 6 rules that orchestrate a research → plan → implement feature development pipeline with rich HTML visual outputs.

## Architecture

Four layers, each with different loading behavior:

1. **Rules** (`rules/*.md`) — 6 files, 6,322 chars total. Loaded into context as global CLAUDE.md instructions at session start. Always present. Non-negotiable overhead.

2. **Skills** (`skills/*/SKILL.md`) — 7 skills, 70,290 chars total. Loaded on-demand when invoked via the `Skill` tool. The frontmatter `description` fields appear in the system-reminder skill listing (~2K chars, always present).

3. **Commands** (`commands/*.md`) — 12 files, 39,412 chars total. Thin wrappers or self-contained prompt templates. Loaded when the user types `/command-name`. Some trigger skill loads.

4. **Agents** (`agents/*.md`) — 7 files, 21,230 chars total. Run in separate context windows via the Agent tool. Their token cost does NOT count against the main conversation — they're isolated.

## Key Files: Current Size Inventory

### Always in context (session startup)

| Source | Content | Chars |
|--------|---------|-------|
| Rules (6 files) | coding-style, testing, security, performance, git-workflow, development-workflow | 6,322 |
| System-reminder skill listing | Descriptions of all 26 available skills/commands | ~2,500 (estimated) |
| **Total always-loaded** | | **~8,822** |

### Skills (loaded on-demand)

| File | Chars | Lines | When loaded |
|------|-------|-------|-------------|
| `visual-explainer/SKILL.md` | 33,179 | 413 | Only `/generate-web-diagram` (general-purpose VE) |
| `plan/SKILL.md` | 10,246 | 177 | `/plan`, `/build-feature` Phase 2 |
| `build-feature/SKILL.md` | 8,079 | 164 | `/build-feature` |
| `implement/SKILL.md` | 8,011 | 101 | `/implement`, `/build-feature` Phase 3 |
| `research/SKILL.md` | 4,828 | 98 | `/research`, `/build-feature` Phase 1 |
| `visual-explainer/core.md` | 5,483 | 93 | Read by VE commands instead of full SKILL.md |
| `frontend-patterns/SKILL.md` | 3,598 | 76 | Conditional: `/plan` if frontend detected |
| `api-design/SKILL.md` | 2,349 | 79 | Conditional: `/plan` if API detected |

### Commands (loaded on-demand)

| File | Chars | Lines | Triggers skill load? |
|------|-------|-------|---------------------|
| `plan-review.md` | 8,087 | 84 | No — reads core.md + references |
| `diff-review.md` | 7,293 | 66 | No — reads core.md + references |
| `project-recap.md` | 5,962 | 59 | No — reads core.md + references |
| `generate-visual-plan.md` | 5,949 | 85 | No — reads core.md + references |
| `fact-check.md` | 4,842 | 61 | No — fully decoupled from VE |
| `generate-slides.md` | 2,167 | 21 | No — reads core.md + slide refs |
| `generate-web-diagram.md` | 1,295 | 10 | **Yes — loads full VE SKILL.md** |
| `model-route.md` | 1,384 | 35 | No |
| `build-feature.md` | 668 | 11 | Yes — loads build-feature skill |
| `plan.md` | 615 | 8 | Yes — loads plan skill |
| `research.md` | 581 | 8 | Yes — loads research skill |
| `implement.md` | 569 | 8 | Yes — loads implement skill |

### VE Reference Files (read on-demand by commands)

| File | Chars | Lines | Read by |
|------|-------|-------|---------|
| `references/slide-patterns.md` | 44,903 | 1,403 | `/generate-slides` only |
| `references/css-patterns.md` | 42,275 | 1,733 | Most VE commands |
| `references/libraries.md` | 19,156 | 543 | Most VE commands |
| `references/responsive-nav.md` | 5,817 | 212 | Pages with 4+ sections |
| `templates/slide-deck.html` | 34,683 | 913 | `/generate-slides` only |
| `templates/architecture.html` | 17,466 | 596 | Architecture diagrams |
| `templates/mermaid-flowchart.html` | 13,126 | 435 | Flowchart diagrams |
| `templates/data-table.html` | 16,248 | 540 | Table-heavy pages |

### Agents (isolated context — no main window cost)

| File | Chars | Invoked by |
|------|-------|------------|
| `code-reviewer.md` | 4,376 | `/implement` Step 10 |
| `security-reviewer.md` | 3,386 | `/implement` Step 6 |
| `architect.md` | 3,081 | `/plan` Step 1b |
| `database-reviewer.md` | 2,954 | `/implement` Step 7 (conditional) |
| `tdd-guide.md` | 2,614 | `/implement` Step 2 (per task) |
| `refactor-cleaner.md` | 2,565 | `/implement` Step 9 |
| `doc-updater.md` | 2,254 | `/implement` Step 11 (conditional) |

## Data Flow: What Loads During Key Workflows

### Workflow: `/build-feature` (full pipeline)

#### Phase 1: Research

| What loads into main context | Chars |
|------------------------------|-------|
| `build-feature/SKILL.md` | 8,079 |
| `research/SKILL.md` | 4,828 |
| `generate-web-diagram.md` command | 1,295 |
| `visual-explainer/SKILL.md` (full load via generate-web-diagram) | 33,179 |
| `css-patterns.md` + `libraries.md` + template (~17K) | ~78,900 |
| **Phase 1 subtotal** | **~126,281** |

#### Phase 2: Plan

| What loads into main context | Chars |
|------------------------------|-------|
| `plan/SKILL.md` | 10,246 |
| `generate-visual-plan.md` command | 5,949 |
| `core.md` (read, not skill-loaded) | 5,483 |
| `css-patterns.md` + `libraries.md` (read) | ~61,431 |
| `architect.md` agent (own context — 0 main cost) | 0 |
| **Phase 2 subtotal** | **~83,109** |

#### Phase 3: Implement

| What loads into main context | Chars |
|------------------------------|-------|
| `implement/SKILL.md` | 8,011 |
| `fact-check.md` command (on plan.md) | 4,842 |
| `generate-visual-plan.md` command (refresh, conditional) | 5,949 |
| `core.md` (read for visual-plan refresh) | 5,483 |
| `css-patterns.md` + `libraries.md` (read for visual-plan refresh) | ~61,431 |
| Agents (tdd, security, code-review, refactor, etc.) | 0 (own context) |
| **Phase 3 subtotal** | **~85,716** |

**Note:** Phase 3 previously included a diff-review + fact-check on the diff-review. The diff-review is now done by the build-feature orchestrator *after* implement finishes, not by the implement skill itself. Including the orchestrator's diff-review step:

| Diff-review (orchestrator) | Chars |
|----------------------------|-------|
| `diff-review.md` command | 7,293 |
| `core.md` (read) | 5,483 |
| `css-patterns.md` + `libraries.md` (read) | ~61,431 |
| `fact-check.md` on diff-review HTML | 4,842 |
| **Diff-review subtotal** | **~79,049** |

#### Grand Total: /build-feature

| Phase | Current (chars) |
|-------|-----------------|
| Phase 1: Research | ~126,281 |
| Phase 2: Plan | ~83,109 |
| Phase 3: Implement | ~85,716 |
| Diff-review (orchestrator) | ~79,049 |
| **Total** | **~374,155** |

**Compared to pre-optimization:** The previous research estimated ~681K chars. The core.md optimization already saved ~307K chars (~45%). The remaining ~374K is the current baseline.

### Workflow: Standalone `/research`

| What loads | Chars |
|------------|-------|
| `research/SKILL.md` | 4,828 |
| `generate-web-diagram.md` command | 1,295 |
| `visual-explainer/SKILL.md` | 33,179 |
| References + template | ~78,900 |
| **Total** | **~118,202** |

### Workflow: Standalone `/diff-review`

| What loads | Chars |
|------------|-------|
| `diff-review.md` command | 7,293 |
| `core.md` (read) | 5,483 |
| `css-patterns.md` (read) | 42,275 |
| `libraries.md` (read) | 19,156 |
| **Total** | **~74,207** |

### Workflow: Standalone `/plan`

| What loads | Chars |
|------------|-------|
| `plan/SKILL.md` | 10,246 |
| Architect agent (own context) | 0 |
| `generate-visual-plan.md` command | 5,949 |
| `core.md` (read) | 5,483 |
| `css-patterns.md` + `libraries.md` | ~61,431 |
| **Total** | **~83,109** |

## Patterns & Observations

### Pattern 1: VE References Are the Dominant Cost

The three VE reference files account for the bulk of token cost in any visual command:

| File | Chars | % of a typical VE command's total load |
|------|-------|----------------------------------------|
| `css-patterns.md` | 42,275 | 57% |
| `libraries.md` | 19,156 | 26% |
| `core.md` | 5,483 | 7% |
| Command file itself | ~5-8K | 7-10% |
| **Total** | ~72-75K | 100% |

The core.md optimization eliminated VE SKILL.md reloads (33K × 5-6 = ~165-199K saved). But each VE command still reads css-patterns.md (42K) and libraries.md (19K) fresh. In a `/build-feature` run with 2-3 visual outputs, that's ~61K × 2-3 = ~122-183K in reference re-reads.

### Pattern 2: css-patterns.md Is Massive and Partially Needed

At 42,275 chars (1,733 lines), `css-patterns.md` is the largest single file that gets read repeatedly. It contains:
- Overflow protection patterns
- Mermaid zoom control JavaScript (~3K)
- Card depth CSS patterns
- Code block styles
- Prose page elements
- SVG connector patterns
- Responsive nav (duplicated partially in `responsive-nav.md`)
- Generated image container styles
- Collapsible sections
- KPI card patterns
- Badge and indicator styles

Not every VE command needs all of these. For example:
- `/diff-review` needs: overflow, Mermaid zoom, card depth, code blocks, badges
- `/generate-visual-plan` needs: overflow, Mermaid zoom, card depth, code blocks, callout boxes
- `/project-recap` needs: overflow, Mermaid zoom, KPI cards, timeline, badges
- A simple architecture diagram needs: overflow, Mermaid zoom, card depth

### Pattern 3: libraries.md Is Partially Redundant with core.md

`libraries.md` (19,156 chars) contains:
- Font pairing recommendations (already summarized in core.md)
- Mermaid theming guide (detailed — not in core.md)
- Chart.js setup guide
- anime.js animation guide
- CDN import snippets

The font section overlaps with core.md's Typography section. The Mermaid theming section is genuinely needed. Chart.js and anime.js are only needed by specific diagram types.

### Pattern 4: Templates Are Read Selectively (Good)

The VE SKILL.md workflow tells the model to read templates based on content type:
- Architecture → `architecture.html` (17K)
- Flowcharts → `mermaid-flowchart.html` (13K)
- Tables → `data-table.html` (16K)
- Slides → `slide-deck.html` (35K)

This is already selective. No waste here.

### Pattern 5: generate-web-diagram Still Loads Full SKILL.md

`/generate-web-diagram` is the only command that still loads the full 33K VE SKILL.md. This is by design — it's the general-purpose command that needs the full diagram type catalog and rendering approach table. But it also means `/research` (which invokes `/generate-web-diagram`) pays the full 33K + references cost.

### Pattern 6: Skill Frontmatter Descriptions Are Always in Context

The system-reminder at session start includes the `description` field of every registered skill and command. With 26 entries (12 commands + 7 skills + 7 third-party skills like `ruby-skills`, `astral:*`), this is an unavoidable ~2-3K always-on cost. Not actionable without uninstalling skills.

### Pattern 7: Rules Are Compact and Proportionate

At 6,322 chars total for 6 rule files, the rules layer is well-optimized. Each file is focused and under 1.5K chars. No redundancy between rules. No further reduction opportunities without losing guidance quality.

### Pattern 8: Agent Context Isolation Is Working Well

All 7 agents run in separate context windows. Their file sizes (21K total) don't pollute the main conversation. The implement skill invokes 5-6 agents per run, but each agent starts fresh with only its own instructions + the code it reads. No optimization needed here.

### Pattern 9: Plan and Implement Skills Have Verbose Sections

| Skill | Section | Lines | Issue |
|-------|---------|-------|-------|
| `plan/SKILL.md` | Annotation example block (lines 101-115) | 15 | Could be 5-6 lines |
| `plan/SKILL.md` | Step 1c domain detection (lines 58-68) | 11 | Detailed but necessary for correct conditional loading |
| `implement/SKILL.md` | Feedback Loop (lines 72-84) | 13 | Could be 5-6 lines |
| `implement/SKILL.md` | Referencing Existing Code (lines 86-87) | 2 | Borderline obvious |
| `build-feature/SKILL.md` | VE Integration Notes (lines 145-156) | 12 | Repeats info from individual phase descriptions |

### Pattern 10: Duplicate Research Skill

The research skill exists at both:
- `/Users/hhhuang/.dotfiles/ai/skills/research/SKILL.md` (source)
- `/Users/hhhuang/.claude/skills/research/SKILL.md` (symlink)

This is by design (install.sh creates symlinks). No duplication issue — they're the same file via symlink.

## Current State: Remaining Optimization Opportunities

### High Impact (>30K savings per /build-feature run)

#### 1. Split css-patterns.md into domain-specific modules

**Current:** Every VE command reads all 42K chars of css-patterns.md, even though each command needs only 30-50% of its content.

**Opportunity:** Split into focused modules:
- `css-core.md` (~12K): Overflow, card depth, code blocks, basic layout — needed by ALL VE commands
- `css-mermaid.md` (~5K): Mermaid zoom controls JS, Mermaid CSS overrides — needed by diagram-producing commands
- `css-prose.md` (~8K): Prose elements, lead paragraphs, pull quotes — needed by editorial/prose pages
- `css-data.md` (~6K): KPI cards, badges, status indicators, tables — needed by dashboards/reviews
- `css-nav.md` (~5K): Responsive section navigation — overlaps with responsive-nav.md
- `css-images.md` (~3K): Generated image containers, hero banners

Commands would read only what they need. For example, `/diff-review` would read `css-core.md` + `css-mermaid.md` + `css-data.md` (~23K) instead of the full 42K.

**Estimated savings:** ~19K per VE command invocation. In a `/build-feature` run with 2-3 visual outputs: ~38-57K savings.

**Risk:** More files to maintain. Must update all commands when splitting. Risk of commands missing a needed module.

#### 2. Slim libraries.md by extracting font section

**Current:** Every VE command reads all 19K of libraries.md, which includes font pairings (already in core.md), Mermaid theming (~8K), Chart.js (~4K), and anime.js (~3K).

**Opportunity:** Since core.md already has the font pairing table, commands that read core.md get redundant font guidance from libraries.md. Could split:
- `mermaid-theming.md` (~8K): The core content every diagram command needs
- `chart-animation.md` (~7K): Chart.js + anime.js — only needed by dashboards/metrics pages
- Leave font pairings in core.md only

Commands needing Mermaid would read `mermaid-theming.md` (~8K) instead of full `libraries.md` (19K).

**Estimated savings:** ~11K per VE command invocation. In a `/build-feature` run: ~22-33K savings.

**Risk:** Mermaid theming guide is valuable as a single cohesive document. Splitting might lose context.

#### 3. Make /research use core.md + selective refs instead of full VE skill

**Current:** `/research` invokes `/generate-web-diagram`, which loads the full 33K VE SKILL.md. Architecture diagrams are a specific, well-defined use case that doesn't need the full diagram type catalog.

**Opportunity:** Create a specialized `/generate-architecture-diagram` command that reads `core.md` + `css-core.md` + `mermaid-theming.md` + `architecture.html` template. Update `/research` to invoke this instead of `/generate-web-diagram`.

**Estimated savings:** 33K (SKILL.md) minus ~5.5K (core.md) = ~27.5K saved. Plus reference savings from selective reads.

**Risk:** Architecture diagrams might occasionally need the full VE type catalog (e.g., hybrid Mermaid + cards pattern). Could mitigate by including the hybrid pattern guidance in the specialized command.

### Medium Impact (5-20K savings)

#### 4. Compress verbose skill sections

Tighten prose in plan, implement, and build-feature skills:
- `plan/SKILL.md` annotation example: 15 lines → 6 lines (~400 chars saved)
- `implement/SKILL.md` Feedback Loop: 13 lines → 5 lines (~500 chars saved)
- `implement/SKILL.md` Referencing Existing Code: 2 lines → removed (~200 chars saved)
- `build-feature/SKILL.md` VE Integration Notes: 12 lines → 4 lines (~600 chars saved)

**Estimated savings:** ~1.7K chars across skills. Modest but zero-risk.

#### 5. Deduplicate responsive-nav.md and css-patterns.md

`responsive-nav.md` (5.8K) contains responsive section navigation patterns. `css-patterns.md` also has navigation-related patterns. If splitting css-patterns.md (opportunity #1), consolidate navigation into one module.

**Estimated savings:** ~3-4K chars if patterns are truly duplicated.

#### 6. Context-aware reference loading in core.md

Add guidance to core.md telling commands to skip `libraries.md` if no Mermaid diagrams are needed, and skip templates if the content type is clear from the command's own instructions.

**Estimated savings:** ~19K per non-Mermaid invocation. Uncertain — depends on how well the model follows conditional read instructions.

### Low Impact (<5K savings)

#### 7. Remove "Ultrathink." directives

"Ultrathink." appears at the end of `research/SKILL.md`, `plan/SKILL.md`, `diff-review.md`, `plan-review.md`, and `project-recap.md`. It's only 11 chars per occurrence but it's cargo-culted — the system already supports reasoning effort level via the `<system-reminder>` tag. Removing it is a cleanup, not a savings.

#### 8. Compress command description lines

The 4 thin wrapper commands (build-feature.md, plan.md, research.md, implement.md) are already minimal at 569-668 chars each. No further reduction.

## Edge Cases & Gotchas

1. **Context compaction recycles reference reads.** In long sessions, earlier css-patterns.md reads get compacted into a summary. When a later VE command reads it again, it's the full 42K entering context on top of the compacted summary. Splitting css-patterns.md would reduce the fresh-read cost even after compaction.

2. **Model quality vs. token savings trade-off.** The VE reference files contain actual CSS/JS code patterns, not just guidance. Cutting content from these files risks degrading HTML output quality (broken zoom controls, ugly Mermaid themes, overflow bugs). Any split must preserve the actual code patterns — only the organization changes.

3. **Skill listing overhead is fixed.** The system-reminder listing all available skills (~2.5K) cannot be reduced without uninstalling skills. This is a fixed cost regardless of optimization.

4. **core.md drift risk.** If SKILL.md changes and core.md isn't updated, VE commands using core.md may produce output inconsistent with `/generate-web-diagram` (which uses full SKILL.md). The comment at the top of core.md warns about this, but there's no automated enforcement.

5. **Command read instructions are suggestions, not guarantees.** Commands say "read these reference files" but the model might skip reads in context-constrained situations or read extra files. The token savings from selective reads depend on the model actually following the instructions.

6. **Agents reading rules.** The implement and plan skills tell the model to "read and comply with all rule files." If the model re-reads rules that are already in context (as CLAUDE.md), that's ~6K of redundant reads. However, rules in CLAUDE.md are loaded as context (not fresh reads), so re-reading them may be negligible cost.

## Summary: Token Budget (Current vs. Theoretical Minimum)

| Workflow | Current | With all optimizations | Savings |
|----------|---------|----------------------|---------|
| `/build-feature` (full) | ~374K | ~280K | ~94K (25%) |
| `/research` | ~118K | ~65K | ~53K (45%) |
| `/diff-review` | ~74K | ~45K | ~29K (39%) |
| `/plan` | ~83K | ~55K | ~28K (34%) |
| `/generate-visual-plan` | ~74K | ~45K | ~29K (39%) |

The biggest remaining wins come from:
1. Splitting css-patterns.md so commands read only what they need (~19K per VE invocation)
2. Making `/research` not load full VE SKILL.md (~27.5K per research invocation)
3. Slimming libraries.md by extracting non-Mermaid content (~11K per VE invocation)

Combined, these three changes would save ~25-45% more on top of the existing 45% savings from the core.md optimization. Total savings from baseline: ~60-70%.

## Comparison to Prior Research

The prior research at `docs/claude/20260309-1639-skill-token-optimization/` focused on the VE SKILL.md reload problem and produced the core.md solution. That optimization was implemented and saved ~307K chars (~45%) per `/build-feature` run.

This research identifies the **next tier** of opportunities: reference file splitting, selective reference loading, and a specialized architecture diagram command. These are smaller wins individually but compound to another ~25% reduction. The diminishing returns are real — each subsequent optimization requires more structural changes for less absolute savings.

**Bottom line:** The VE reload fix was the 80/20 win. Further optimization requires splitting the large reference files, which adds maintenance complexity. Whether the ~25% additional savings justifies 3-4 more files to maintain is a judgment call.
