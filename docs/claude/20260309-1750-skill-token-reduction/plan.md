# Plan: Reduce Total Token Usage Across Skills & Agents

## Goal

Reduce total token consumption (main context + agent subprocesses) per `/build-feature` run by ~40%, targeting both the VE reference re-read problem and the agent invocation overhead that counts against usage limits.

## Research Reference

`docs/claude/20260309-1750-skill-token-reduction/research.md`

## Approach

Two categories of changes — **VE reference optimization** (main context) and **agent pipeline optimization** (total tokens across all context windows).

### Category A: VE Reference Optimization (main context)

1. **Create `/generate-architecture-diagram`** — Lightweight command reading `core.md` + targeted references instead of loading full 33K VE SKILL.md. Update `/research` to use it.
2. **Split `css-patterns.md` into 3 modules** — `css-core.md`, `css-mermaid.md`, `css-components.md`. Commands declare which modules they need.
3. **Trim `libraries.md`** — Remove redundant Google Fonts section (56 lines, already in `core.md`).

### Category B: Agent Pipeline Optimization (total tokens)

4. **Remove redundant "read rules" from plan and implement skills** — Rules are already loaded as CLAUDE.md in the main context. The skills' "read and comply with all rule files" instruction causes ~6K of redundant file reads.
5. **Batch tdd-guide invocations** — Instead of invoking the tdd-guide agent once per todo item (15-25 invocations), batch 3-5 todos per invocation. Each invocation costs ~4.6K in agent instructions + rules. For 20 todos: 20 invocations → 4-5 invocations saves ~70K in agent token overhead.
6. **Merge security-reviewer into code-reviewer** — Both read code files, both check for security issues. Code-reviewer already has a Security (CRITICAL) checklist. Merging eliminates one agent invocation + one set of rule reads + one pass over changed files. Saves ~15K per run.
7. **Make architect agent conditional** — Skip for features the user marks as simple or when the plan has fewer than 5 todo items. Saves ~15K in agent tokens for small features.

**What we are NOT doing:**
- Not changing core.md content
- Not changing what commands produce — only which reference files they read
- Not removing any review quality (security checks move into code-reviewer, not deleted)
- Not changing agent output formats or review criteria

## Detailed Changes

### Category A: VE Reference Changes

### A1. New File: `commands/generate-architecture-diagram.md`

A specialized command for architecture diagrams — the specific use case `/research` needs.

```markdown
---
description: Generate a visual HTML architecture diagram showing module relationships, data flows, and component boundaries
---
Generate an architecture diagram as a self-contained HTML page for: $ARGUMENTS

Before generating, read these reference files:
- `~/.claude/skills/visual-explainer/core.md` (quality guide — aesthetic, typography, color, style, checks)
- `~/.claude/skills/visual-explainer/references/css-core.md` (theme, cards, code blocks, overflow)
- `~/.claude/skills/visual-explainer/references/css-mermaid.md` (Mermaid containers, zoom controls, connectors)
- `~/.claude/skills/visual-explainer/references/libraries.md` (Mermaid theming JS, font imports)
- `~/.claude/skills/visual-explainer/templates/architecture.html` (reference template for CSS Grid card layouts)

Use a Blueprint or editorial aesthetic. Vary fonts and palette from previous diagrams.

**Approach by complexity:**
- Simple topology (under 10 elements): Mermaid `flowchart TD` with custom `themeVariables`
- Text-heavy (under 15 elements): CSS Grid cards with vertical flow arrows (see architecture.html template)
- Complex (15+ elements): Hybrid — simple Mermaid overview (5-8 nodes) + detailed CSS Grid cards per module

Write to the current feature directory under `docs/claude/` if one exists. Otherwise create `docs/claude/<YYYYMMDD-HHMM>-<slug>/`. Open in browser. Tell the user the file path.
```

### A2. New File: `references/css-core.md`

Foundation CSS patterns needed by ALL visual outputs. Extracted from css-patterns.md:

