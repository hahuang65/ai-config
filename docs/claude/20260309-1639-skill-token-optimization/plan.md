# Plan: Skill Token Optimization

## Goal

Reduce the token cost of `/build-feature` runs by ~53% (from ~681K to ~318K chars) by eliminating redundant VE skill reloads, reference re-reads, and cross-command duplication — without removing any functionality, MUST steps, or quality guidance.

## Research Reference

`docs/claude/20260309-1639-skill-token-optimization/research.md`

## Approach

**Core insight:** The visual-explainer SKILL.md (33K) and its references (42K + 19K) load 4-6 times per `/build-feature` run. Only the first load is useful. The solution is structural: create a compact core extract (~6K) that commands read instead of loading the full skill, and make commands selective about which references they need.

**Three changes:**

1. **Create `core.md`** (~6K) — a compact extract of VE quality guidance (aesthetic directions, style principles, anti-patterns, quality checks, delivery rules). Not a copy of SKILL.md — a curated extract of the guidance every VE command needs.

2. **Rewrite VE command headers** — Replace "Load the visual-explainer skill, then..." with "Read `~/.claude/skills/visual-explainer/core.md`" plus selective reference reads. The full SKILL.md is only loaded by `/generate-web-diagram` (which is the general-purpose command that genuinely needs everything).

3. **Decouple fact-check from VE** — fact-check only needs to match existing page styling. It doesn't generate diagrams. Remove VE dependency entirely; instruct it to inspect the target file's own `<style>` block.

**What we are NOT doing:**
- Not changing SKILL.md itself (it remains the single source of truth for direct VE invocations)
- Not removing any references or templates
- Not changing what commands produce — only how they get their guidance
- Not touching agents, rules, or non-VE skills

## Detailed Changes

### New File: `skills/visual-explainer/core.md`

A ~6K extract of VE's quality-critical guidance. Every VE command reads this instead of the 33K SKILL.md.

