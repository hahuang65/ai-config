---
name: review-code
description: Architectural code review — find deepening opportunities via the architecture-reviewer agent and present them as an HTML report with a grilling loop. Runs as the final step of /build (scoped to ONLY the feature's changes), or standalone — no arguments reviews the entire codebase, arguments name the area to review. Based on Matt Pocock's improve-codebase-architecture skill.
argument-hint: [area or module to review — empty for the entire codebase]
---

# Review Code

Surface architectural friction and propose **deepening opportunities** — refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability. This skill is a wrapper: the codebase walking happens in the `architecture-reviewer` agent; the report rendering and the grilling conversation stay here in the main session.

## Scope — determined by how you were invoked

- **From `/build` (the pipeline's final step):** review **ONLY the changes** — the feature's diff against the branch point (`git diff --name-only <branch-point>`), never pre-existing code the feature didn't touch. Pass the changed-file list to the agent.
- **Standalone, no arguments:** review the **entire codebase**.
- **Standalone, with arguments:** `$ARGUMENTS` names the area or module to review; resolve it to files/directories and pass that scope to the agent.

## Glossary

Use these terms exactly in every suggestion. Consistent language is the point — don't drift into "component," "service," "API," or "boundary." Full definitions in [language.md](references/language.md).

- **Module** — anything with an interface and an implementation (function, class, package, slice).
- **Interface** — everything a caller must know to use the module: types, invariants, error modes, ordering, config. Not just the type signature.
- **Implementation** — the code inside.
- **Depth** — leverage at the interface: a lot of behaviour behind a small interface. **Deep** = high leverage. **Shallow** = interface nearly as complex as the implementation.
- **Seam** — where an interface lives; a place behaviour can be altered without editing in place. (Use this, not "boundary.")
- **Adapter** — a concrete thing satisfying an interface at a seam.
- **Leverage** — what callers get from depth.
- **Locality** — what maintainers get from depth: change, bugs, knowledge concentrated in one place.

Key principles (see [language.md](references/language.md) for the full list):

- **Deletion test**: imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.
- **The interface is the test surface.**
- **One adapter = hypothetical seam. Two adapters = real seam.**

This skill is _informed_ by the project's domain model. The domain language gives names to good seams; ADRs record decisions the skill should not re-litigate.

## Place in the Pipeline

`/review-code` is the **final step of the `/build` pipeline**: after implementation and its review chain complete, `/build` runs this skill scoped to the feature's changes, and the resulting report is where the user decides whether to **commit** the work as-is or act on the review's findings first (via `/refactor` for scoped deepenings, or another `/build` round for interface-changing ones).

It also runs standalone, invoked whenever the user feels architectural friction:

- A sub-system has grown hard to navigate
- A periodic "architectural health check" (no arguments — entire codebase)
- A grilling session keeps tripping over the same friction (arguments — that area)

For surface-level cleanup right after implementation (dead code, unused imports, quick reuse opportunities) the `refactorer` agent's hygiene sweep already runs inside `/code`. `/review-code` is for deeper structural questions.

## Process

### 1. Discover via the agent

Read the project's domain glossary (`CONTEXT.md`) and any ADRs in the area first — their vocabulary and recorded decisions frame the review.

Resolve the scope per the rules above, then run the `architecture-reviewer` agent (via the Agent tool) with: the scope (changed-file list, area files, or "entire codebase"), the relevant `CONTEXT.md` terms, and any ADR numbers in the area. The agent walks the code, applies the **deletion test**, and returns structured candidates (files, problem, solution, benefits, before/after sketch, strength, ADR conflicts). It never edits and never proposes final interfaces — that's the grilling loop's job.

### 2. Present Candidates as an HTML Report

Render the agent's findings as a self-contained HTML file written to the OS temp directory so nothing lands in the repo. Resolve the temp dir from `$TMPDIR`, falling back to `/tmp` (or `%TEMP%` on Windows), and write to `<tmpdir>/architecture-review-<timestamp>.html` so each run gets a fresh file. Open it for the user — `xdg-open <path>` on Linux, `open <path>` on macOS, `start <path>` on Windows — and tell them the absolute path.

The report uses **Tailwind via CDN** for layout and styling, and **Mermaid via CDN** for diagrams where a graph/flow/sequence reliably communicates the structure. Mix Mermaid with hand-crafted CSS/SVG visuals — use Mermaid when relationships are graph-shaped (call graphs, dependencies, sequences), and hand-built divs/SVG when you want something more editorial (mass diagrams, cross-sections, collapse animations). Each candidate gets a **before/after visualisation**. Be visual.

Each of the agent's candidates renders as a card:

- **Files** — which files/modules are involved
- **Problem** — why the current architecture is causing friction
- **Solution** — plain English description of what would change
- **Benefits** — explained in terms of locality and leverage, and how tests would improve
- **Before / After diagram** — side-by-side, custom-drawn, illustrating the shallowness and the deepening
- **Recommendation strength** — one of `Strong`, `Worth exploring`, `Speculative`, rendered as a badge

End the report with a **Top recommendation** section: which candidate you'd tackle first and why.

**Use CONTEXT.md vocabulary for the domain, and [language.md](references/language.md) vocabulary for the architecture.** If `CONTEXT.md` defines "Order," talk about "the Order intake module" — not "the FooBarHandler," and not "the Order service."

**ADR conflicts**: if a candidate contradicts an existing ADR, only surface it when the friction is real enough to warrant revisiting the ADR. Mark it clearly in the card (e.g. a warning callout: _"contradicts ADR-0007 — but worth reopening because…"_). Don't list every theoretical refactor an ADR forbids.

See [html-report.md](references/html-report.md) for the full HTML scaffold, diagram patterns, and styling guidance.

Do NOT propose interfaces yet. After the file is written, the ask depends on the mode:

- **From `/build`:** this is the pipeline's terminal decision. Ask: "Review's done — commit the feature as-is, or explore one of these findings first?" Any affirmative-to-commit answer ends the pipeline (the user commits; you never do). Picking a candidate enters the grilling loop below.
- **Standalone:** ask "Which of these would you like to explore?"

### 3. Grilling Loop

Once the user picks a candidate, drop into a grilling conversation. Walk the design tree with them — constraints, dependencies, the shape of the deepened module, what sits behind the seam, what tests survive.

Side effects happen inline as decisions crystallize:

- **Naming a deepened module after a concept not in `CONTEXT.md`?** Add the term to `CONTEXT.md` — same discipline as `/grill` (see [context-format.md](../shared/references/context-format.md)). Create the file lazily if it doesn't exist.
- **Sharpening a fuzzy term during the conversation?** Update `CONTEXT.md` right there.
- **User rejects the candidate with a load-bearing reason?** Offer an ADR, framed as: _"Want me to record this as an ADR so future architecture reviews don't re-suggest it?"_ Only offer when the reason would actually be needed by a future explorer to avoid re-suggesting the same thing — skip ephemeral reasons ("not worth it right now") and self-evident ones. See [adr-format.md](../shared/references/adr-format.md).
- **Want to explore alternative interfaces for the deepened module?** See [interface-design.md](references/interface-design.md).

### 4. Execute (handoff)

When a grilled candidate is ready to happen, hand it off — this skill never edits code:

- A **scoped deepening** (boundaries agreed, behavior preserved) → run `/refactor` with the agreed transformation as the goal.
- An **interface-changing deepening** (new seams, callers migrate) → take it through `/build`; the grilling you just did is a head start on Phase 1.
- **Not now** → the report file is disposable; anything worth keeping went into `CONTEXT.md` or an ADR during the loop.