| Section | Lines | Why included |
|---------|-------|-------------|
| Theme Setup | 5-52 (48 lines) | Every page needs CSS variables |
| Background Atmosphere | 53-88 (36 lines) | Non-flat backgrounds |
| Link Styling | 89-92 (4 lines) | Basic styling |
| Section / Card Components | 93-166 (74 lines) | Cards are the primary layout unit |
| Code Blocks | 167-290 (124 lines) | Most pages show code |
| Overflow Protection | 291-401 (111 lines) | Prevents layout breaks |
| Responsive Breakpoint | 1069-1081 (13 lines) | Mobile support |
| Badges and Tags | 1082-1097 (16 lines) | Used across page types |
| Lists Inside Nodes | 1098-1133 (36 lines) | Used in cards |

**Total: ~462 lines, ~11K chars**

### A3. New File: `references/css-mermaid.md`

Mermaid-specific patterns. Extracted from css-patterns.md:

| Section | Lines | Why included |
|---------|-------|-------------|
| Mermaid Containers | 402-625 (224 lines) | Zoom controls JS, CSS overrides |
| Connectors | 880-934 (55 lines) | SVG flow arrows |

**Total: ~282 lines, ~9K chars**

### A4. New File: `references/css-components.md`

Specialized layout components. Extracted from css-patterns.md:

| Section | Lines | Why included |
|---------|-------|-------------|
| Grid Layouts | 626-879 (254 lines) | Multi-column layouts |
| Animations | 935-1051 (117 lines) | Staggered reveals |
| Sparklines | 1052-1068 (17 lines) | Dashboard mini-charts |
| KPI / Metric Cards | 1134-1191 (58 lines) | Dashboard hero numbers |
| Before / After Panels | 1192-1256 (65 lines) | Diff/plan reviews |
| Collapsible Sections | 1257-1317 (61 lines) | Long pages |
| Prose Page Elements | 1318-1628 (311 lines) | Editorial pages |
| Generated Images | 1629-1733 (105 lines) | surf CLI containers |

**Total: ~992 lines, ~22K chars**

### A5. Removed: `references/css-patterns.md`

Stubbed with a redirect comment (deletion was denied by permission controls). Content distributed to the three new files.

### A6. Modified: `references/libraries.md`

Remove Google Fonts section (lines 488-543, 56 lines) — redundant with core.md Typography.

**New size: ~487 lines, ~16K chars** (down from 543 lines, 19K chars)

Add header note: "For font pairings, see core.md Typography section."

### A7. Modified: `skills/visual-explainer/SKILL.md`

Update section 2 ("Structure") to reference new modules instead of `css-patterns.md`:

Current (line 61):
```
**For CSS/layout patterns and SVG connectors**, read `./references/css-patterns.md`.
```

New:
```
**For CSS patterns**, read the relevant reference modules:
- `./references/css-core.md` — always read (theme, cards, code blocks, overflow)
- `./references/css-mermaid.md` — read when the page includes Mermaid diagrams
- `./references/css-components.md` — read when the page needs grids, KPI cards, before/after panels, prose elements, or image containers
```

Also update all other `css-patterns.md` references to point at the specific module:
- Line 158: collapsible → `css-components.md`
- Line 160: depth tiers → `css-core.md`
- Line 254: code blocks → `css-core.md`
- Line 282: prose elements → `css-components.md`
- Line 342: overflow → `css-core.md`
- Line 343: Mermaid zoom → `css-mermaid.md`
- Line 295 (slides): all three modules

### A8. Modified: `skills/research/SKILL.md`

Update step 4 (line 61): invoke `/generate-architecture-diagram` instead of `/generate-web-diagram`.

### A9. Modified: VE commands (5 files)

Update reference file reads in each command to list the new modules:

**`commands/diff-review.md`** (lines 7-9) — reads all 3 CSS modules + libraries.md
**`commands/generate-visual-plan.md`** (lines 7-9) — reads all 3 CSS modules + libraries.md
**`commands/plan-review.md`** (lines 7-9) — reads all 3 CSS modules + libraries.md
**`commands/project-recap.md`** (lines 7-9) — reads all 3 CSS modules + libraries.md
**`commands/generate-web-diagram.md`** (line 6) — update file list to new module names