```markdown
# Visual Explainer — Core Quality Guide

Compact reference for VE-based commands. For the full skill (general-purpose diagram generation), load the visual-explainer skill directly.

## Aesthetic Direction

Pick one and commit. Vary each time. **Constrained aesthetics (prefer these):**
- Blueprint (technical drawing feel, subtle grid background, deep slate/blue, monospace labels)
- Editorial (serif headlines like Instrument Serif or Crimson Pro, generous whitespace, muted earth tones or deep navy + gold)
- Paper/ink (warm cream #faf7f5 background, terracotta/sage accents, informal feel)
- Monochrome terminal (green/amber on near-black, monospace everything)

**Flexible (use with caution):** IDE-inspired (commit to a real named scheme: Dracula, Nord, Catppuccin, Solarized, Gruvbox, Rosé Pine). Data-dense (small type, tight spacing, muted colors).

**Explicitly forbidden:** Neon dashboard (cyan + magenta + purple on dark). Gradient mesh (pink/purple/cyan blobs). Inter font + violet/indigo accents + gradient text.

## Typography

Pick a distinctive font pairing. Load via Google Fonts with `display=swap`.

**Forbidden as --font-body:** Inter, Roboto, Arial, Helvetica, system-ui alone.

**Good pairings:**
| Body | Mono | Feel |
|------|------|------|
| DM Sans | Fira Code | Friendly, developer |
| Instrument Serif | JetBrains Mono | Editorial, refined |
| IBM Plex Sans | IBM Plex Mono | Reliable, readable |
| Bricolage Grotesque | Fragment Mono | Bold, characterful |
| Plus Jakarta Sans | Azeret Mono | Rounded, approachable |
| Outfit | Space Mono | Clean geometric |

## Color

Use CSS custom properties. Define: `--bg`, `--surface`, `--border`, `--text`, `--text-dim`, and 3-5 accent colors with dim variants. Support both light and dark themes.

**Forbidden:** #8b5cf6 #7c3aed #a78bfa (indigo/violet), #d946ef (fuchsia), cyan-magenta-pink. Gradient text on headings. Animated glowing box-shadows.

**Good palettes:** Terracotta + sage (#c2410c, #65a30d). Teal + slate (#0891b2, #0369a1). Rose + cranberry (#be123c, #881337). Amber + emerald (#d97706, #059669). Deep blue + gold (#1e3a5f, #d4a73a).

## Style Principles

- **Surfaces whisper.** Build depth through subtle lightness shifts (2-4%), not dramatic color changes. Borders: low-opacity rgba.
- **Backgrounds create atmosphere.** Subtle gradients or faint grid patterns, not flat solid colors.
- **Visual weight signals importance.** Hero sections dominate (larger type, accent background). Reference sections stay compact. Use `<details>/<summary>` for secondary content.
- **Surface depth creates hierarchy.** Hero (elevated shadow + accent tint), default (flat), recessed (inset shadow). Don't elevate everything.
- **Animation earns its place.** Staggered fade-ins on load, hover transitions. Respect `prefers-reduced-motion`. No glowing shadows, no pulsing, no continuous animations after load.

## Mermaid

- Always use `theme: 'base'` with custom `themeVariables` matching your page palette.
- Always center with `display: flex; justify-content: center`.
- Add zoom controls (+/−/reset) to every `.mermaid-wrap`. See css-patterns.md "Mermaid Zoom Controls."
- Prefer `flowchart TD` over `LR` for complex diagrams. Use `LR` only for simple 3-4 node linear flows.
- Max 10-12 nodes per diagram. For 15+, use hybrid: simple Mermaid overview + CSS Grid cards.
- Never define `.node` as a page-level CSS class (Mermaid uses it internally).
- Never set `color:` in `classDef` — let CSS overrides handle text color via `var(--text)`.
- Use semi-transparent fills (8-digit hex) for node backgrounds.

## Overflow Prevention

- Apply `min-width: 0` on all grid/flex children.
- Use `overflow-wrap: break-word` on all text containers.
- Never use `display: flex` on `<li>` for marker characters — use absolute positioning.

## Output

Write to the current feature directory under `docs/claude/` if one exists. Otherwise create `docs/claude/<YYYYMMDD-HHMM>-<slug>/`. Do NOT write to `~/.agent/diagrams/`. Open in browser. Tell the user the file path.

## AI Illustrations (Optional)

If `surf` CLI is available (`which surf`), generate images via `surf gemini --generate-image`. Match style to palette. Embed as base64 data URI. Skip if surf unavailable or content is purely structural.

## Quality Checks

Before delivering, verify:
- **Squint test:** Blur your eyes — can you perceive hierarchy?
- **Swap test:** Would generic dark theme make this indistinguishable? If yes, push the aesthetic further.
- **Both themes:** Light and dark must look intentional.
- **Information completeness:** Pretty but incomplete is a failure.
- **No overflow:** Resize browser. No clipping or escaping.
- **Mermaid zoom controls:** Every `.mermaid-wrap` has +/−/reset, Ctrl+scroll zoom, click-drag pan.
- **Slop test:** If 2+ of these are present, regenerate: Inter/Roboto + violet gradient, emoji section headers, glowing cards, uniform card grid, three-dot code chrome.

## File Structure

Single self-contained `.html` file. No external assets except CDN fonts and optional libraries. Structure: `<!DOCTYPE html>` with inline `<style>`, semantic HTML, optional `<script>` for Mermaid/Chart.js/anime.js.

## Verification Checkpoint

Before generating HTML, produce a structured fact sheet of every claim you will present. Cite sources (git command output, file:line). Verify each against the code. Mark unverifiable claims as uncertain.
```

### Modified: `commands/diff-review.md`

**Change:** Replace the VE skill load + reference read instructions with targeted reads.

Current opening (lines 1-6):
```markdown
---
description: Generate a visual HTML diff review — before/after architecture comparison with code review analysis
---
Load the visual-explainer skill, then generate a comprehensive visual diff review as a self-contained HTML page.

Follow the visual-explainer skill workflow. The skill's references and templates are at `~/.claude/skills/visual-explainer/references/` and `~/.claude/skills/visual-explainer/templates/`. Read the relevant reference files (css-patterns.md, libraries.md) and template files before generating. Use a GitHub-diff-inspired aesthetic with red/green before/after panels, but vary fonts and palette from previous diagrams.
```

