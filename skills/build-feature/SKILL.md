---
name: build-feature
description: Full feature development workflow combining research, planning with annotation cycles, and implementation — with visual-explainer integration for rich HTML diagrams at each phase transition. Based on Boris Tane's disciplined AI coding workflow.
argument-hint: [feature-description]
disable-model-invocation: true
---

# Build Feature - Full Workflow

A disciplined 3-phase workflow for building features with AI assistance. Each phase produces a persistent markdown artifact in `docs/claude/` that serves as shared state between you and the user.

**Visual integration (optional)**: If the `visual-explainer` skill is available, it is used at each phase transition to produce rich HTML pages — architecture diagrams after research, visual plans after planning, and diff reviews after implementation. If `visual-explainer` is not installed, all visual steps are silently skipped — the workflow proceeds normally with just the markdown artifacts.

**Workflow**: Research deeply -> Write a plan -> Annotate the plan until it's right -> Execute the whole thing.

This skill orchestrates three sub-skills, optionally using visual-explainer at phase transitions. You can also use each phase independently:
- `/research [folder-or-topic]` - Phase 1 only
- `/plan [feature-description]` - Phase 2 only
- `/implement [plan-filename]` - Phase 3 only

If visual-explainer is installed, these commands are also available standalone:
- `/generate-architecture-diagram` - Generate a visual HTML architecture diagram
- `/generate-web-diagram` - Generate an HTML diagram for any topic
- `/generate-visual-plan` - Generate a visual implementation plan
- `/generate-slides` - Generate a magazine-quality slide deck
- `/diff-review` - Visual diff review with architecture comparison
- `/plan-review` - Compare a plan against the codebase with risk assessment
- `/project-recap` - Mental model snapshot for context-switching
- `/fact-check` - Verify accuracy of a document against actual code

## File Naming Convention

Each feature gets a single directory under `docs/claude/` in the project root:

```
docs/claude/<YYYYMMDD-HHMM>-<slug>/
```

All artifacts live together in that directory. Visual HTML files share the same base name as their markdown counterpart:

```
docs/claude/20260304-1430-cursor-pagination/
  research.md          # Phase 1 output
  research.html        # Phase 1 visual companion (if visual-explainer available)
  plan.md              # Phase 2 output
  plan.html            # Phase 2 visual companion (if visual-explainer available)
  diff-review.html     # Phase 3 visual companion (if visual-explainer available)
```

To generate the directory:
1. Derive a short slug from `$ARGUMENTS` (lowercase, hyphens, no special chars, max ~5 words)
2. Get the current timestamp via `date +%Y%m%d-%H%M`
3. Create the directory: `docs/claude/<timestamp>-<slug>/`

This directory is created once at the start of the workflow and reused across all three phases. When sub-skills are invoked, pass the directory path so they write into it.

---

## Phase 1: Research

Invoke the research skill to deeply understand the relevant area of the codebase.

Use the Skill tool to invoke `research` with the relevant scope derived from `$ARGUMENTS`.

The research skill will automatically generate a visual architecture diagram (`research.html`) if `visual-explainer` is available.

After the research phase completes, STOP and tell the user:

> **Phase 1 complete.** I've written the research document at `<file-path>`.
> *(If diagram was generated: "I've also generated an architecture diagram at `<diagram-path>` (opened in your browser).")*
>
> Please review to make sure I understood the system correctly.
>
> When you're satisfied with the research, say **"move to planning"** and I'll create the implementation plan.

**Wait for the user to confirm before proceeding.**

---

## Phase 2: Planning + Annotation Cycles

Once the user confirms the research is acceptable, invoke the plan skill.

Use the Skill tool to invoke `plan` with the feature description from `$ARGUMENTS`.

The plan skill will handle:
1. Writing a plan document with detailed implementation steps, code snippets, and a proposed task list
2. Generating a visual implementation plan (`plan.html`) alongside the markdown — both presented together for easier review
3. Waiting for the user to annotate the markdown
4. Addressing all annotations, updating the plan and regenerating the visual to stay in sync
5. Repeating the annotation cycle (typically 1-6 times)
6. Finalizing the todo list and visual plan when the user approves

**The plan phase is complete when the user explicitly approves the plan.**

Then tell the user:

> **Phase 2 complete.** The plan is approved and the todo list is ready.
> *(If visual was generated: "I've also updated the visual plan at `<diagram-path>` (opened in your browser) for a spatial overview.")*
>
> Say **"implement"** when you're ready for me to start building.

**Wait for the user to trigger implementation.**

---

## Phase 3: Implementation

Once the user triggers implementation, invoke the implement skill with the plan filename.

Use the Skill tool to invoke `implement` with the plan document filename from Phase 2.

The implement skill will:
1. Execute all tasks from the plan
2. Track progress by checking off items in the plan document
3. Run type checks and linters continuously
4. Handle feedback corrections from the user
5. Regenerate `plan.html` to reflect the final implementation state
6. Generate a visual diff review (`diff-review.html`) if `visual-explainer` is available
7. Verify plan-to-implementation sync — ensuring the plan, visual, and code all agree

Tell the user:

> **Implementation complete.** All tasks from the plan have been executed.
> *(If diff review was generated: "I've generated a fact-checked visual diff review at `<diagram-path>` (opened in your browser) summarizing everything that changed.")*

---

## Session Management

This entire workflow is designed to run in a **single long session**. By the time implementation starts, you've built deep understanding through research and planning. All artifacts — markdown and visual HTML — live together in the feature directory under `docs/claude/`, survive context compaction, and can be re-read at any point.

## Key Principles

1. **Never write code before the plan is approved** - the "don't implement yet" guard is essential
2. **The markdown files are the deliverables** - not chat summaries
3. **The visual HTML pages are companions** - they provide spatial understanding that markdown can't
4. **The user injects judgment through annotations** - domain knowledge, business constraints, engineering trade-offs
5. **Implementation should be boring** - all creative decisions happen during planning
6. **Terse corrections are fine during implementation** - the context is already established

## Visual-Explainer Integration Notes

The visual-explainer skill is **optional**. All visual steps are skipped gracefully if it is not installed.

When available, it produces self-contained HTML files with:
- Mermaid diagrams for flowcharts, sequence diagrams, state machines
- CSS Grid layouts for architecture overviews
- Styled HTML tables for data comparisons
- Dark/light theme support
- Zoom controls on all diagrams

When available, it also activates **proactively** during any phase: when about to render a complex table (4+ rows or 3+ columns) in the terminal, it generates an HTML table instead and opens it in the browser.

## Cleanup

After the feature is complete, the user can decide whether to:
- Keep the feature directory in `docs/claude/` for future reference
- Delete it
- Add `docs/claude/` to `.gitignore` if desired
- Commit the directory alongside the feature for posterity
