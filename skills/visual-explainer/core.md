# Visual Explainer — Core Quality Guide

<!-- Extracted from SKILL.md — review when SKILL.md changes -->

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
- Add zoom controls (+/−/reset) to every `.mermaid-wrap`. See css-mermaid.md "Mermaid Containers."
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