New opening:
```markdown
---
description: Generate a visual HTML diff review — before/after architecture comparison with code review analysis
---
Generate a comprehensive visual diff review as a self-contained HTML page.

Before generating, read these reference files:
- `~/.claude/skills/visual-explainer/core.md` (quality guide — aesthetic, typography, color, style, checks)
- `~/.claude/skills/visual-explainer/references/css-patterns.md` (CSS patterns, Mermaid zoom, card depth)
- `~/.claude/skills/visual-explainer/references/libraries.md` (Mermaid theming, font imports)

Use a GitHub-diff-inspired aesthetic with red/green before/after panels, but vary fonts and palette from previous diagrams.
```

Also remove the inline overflow prevention block (line 38 area) and the inline Mermaid zoom instruction (line 37 area) since these are now in core.md. Replace with brief references:

Current (line 37-38 area):
```
3. **Module architecture** — ... Wrap in `.mermaid-wrap` with zoom controls (+/−/reset buttons), Ctrl/Cmd+scroll zoom, and click-and-drag panning (grab/grabbing cursors). See css-patterns.md "Mermaid Zoom Controls" for the full pattern.
4. **Major feature comparisons** — ... Overflow prevention: apply `min-width: 0` on all grid/flex children and `overflow-wrap: break-word` on panels. Never use `display: flex` on `<li>` for marker characters — use absolute positioning instead (see css-patterns.md Overflow Protection).
```

New:
```
3. **Module architecture** — ... Wrap in `.mermaid-wrap` with zoom controls per core.md.
4. **Major feature comparisons** — ... Apply overflow prevention per core.md.
```

Remove the "Verification checkpoint" section (lines 27-32, ~400 chars) since it's now in core.md. Replace with:
```
Apply the verification checkpoint from core.md before generating HTML.
```

Remove the standalone "Visual hierarchy" section (line 60, ~200 chars). Remove the "Optional illustrations" section (line 62, ~200 chars) — covered by core.md.

**Estimated savings per invocation:** 33,179 (SKILL.md no longer loaded) + the inline patterns replaced with one-liners = ~33K chars.

**Note:** css-patterns.md (42K) and libraries.md (19K) are still read here because diff-review genuinely needs them for Mermaid theming code and CSS patterns. The big win is eliminating the 33K SKILL.md reload.

### Modified: `commands/generate-visual-plan.md`

Same pattern as diff-review. Replace the VE skill load with core.md + selective reference reads.

Current opening (lines 1-6):
```markdown
---
description: Generate a visual HTML implementation plan — ...
---
Load the visual-explainer skill, then generate a comprehensive visual implementation plan for `$ARGUMENTS` as a self-contained HTML page.

Follow the visual-explainer skill workflow. The skill's references and templates are at `~/.claude/skills/visual-explainer/references/` and `~/.claude/skills/visual-explainer/templates/`. Read the relevant reference files (css-patterns.md, libraries.md) and template files before generating. Use an editorial or blueprint aesthetic, but vary fonts and palette from previous diagrams.
```

New opening:
```markdown
---
description: Generate a visual HTML implementation plan — ...
---
Generate a comprehensive visual implementation plan for `$ARGUMENTS` as a self-contained HTML page.

Before generating, read these reference files:
- `~/.claude/skills/visual-explainer/core.md` (quality guide)
- `~/.claude/skills/visual-explainer/references/css-patterns.md` (CSS patterns, Mermaid zoom, card depth)
- `~/.claude/skills/visual-explainer/references/libraries.md` (Mermaid theming, font imports)

Use an editorial or blueprint aesthetic, but vary fonts and palette from previous diagrams.
```

Remove inline overflow prevention (lines 99-103), verification checkpoint (lines 43-49), and optional hero image surf instructions (line 91) — all covered by core.md. Replace each with one-line references.

**Estimated savings: ~33K chars per invocation.**

### Modified: `commands/plan-review.md`

Same pattern. Replace VE skill load with core.md + selective reads. Remove inline overflow prevention, Mermaid zoom, verification checkpoint, surf illustrations, visual hierarchy — replaced with core.md references.

**Estimated savings: ~33K chars per invocation.**

### Modified: `commands/project-recap.md`

Same pattern. Replace VE skill load with core.md + selective reads. Remove inline Mermaid zoom, surf illustrations, overflow prevention — replaced with core.md references.