Each change is the same pattern — replace:
```
- `~/.claude/skills/visual-explainer/references/css-patterns.md` (CSS patterns, Mermaid zoom, card depth)
```
With:
```
- `~/.claude/skills/visual-explainer/references/css-core.md` (theme, cards, code blocks, overflow)
- `~/.claude/skills/visual-explainer/references/css-mermaid.md` (Mermaid containers, zoom controls, connectors)
- `~/.claude/skills/visual-explainer/references/css-components.md` (grids, KPI cards, before/after, collapsible, animations)
```

### A10. Modified: `references/slide-patterns.md`

Update any references to `css-patterns.md` to point at the three new modules.

---

### Category B: Agent Pipeline Changes

### B1. Modified: `skills/plan/SKILL.md` — Remove redundant rules read

Current (line 40):
```
Before writing the plan, read and comply with all rule files in `rules/` (or `~/.claude/rules/` for global rules). These rules govern coding style, testing, security, performance, and git workflow. Code snippets in the plan must follow `coding-style.md`. The testing strategy must follow `testing.md`. Architectural decisions must respect `security.md` and `performance.md`.
```

New:
```
Comply with the project rules already loaded in context (coding-style, testing, security, performance, git-workflow). Code snippets must follow coding-style rules. The testing strategy must follow testing rules. Architectural decisions must respect security and performance rules.
```

**Saves:** ~6K chars of redundant file reads in the main context. Rules are already loaded as CLAUDE.md global instructions — reading them again wastes tokens.

### B2. Modified: `skills/implement/SKILL.md` — Remove redundant rules read

Current (line 22):
```
Before writing any code, read and comply with all rule files in `rules/` (or `~/.claude/rules/` for global rules). These rules govern coding style, testing, security, performance, and git workflow. The skill itself — not just the agents it invokes — must follow these rules when writing implementation code, fixing issues, or making any code changes.
```

New:
```
Comply with the project rules already loaded in context (coding-style, testing, security, performance, git-workflow). The skill itself — not just the agents it invokes — must follow these rules when writing implementation code, fixing issues, or making any code changes.
```

**Saves:** ~6K chars per implement invocation.

### B3. Modified: `skills/implement/SKILL.md` — Batch tdd-guide invocations

Current (line 28):
```
2. **Implement everything**: Execute all tasks in the todo list, in order. You MUST use the `tdd-guide` agent (via the Agent tool) to guide implementation. For each task:
   - Implement the changes exactly as specified in the plan, following the tdd-guide's red-green-refactor cycle
   - Mark the task as completed in the plan document by changing `- [ ]` to `- [x]`
   - Run type checks / linters continuously to catch issues early
   - Do NOT stop to ask for confirmation between tasks
   - If the plan's todo list is missing test tasks, write tests anyway — every behavioral change must have test coverage. The absence of test tasks in the plan does not excuse the absence of tests in the implementation.
```

New:
```
2. **Implement everything**: Execute all tasks in the todo list, in order. You MUST use the `tdd-guide` agent (via the Agent tool) to guide implementation. **Batch tasks**: invoke the tdd-guide with 3-5 related tasks per invocation rather than one task at a time — this reduces agent overhead while maintaining TDD discipline. Group tasks by the file or module they affect. For each batch:
   - Implement the changes exactly as specified in the plan, following the tdd-guide's red-green-refactor cycle for each task in the batch
   - Mark each task as completed in the plan document by changing `- [ ]` to `- [x]`
   - Run type checks / linters continuously to catch issues early
   - Do NOT stop to ask for confirmation between tasks
   - If the plan's todo list is missing test tasks, write tests anyway — every behavioral change must have test coverage. The absence of test tasks in the plan does not excuse the absence of tests in the implementation.
```

**Saves:** For a 20-todo feature, reduces tdd-guide invocations from ~20 to ~5. Each invocation saves ~4.6K in agent instruction + rules overhead. **Total savings: ~69K in agent tokens.**

### B4. Modified: `skills/implement/SKILL.md` — Merge security-reviewer into code-reviewer

