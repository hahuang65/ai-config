---
name: research
description: Deep-read a codebase area and produce a detailed research document. Use when you need to thoroughly understand how a system, feature, or module works before making changes. Based on Boris Tane's research-first workflow.
argument-hint: [folder-or-topic]
model: opus
---

# Research Phase

Perform a deep, thorough investigation of the specified area of the codebase and produce a persistent written artifact capturing all findings.

## File Naming Convention

When invoked **standalone** (not from build-feature), create a feature directory under `docs/claude/`:

```
docs/claude/<YYYYMMDD-HHMM>-<slug>/research.md
```

To generate:
1. Derive a short slug from `$ARGUMENTS` (lowercase, hyphens, no special chars, max ~5 words)
2. Get the current timestamp via `date +%Y%m%d-%H%M`
3. Create directory `docs/claude/<timestamp>-<slug>/` if it doesn't exist
4. Write to `research.md` inside that directory

**Examples:**
- `docs/claude/20260227-1430-notification-system/research.md`
- `docs/claude/20260227-1545-task-scheduling-flow/research.md`

When invoked **from build-feature**, the orchestrator will provide the directory path. Write `research.md` into the provided directory.

## Core Principle

Surface-level reading is NOT acceptable. You must read deeply, understand intricacies, trace flows end-to-end, and identify edge cases. Do not skim files at the signature level and move on.

## Process

1. **Identify the scope**: Determine what area, module, or topic to research based on `$ARGUMENTS`.

2. **Deep-read the code**: Thoroughly explore the relevant code. This means:
   - Read every file in the target area, not just entry points
   - Trace data flows from input to output
   - Understand how components interact with each other
   - Identify patterns, conventions, and architectural decisions
   - Note dependencies on other parts of the system
   - Look for edge cases, error handling, and implicit assumptions
   - Examine tests to understand expected behavior
   - Check configuration files for relevant settings

3. **Write the research document**: Create the file at the path described above. The document MUST include:

   - **Overview**: What the system/module does at a high level
   - **Architecture**: How components are organized and relate to each other
   - **Key Files**: List of important files with their roles
   - **Data Flow**: How data moves through the system
   - **Patterns & Conventions**: Design patterns used, naming conventions, code style
   - **Dependencies**: Internal and external dependencies
   - **Edge Cases & Gotchas**: Non-obvious behavior, implicit assumptions, potential pitfalls
   - **Current State**: Any known issues, tech debt, or areas of concern

4. **Generate visual research diagram**: After writing the research document, invoke `/generate-architecture-diagram` to produce an HTML diagram of the researched area — showing module relationships, data flows, and component boundaries discovered during research. The output MUST be written to `research.html` in the same feature directory as `research.md` (e.g., `docs/claude/20260304-1430-auth-flow/research.html`). Do NOT write to `~/.agent/diagrams/` or any other location. Open it in the browser. **Important**: The generated HTML must use "Research" (not "Architecture") in its `<title>` and `<h1>` header — e.g., `<title>Research — Auth Flow</title>` and `<h1>Auth Flow — Research</h1>`. This is a research document, not an architecture diagram.

5. **Stop and wait for review**: After writing the document and generating the diagram, STOP. Tell the user the exact file path, then:

   > The research document is ready for your review at `<file-path>`.
   > I've also generated a visual architecture diagram at `<diagram-path>` (opened in your browser).
   >
   > To annotate, add `//` comments anywhere in the file:
   >
   > ```markdown
   > ## Data Flow
   >
   > // this actually goes through the message queue first, not directly to the handler
   > Requests are routed directly from the API gateway to the handler...
   >
   > // wrong — we deprecated this in v2.3, it uses the new adapter now
   > The legacy adapter transforms the response before...
   > ```
   >
   > Just type `//` followed by your note — corrections, missing context, or things I got wrong. Then tell me to address your notes.

   Do NOT proceed to planning or implementation.

6. **Address annotations**: When the user says they've added notes:

   1. Read the updated research document
   2. Find ALL `//` annotations the user added (lines starting with `//` or containing `//` after content)
   3. Address every single note — do not skip any
   4. Update the research document accordingly
   5. Remove the user's `//` annotations as you address them (so they don't accumulate)
   6. **Regenerate `research.html`** to stay in sync with the updated research document. This is mandatory — even if the user says to move on to planning, the visual MUST be updated first.
   7. STOP and tell the user the research is updated, ready for another review

   **Do NOT proceed to planning or implementation.** Repeat this cycle until the user explicitly says the research is acceptable.

   **Non-negotiable**: The visual HTML file (`research.html`) MUST always mirror the markdown (`research.md`). Whenever the markdown changes — whether from annotations, corrections, or any other update — regenerate the HTML before proceeding to ANY next step, including moving to the plan phase.

## Important Guidelines

- The written artifact is the deliverable, not a verbal summary in chat
- Be exhaustive - it's better to include too much detail than too little
- Include specific file paths and line references
- If something is unclear or seems buggy, call it out explicitly
- Do NOT make changes to any code during research
- Do NOT propose solutions or plans - that comes later

## Output

The result is a research document in `docs/claude/` that serves as a verified knowledge base for subsequent planning and implementation phases. The user will review it to confirm you understood the system correctly before any work begins.

Ultrathink.