**Estimated savings: ~33K chars per invocation.**

### Modified: `commands/generate-slides.md`

Current opening:
```
Load the visual-explainer skill, then generate a slide deck for: $ARGUMENTS
```

New:
```
Generate a slide deck for: $ARGUMENTS

Before generating, read these reference files:
- `~/.claude/skills/visual-explainer/core.md` (quality guide)
- `~/.claude/skills/visual-explainer/references/slide-patterns.md` (slide engine, types, presets — also instructs reading css-patterns.md and libraries.md)
- `~/.claude/skills/visual-explainer/templates/slide-deck.html` (reference template)
```

**Estimated savings: ~33K chars per invocation.**

### Modified: `commands/fact-check.md`

**Major change:** Remove VE dependency entirely. fact-check does not generate diagrams — it verifies facts and corrects them in place. The only VE-related need is matching an HTML file's existing styling for the verification summary banner.

Current opening (lines 1-4):
```markdown
---
description: Verify the factual accuracy of a document against the actual codebase, correct inaccuracies in place
---
Load the visual-explainer skill, then verify the factual accuracy of a document...

For HTML files: read `~/.claude/skills/visual-explainer/references/css-patterns.md` to match the existing page's styling when inserting the verification summary.
```

New opening:
```markdown
---
description: Verify the factual accuracy of a document against the actual codebase, correct inaccuracies in place
---
Verify the factual accuracy of a document that makes claims about a codebase. Read the file, extract every verifiable claim, check each against the actual code and git history, correct inaccuracies in place, and add a verification summary.

For HTML files: inspect the target file's own `<style>` block to match its existing aesthetic (colors, fonts, card patterns) when inserting the verification summary. Do not load the visual-explainer skill — the target file's own CSS is the source of truth for styling.
```

