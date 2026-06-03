---
description: Generate a visual HTML diff review — before/after architecture comparison with code review analysis
---
Load the diff-review skill, then generate the diff review: $ARGUMENTS

Follow the diff-review skill workflow: detect the scope from the argument (branch / commit / `HEAD` / PR number / range — default `main`), gather the full diff via git, read every changed file, then render a self-contained HTML page in the visual-explainer aesthetic with the executive summary, KPI dashboard, module/flow diagrams, Good/Bad/Ugly code review, decision log, and re-entry context. Open it in the browser and tell the user the path.