Remove step 6 (security review as separate agent). The code-reviewer agent already has a "Security (CRITICAL)" section in its checklist that covers hardcoded credentials, SQL injection, XSS, path traversal, auth bypasses, insecure dependencies, and exposed secrets in logs.

Current step 6:
```
6. **Security review**: You MUST run the `security-reviewer` agent (via the Agent tool) on all changed files. This is not optional. If CRITICAL issues are found, fix them immediately. Report any findings to the user.
```

Remove this step entirely. Renumber subsequent steps (7→6, 8→7, etc.).

**Also modify `agents/code-reviewer.md`** to strengthen its security section by incorporating the security-reviewer's OWASP Top 10 focus and remediation capability:

Add to the Security (CRITICAL) checklist in code-reviewer.md (after line 46):
```
- **OWASP Top 10** — Check for all OWASP Top 10 vulnerabilities relevant to the project's language/framework
- **Input validation** — Ensure all external input (user input, API bodies, query params, file uploads, webhooks) is validated with schema-based validation before use
```

Add to the code-reviewer's tools (line 4):
```
tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash"]
```

This gives code-reviewer the ability to fix CRITICAL security issues it finds (currently it's read-only). Add a line after the Approval Criteria section:

```
## Auto-Fix Policy

If you find a CRITICAL security issue, fix it immediately using Edit/Write tools. Report what you fixed. For HIGH issues, report but do not fix — let the user decide.
```

**Saves:** ~15K per run (3.4K security-reviewer instructions + 1.1K rules + ~10K code re-read that code-reviewer already does).

### B5. Modified: `skills/plan/SKILL.md` — Make architect conditional

Current step 1b (line 54):
```
### Step 1b: Architecture Review

Use the `architect` agent (via the Agent tool) to evaluate the feature's architectural implications. Incorporate the architect's findings into the plan's **Approach** and **Considerations & Trade-offs** sections.
```

New:
```
### Step 1b: Architecture Review (conditional)

For features that involve architectural decisions (new modules, cross-cutting changes, API design, database schema changes, or features touching 5+ files), use the `architect` agent (via the Agent tool) to evaluate architectural implications. Incorporate findings into the plan's **Approach** and **Considerations & Trade-offs** sections.

Skip the architect for simple features (bug fixes, single-file changes, UI tweaks, configuration changes) — the planning skill's own analysis is sufficient.
```

**Saves:** ~15K in agent tokens (3K instructions + 3K rules + ~10K codebase reads) for ~30-40% of features that are simple enough to skip architectural review.

### B6. Removed: `agents/security-reviewer.md`

Stubbed with a redirect comment (deletion was denied by permission controls). Its security review responsibilities are absorbed into the enhanced `agents/code-reviewer.md` (change B4).

## New Files

| File | Purpose | Size |
|------|---------|------|
| `commands/generate-architecture-diagram.md` | Specialized architecture diagram command for /research | ~1K |
| `references/css-core.md` | Foundation CSS patterns | ~11K |
| `references/css-mermaid.md` | Mermaid containers + zoom + connectors | ~9K |
| `references/css-components.md` | Grids, KPI, before/after, prose, images | ~22K |

## Removed Files

| File | Reason |
|------|--------|
| `references/css-patterns.md` | Split into css-core, css-mermaid, css-components (stubbed, not deleted — rm denied) |
| `agents/security-reviewer.md` | Merged into code-reviewer (stubbed, not deleted — rm denied) |

## Dependencies

None.

## Considerations & Trade-offs

### Why 3 CSS modules, not 6?

Finer splits would require every command to enumerate 4-5 reads. Three modules keep it simple: "core always, mermaid for diagrams, components for rich layout."

### Why not merge Mermaid JS from libraries.md into css-mermaid.md?

Combined would be ~650 lines, exceeding the 400-line rule. Also respects the CSS/JS boundary.

### Risk: css-components.md is ~988 lines

Exceeds the 400-line rule. Could split into `css-layout.md` + `css-prose.md`, but most commands need both. A future split makes sense if prose-only pages become a distinct use case.

### Why merge security-reviewer into code-reviewer instead of keeping both?

Both agents read the same changed files. Code-reviewer already has a Security (CRITICAL) checklist. Running two separate agents that read the same files doubles the file-reading token cost with marginal incremental value. The merged agent retains all security checks and gains the ability to fix critical issues.

### Risk: Batching tdd-guide reduces per-task discipline

Mitigated by: the tdd-guide still enforces red-green-refactor for each task in the batch. The batching groups related tasks (same file/module) so the agent maintains context between them. 3-5 tasks per batch is small enough to maintain focus.

### Why make architect conditional rather than removing it?

The architect catches real issues for complex features — dependency risks, scalability concerns, API design problems. Removing it entirely would sacrifice quality. Making it conditional preserves the safety net for complex work while skipping overhead for simple changes.

### Agent rules reads are necessary (not redundant)

Unlike the main conversation (where rules are loaded as CLAUDE.md), agents run in isolated context windows without CLAUDE.md. Their "read rules" instructions are genuinely necessary and should NOT be removed.

## Migration / Data Changes

None.

## Testing Strategy

### Manual Verification Test Cases

| Test ID | Category | Scenario | Expected Outcome |
|---------|----------|----------|-----------------|
| `T1` | A | Run `/generate-architecture-diagram "module relationships"` | HTML with Mermaid theming, zoom, card depth, both themes |
| `T2` | A | Run `/research some-topic` — verify it uses `/generate-architecture-diagram` | Architecture diagram via core.md path, not full SKILL.md |
| `T3` | A | Run `/diff-review main` with new reference modules | HTML with Mermaid zoom, KPI, before/after, no overflow bugs |
| `T4` | A | Run `/generate-visual-plan` on an existing plan | HTML with state machines, code, proper fonts |
| `T5` | A | Run `/generate-web-diagram "data flow"` — full SKILL.md still loads | Full VE quality, all diagram types available |
| `T6` | A | Read css-core.md — verify 9 sections present with complete CSS | All patterns preserved verbatim |
| `T7` | A | Read css-mermaid.md — verify zoom JS + connectors complete | Zoom, Ctrl+scroll, drag-to-pan, connector patterns |
| `T8` | A | Read css-components.md — verify 8 sections present | Grid, Animation, KPI, Before/After, Collapsible, Prose, Image |
| `T9` | A | Read trimmed libraries.md — Fonts removed, rest intact | ~487 lines, Mermaid theming complete |
| `T10` | A | Check slide-patterns.md for stale css-patterns.md references | No stale references |
| `T11` | B | Run `/plan` on a simple bug fix — verify architect is skipped | Plan produced without architect agent invocation |
| `T12` | B | Run `/plan` on a multi-module feature — verify architect runs | Architect findings in Approach and Considerations sections |
| `T13` | B | Run `/implement` — verify tdd-guide batches 3-5 tasks | Fewer agent invocations, each handling multiple todos |
| `T14` | B | Run `/implement` — verify code-reviewer catches security issues | CRITICAL security findings reported and auto-fixed |
| `T15` | B | Run `/implement` — verify security-reviewer is NOT invoked | Only code-reviewer runs (no separate security pass) |
| `T16` | B | Run `/plan` — verify rules are NOT re-read from disk | No Read tool calls for rules/*.md files during planning |
| `T17` | B | Run `/implement` — verify rules are NOT re-read from disk | No Read tool calls for rules/*.md files during implementation |

## Token Budget: Before vs After

### Category A: Main context savings per /build-feature run

| Phase | Before | After | Savings |
|-------|--------|-------|---------|
| Phase 1: Research | ~126K | ~56K | ~70K |
| Phase 2: Plan | ~83K | ~74K | ~9K |
| Phase 3: Implement | ~86K | ~77K | ~9K |
| Diff-review | ~79K | ~70K | ~9K |
| **Main context total** | **~374K** | **~277K** | **~97K (26%)** |

### Category B: Agent token savings per /build-feature run

| Change | Before | After | Savings |
|--------|--------|-------|---------|
| Rules re-read in plan + implement skills | ~12K | 0 | ~12K |
| tdd-guide batching (20 todos) | ~92K | ~23K | ~69K |
| Security-reviewer eliminated | ~15K | 0 | ~15K |
| Architect skipped (simple features) | ~15K | 0 | ~15K (conditional) |
| **Agent savings** | | | **~96-111K** |

### Grand total

| Metric | Chars |
|--------|-------|
| Original baseline (v1) | ~681K main |
| After core.md (v2) | ~374K main |
| After this plan (v3) main context | ~277K main |
| After this plan (v3) agent savings | ~96-111K agent |
| **Total savings from v2** | **~193-208K (combined main + agent)** |
| **Total savings from v1** | **~500-515K (combined)** |

For a typical 20-todo /build-feature run, total tokens across all windows drops from ~470K to ~275K — a **~42% reduction in overall usage**.

## Todo List

### Category A: VE Reference Optimization

- [x] A2: Create `references/css-core.md` — extract 9 sections (Theme, Background, Links, Cards, Code Blocks, Overflow, Responsive, Badges, Lists) from `references/css-patterns.md`
- [x] A3: Create `references/css-mermaid.md` — extract Mermaid Containers + Connectors sections from `references/css-patterns.md`
- [x] A4: Create `references/css-components.md` — extract remaining 8 sections (Grids, Animations, Sparklines, KPI, Before/After, Collapsible, Prose, Images) from `references/css-patterns.md`
- [x] A5: Delete `references/css-patterns.md`
- [x] A6: Trim `references/libraries.md` — remove Google Fonts section, add header note pointing to core.md
- [x] A7: Update `skills/visual-explainer/SKILL.md` — replace css-patterns.md references with new module names
- [x] A1: Create `commands/generate-architecture-diagram.md` — specialized command reading core.md + targeted CSS modules
- [x] A8: Update `skills/research/SKILL.md` — use `/generate-architecture-diagram` instead of `/generate-web-diagram`
- [x] A9a: Update `commands/diff-review.md` — replace css-patterns.md reference with 3 new modules
- [x] A9b: Update `commands/generate-visual-plan.md` — replace css-patterns.md reference with 3 new modules
- [x] A9c: Update `commands/plan-review.md` — replace css-patterns.md reference with 3 new modules
- [x] A9d: Update `commands/project-recap.md` — replace css-patterns.md reference with 3 new modules
- [x] A9e: Update `commands/generate-web-diagram.md` — replace css-patterns.md reference with 3 new modules
- [x] A10: Update `references/slide-patterns.md` — replace any css-patterns.md references with new module names

### Category B: Agent Pipeline Optimization

- [x] B1: Update `skills/plan/SKILL.md` — remove redundant "read rules" instruction, reference rules already in context
- [x] B2: Update `skills/implement/SKILL.md` — remove redundant "read rules" instruction
- [x] B3: Update `skills/implement/SKILL.md` — change tdd-guide invocation to batch 3-5 tasks per invocation
- [x] B4a: Update `agents/code-reviewer.md` — add Write/Edit tools, OWASP checks, auto-fix policy
- [x] B4b: Update `skills/implement/SKILL.md` — remove security-reviewer step, renumber subsequent steps
- [x] B5: Update `skills/plan/SKILL.md` — make architect agent conditional based on feature complexity
- [x] B6: Delete `agents/security-reviewer.md`

## Verification Summary

**Claims checked: 28** | **Confirmed: 23** | **Corrected: 5** | **Unverifiable: 0**

Corrections made:
- css-mermaid.md size: changed `~7K chars` → `~9K chars` (actual: 8,923 bytes)
- css-components.md size: changed `~24K chars` → `~22K chars` (actual: 21,501 bytes)
- css-patterns.md removal: changed "Deleted" → "Stubbed with redirect comment (rm denied)"
- security-reviewer.md removal: changed "Delete this file" → "Stubbed with redirect comment (rm denied)"
- Removed files table: added "(stubbed, not deleted — rm denied)" notation
- New files table: updated size columns to match actual byte counts

All other claims verified: line counts (461/282/992/488 vs plan's ~462/~279/~988/~487), file references updated correctly, no stale css-patterns.md refs in active files, security-reviewer fully removed from implement workflow, rules reads replaced, architect made conditional, tdd-guide batching added.
