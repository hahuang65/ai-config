---
name: research
description: Deep-read a codebase area and produce a detailed research document. Use when you need to thoroughly understand how a system, feature, or module works before making changes. Based on Boris Tane's research-first workflow.
argument-hint: [folder-or-topic]
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

4. **Stop and wait for review**: After writing the document, STOP. Tell the user the exact file path and ask them to review it. Do NOT proceed to planning or implementation.

## Important Guidelines

- The written artifact is the deliverable, not a verbal summary in chat
- Be exhaustive - it's better to include too much detail than too little
- Include specific file paths and line references
- If something is unclear or seems buggy, call it out explicitly
- Do NOT make changes to any code during research
- Do NOT propose solutions or plans - that comes later

## Output

The result is a research document in `docs/claude/` that serves as a verified knowledge base for subsequent planning and implementation phases. The user will review it to confirm you understood the system correctly before any work begins.

## Visual Companion (when invoked from build-feature)

When this skill is invoked as part of the `build-feature` workflow, the orchestrator may generate a visual architecture diagram after the research document is written — but only if the `visual-explainer` skill is available. If it is not available, the visual step is silently skipped. The research skill itself does NOT generate the diagram — it focuses purely on the markdown artifact.
