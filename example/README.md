# Example: /build-feature Artifacts

This directory contains sample artifacts from the `/build-feature` pipeline, demonstrating what Claude Code produces at each phase. The example feature is **API rate limiting** for a Python/FastAPI application.

## Pipeline Overview

```
/build-feature "Add API rate limiting"

Phase 1: Research        → research.md + research.html
Phase 2: Plan            → plan.md + plan.html
    ↻ Annotation cycles (user adds // comments, Claude refines)
Phase 3: Implementation  → code changes + diff-review.html
```

## Artifacts

### Phase 1: Research

| File | Description |
|------|-------------|
| [research.md](research.md) | Deep investigation of the codebase area. Covers architecture, key files, data flow, patterns, dependencies, edge cases, and current state. |
| [research.html](research.html) | Visual architecture diagram showing module relationships, request pipeline, and component boundaries. Open in a browser. |

The user reviews the research, optionally adds `//` annotations to correct misunderstandings, and Claude updates both files before proceeding.

### Phase 2: Plan

| File | Description |
|------|-------------|
| [plan.md](plan.md) | Detailed implementation plan with code snippets, file-by-file changes, testing strategy, and a todo checklist. |
| [plan.html](plan.html) | Visual plan with state machine diagram, before/after comparison panels, code blocks, edge case table, test requirements, and todo list. Open in a browser. |

The user annotates `plan.md` with `//` comments (corrections, constraints, domain knowledge). Claude addresses every annotation, updates both files, and repeats until the user approves. The todo list starts as "Proposed Todo List" and is finalized to "Todo List" on approval.

### Phase 3: Implementation

| File | Description |
|------|-------------|
| [diff-review.html](diff-review.html) | Post-implementation visual diff review with executive summary, KPI dashboard, module architecture diagram, before/after panels, code review (good/bad/ugly), decision log, and re-entry context. Open in a browser. |

During implementation, Claude executes the todo list, checking off items in `plan.md` as they're completed. After all tasks are done, it runs verification (type checks, linting, tests, build), code review agents, and generates the diff review.

## Key Conventions

- **Companion naming**: HTML files share the base name of their markdown counterpart (`research.md` → `research.html`, `plan.md` → `plan.html`)
- **Mandatory visual sync**: Whenever a markdown file changes (annotations, corrections, any update), the HTML companion is regenerated before proceeding to the next step
- **Feature directory**: All artifacts live together in `docs/claude/<YYYYMMDD-HHMM>-<slug>/` within the target project
- **Each HTML is self-contained**: Single file, no external assets except CDN fonts and optional Mermaid.js. Opens directly in a browser.
- **Each HTML uses a distinct aesthetic**: The visual-explainer skill varies fonts, palettes, and layout approaches across artifacts to avoid generic output

## How to View

Open any `.html` file directly in a browser:

```bash
open example/research.html    # macOS
xdg-open example/research.html  # Linux
```

The HTML files support both light and dark mode via `prefers-color-scheme`. Mermaid diagrams include zoom controls (+/−/reset) and click-and-drag panning.
