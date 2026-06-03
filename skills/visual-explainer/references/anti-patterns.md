# Anti-Patterns (AI Slop)

These patterns are explicitly forbidden. They signal "AI-generated template." Review every generated page against this list.

## Typography

**Forbidden fonts as primary `--font-body`:**
- Inter — the single most overused AI default
- Roboto, Arial, Helvetica — generic system fallbacks promoted to primary
- system-ui, sans-serif alone — no character, no intent

**Required:** Pick from the font pairings in `./references/libraries.md`. Every generation should use a different pairing.

## Color Palette

**Forbidden accent colors:**
- Indigo-500/violet-500 (`#8b5cf6`, `#7c3aed`, `#a78bfa`) — Tailwind's default purple
- Cyan + magenta + pink neon gradient (`#06b6d4` → `#d946ef` → `#f472b6`)
- Any "Tailwind defaults with purple/pink/cyan accents"

**Forbidden color effects:**
- Gradient text on headings (`background-clip: text`)
- Animated glowing box-shadows on cards
- Multiple overlapping radial glows creating a "neon haze"

**Required:** Build palettes from terracotta/sage, teal/cyan, rose/cranberry, slate/blue, or real IDE themes (Dracula, Nord, Solarized, Gruvbox, Catppuccin).

## Section Headers

**Forbidden:**
- Emoji icons in section headers (🏗️, ⚙️, 📁, 💻, 📅, 🔗, ⚡, 🔧, 📦, 🚀, etc.)
- Section headers that all use the same icon-in-rounded-box pattern

**Required:** Styled monospace labels with colored dot indicators, numbered badges, or asymmetric section dividers. If an icon is needed, use an inline SVG matching the palette — not emoji.

## Layout & Hierarchy

**Forbidden:**
- Perfectly centered everything with uniform padding
- All cards styled identically
- Every section getting equal visual treatment
- Symmetric layouts where left and right halves mirror each other

**Required:** Vary visual weight. Hero sections dominate. Reference sections stay compact. Use depth tiers (hero → elevated → default → recessed). Asymmetric layouts create interest.

## Template Patterns

**Forbidden:**
- Three-dot window chrome (red/yellow/green dots) on code blocks
- KPI cards where every metric has identical gradient text
- "Neon Dashboard" as an aesthetic choice
- Gradient meshes with pink/purple/cyan blobs in the background

**Required:** Code blocks use a simple header with filename or language label. KPI cards vary by importance. Pick aesthetics with natural constraints: Blueprint (technical/precise), Editorial (generous whitespace + serif typography), Paper/ink (warm and informal).

## The Slop Test

Before delivering, ask: **Would a developer immediately think "AI generated this"?**

Telltale signs:
1. Inter or Roboto font with purple/violet gradient accents
2. Every heading has `background-clip: text` gradient
3. Emoji icons leading every section
4. Glowing cards with animated shadows
5. Cyan-magenta-pink color scheme on dark background
6. Perfectly uniform card grid with no visual hierarchy
7. Three-dot code block chrome

If two or more are present, the page is slop. Regenerate with a constrained aesthetic — Editorial, Blueprint, Paper/ink, or a specific IDE theme.
