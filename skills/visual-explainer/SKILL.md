---
name: visual-explainer
description: Generate beautiful, self-contained HTML pages that visually explain systems, code changes, plans, and data. Use when the user asks for a diagram, architecture overview, diff review, plan review, project recap, comparison table, or any visual explanation of technical concepts. Also use proactively when you are about to render a complex ASCII table (4+ rows or 3+ columns) — present it as a styled HTML page instead.
license: MIT
compatibility: Requires a browser to view generated HTML files. Optional surf-cli for AI image generation.
metadata:
  author: nicobailon
  version: "0.4.4"
---

# Visual Explainer

Generate self-contained HTML files for technical diagrams, visualizations, and data tables. Always open the result in the browser. Never fall back to ASCII art.

**Proactive table rendering:** If you're about to render an ASCII table with 4+ rows or 3+ columns, generate an HTML page instead. Don't wait to be asked.

## Workflow

Read the reference files before generating — don't memorize them.

### 1. Think

Commit to a direction. Pick an aesthetic and vary from recent generations. See [references/diagram-types.md](references/diagram-types.md) for aesthetic directions and constraints.

**Constrained aesthetics (prefer):** Blueprint, Editorial, Paper/ink, Monochrome terminal.
**Flexible (use with caution):** IDE-inspired (commit to a real palette: Dracula, Nord, etc.), Data-dense.
**Forbidden:** Neon dashboard, gradient mesh, Inter + violet/indigo accents.

### 2. Structure

Choose a rendering approach based on content type. See the approach table in [references/diagram-types.md](references/diagram-types.md).

**Read templates before writing:**
- Architecture overviews → `./templates/architecture.html`
- Flowcharts, sequence, ER, state machines → `./templates/mermaid-flowchart.html`
- Data tables → `./templates/data-table.html`
- Slide decks → `./templates/slide-deck.html` + `./references/slide-patterns.md`

**Read CSS references as needed:**
- `./references/css-core.md` — always read (theme, cards, code blocks, overflow)
- `./references/css-mermaid.md` — when using Mermaid diagrams
- `./references/css-components.md` — when using grids, KPI cards, prose elements
- `./references/libraries.md` — font pairings, Mermaid/Chart.js theming
- `./references/responsive-nav.md` — for pages with 4+ sections

**Mermaid rules:**
- Use `theme: 'base'` with custom `themeVariables`
- Center with `display: flex; justify-content: center`
- Add zoom controls to every `.mermaid-wrap`
- Prefer `flowchart TD` over `LR` for complex diagrams
- Never define `.node` as a page-level CSS class (collides with Mermaid internals)
- For 10+ nodes: increase fontSize, use hybrid pattern for 15+

### 3. Style

See [references/anti-patterns.md](references/anti-patterns.md) for forbidden patterns.

**Typography:** Pick distinctive font pairings from `./references/libraries.md`. Never Inter, Roboto, Arial, or Helvetica alone.
**Color:** Use CSS custom properties with semantic names. Support both themes. Build depth through subtle lightness shifts (2-4%).
**Surfaces:** Vary card depth (hero → elevated → default → recessed). Don't make everything pop.
**Animation:** Staggered fade-ins are good. Forbidden: glowing shadows, pulsing effects, continuous animations.

### 4. Deliver

**Output location:** Write to `docs/features/<YYYYMMDD-HHMM>-<slug>/` if a feature directory exists. When accompanying a markdown file, use the same base name with `.html` extension (e.g., `spec.md` → `spec.html`). For standalone visuals: `diff-review.html`, `diagram.html`, `slides.html`.

**Open in browser:** `xdg-open <path>` on Linux, `open <path>` on macOS.

**Tell the user** the file path so they can re-open or share it.

## Diagram Types

See [references/diagram-types.md](references/diagram-types.md) for detailed rendering guidance for each type:
- Architecture, Flowcharts, Sequence, Data Flow, ER/Schema, State Machines, Mind Maps, Data Tables, Timelines, Dashboards, Implementation Plans, Documentation

## Slide Deck Mode

Opt-in only — request slides explicitly (the `--slides` flag, or natural language like "as a slide deck"). See [references/slide-patterns.md](references/slide-patterns.md) for full guidance. Slides are not pages reformatted — each slide is one viewport (100dvh), no scrolling. Cover all source content.

## Quality Checks

See [references/quality-checks.md](references/quality-checks.md) for the verification checklist.

## Anti-Patterns

See [references/anti-patterns.md](references/anti-patterns.md) for explicitly forbidden patterns (AI slop test, typography, colors, layouts).
