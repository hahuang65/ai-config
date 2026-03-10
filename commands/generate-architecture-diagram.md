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