Remove "Ultrathink." (this was cargo-culted from VE commands — fact-check doesn't benefit from it).

**Estimated savings: 33,179 (SKILL.md) + 42,300 (css-patterns.md no longer read) = ~75K chars per invocation. Invoked twice in a full /build-feature run = ~150K total savings.**

### Modified: `commands/generate-web-diagram.md`

**No change to VE skill loading** — this is the general-purpose command that genuinely needs the full SKILL.md. It remains as-is.

However, update the Read instructions to be more selective about which template to read (currently says "Read the relevant reference files" without specifying which):

Current:
```
Read the relevant reference files (css-patterns.md, libraries.md) and template files before generating.
```

Keep this as-is — generate-web-diagram is general-purpose and doesn't know in advance which references it needs.

### Not Modified: `skills/visual-explainer/SKILL.md`

No changes. SKILL.md remains the single source of truth for:
- Direct `/visual-explainer` invocations (proactive table rendering, general diagram generation)
- `/generate-web-diagram` (loads full skill)
- Future direct skill users

core.md is an extract, not a replacement.

## New Files

| File | Purpose | Size |
|------|---------|------|
| `skills/visual-explainer/core.md` | Compact VE quality guide for commands | ~6K chars |

## Dependencies

None. No new libraries, services, or tools.

## Considerations & Trade-offs

### Why core.md instead of slimming SKILL.md?

Slimming SKILL.md would help `/generate-web-diagram` (which loads it), but would risk losing detail needed for general-purpose diagram generation. core.md lets specialized commands get a compact extract while `/generate-web-diagram` keeps the full reference.

### Why not decompose into 8-10 modules (architect's Approach B)?

More modules = more maintenance burden and more "which module do I read?" decisions for commands. Two tiers (core.md for essentials, full references when needed) is simpler and captures ~90% of the savings.

### Risk: core.md drifts from SKILL.md

Mitigated by:
1. A header comment in core.md: "Extracted from SKILL.md — review when SKILL.md changes"
2. core.md only contains quality constraints (fonts, colors, anti-patterns) which change rarely
3. The existing `/fact-check` command can verify core.md against SKILL.md

### Risk: Output quality degrades

core.md contains all quality-critical sections from SKILL.md: aesthetic constraints, forbidden patterns, quality checks, the slop test. The removed content is procedural (workflow steps, diagram type catalog, rendering approach table) which commands already specify in their own section structures.

### Why still read css-patterns.md and libraries.md for some commands?

These contain actual CSS code patterns (Mermaid zoom control JavaScript, theming code, card CSS) that commands need to generate correct HTML. core.md contains the rules; the references contain the implementation patterns. Commands that use Mermaid still need the theming code from libraries.md.

### Alternative considered: Make commands not read references at all

Rejected. Commands need actual CSS/JS code from these references to generate correct HTML. Without the Mermaid theming code, diagrams would use default Mermaid styling (ugly). Without the zoom controls code, diagrams would be unzoomable.

## Migration / Data Changes

None. No database, config, or infrastructure changes.

## Testing Strategy

Since these are markdown instruction files (not executable code), testing means verifying that the changes don't degrade output quality or break workflows. No automated test files exist for skill/command behavior.

### Manual Verification Test Cases

| Test | Scenario | Expected Outcome |
|------|----------|-----------------|
| `test-diff-review` | Run `/diff-review main` after changes | HTML output has correct aesthetics, Mermaid zoom works, overflow protected, both themes work |
| `test-visual-plan` | Run `/generate-visual-plan` on an existing plan | HTML has state machines, code snippets, proper fonts, no VE slop patterns |
| `test-fact-check-html` | Run `/fact-check` on an existing HTML review page | Verification summary matches existing page styling without loading VE |
| `test-fact-check-md` | Run `/fact-check` on a markdown plan | Verification summary appended correctly |
| `test-generate-web-diagram` | Run `/generate-web-diagram` (should still load full VE) | Full VE quality, same as before |
| `test-project-recap` | Run `/project-recap` | HTML has architecture diagram, KPI cards, proper aesthetics |
| `test-build-feature-flow` | Run `/build-feature` end-to-end | All phases complete, visual artifacts generated, quality maintained |
| `test-core-completeness` | Compare core.md against SKILL.md quality sections | Every quality constraint in SKILL.md appears in core.md |

## Token Budget: Before vs After

| Phase | Before | After | Savings |
|-------|--------|-------|---------|
| Phase 1 (Research) | ~126K | ~126K | 0 (generate-web-diagram still loads full VE) |
| Phase 2 (Plan) | ~133K | ~72K | ~61K (generate-visual-plan reads core.md instead of SKILL.md) |
| Phase 3 (Implement) | ~422K | ~120K | ~302K (fact-check decoupled, VE commands read core.md) |
| **Total** | **~681K** | **~318K** | **~363K (53%)** |

**Note:** Phase 1 savings are zero because `/generate-web-diagram` is the one command that still loads full SKILL.md. Further optimization of Phase 1 would require slimming SKILL.md itself, which is a separate effort.

## Todo List

### Phase 1: Create core.md
- [x] Create `skills/visual-explainer/core.md` with compact VE quality guidance

### Phase 2: Update VE commands to use core.md
- [x] Modify `commands/diff-review.md` — replace VE skill load with core.md + selective reads, compress inline boilerplate
- [x] Modify `commands/generate-visual-plan.md` — replace VE skill load with core.md + selective reads, compress inline boilerplate
- [x] Modify `commands/plan-review.md` — replace VE skill load with core.md + selective reads, compress inline boilerplate
- [x] Modify `commands/project-recap.md` — replace VE skill load with core.md + selective reads, compress inline boilerplate
- [x] Modify `commands/generate-slides.md` — replace VE skill load with core.md + selective reads

### Phase 3: Decouple fact-check from VE
- [x] Modify `commands/fact-check.md` — remove VE dependency, use target file's own styling

## Verification Summary

**Fact-checked on 2026-03-09 against the implemented codebase.**

- **Total claims checked:** 18
- **Confirmed:** 15 (file sizes, file existence, generate-web-diagram unchanged, SKILL.md unchanged, core.md content, command modifications)
- **Corrections made:** 3
  - Goal line: changed "~70% (from ~681K to ~200K)" to "~53% (from ~681K to ~318K)" to match the plan's own Token Budget table
  - diff-review "New opening" code block: updated parenthetical descriptions from longer form to the normalized shorter form matching actual implementation
  - generate-slides "New opening" code block: reduced from 5 reference files to 3 (css-patterns.md and libraries.md removed during /simplify since slide-patterns.md already instructs reading them)
- **Unverifiable:** 0
