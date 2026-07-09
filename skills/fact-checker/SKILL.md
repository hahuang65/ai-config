---
name: fact-checker
description: Verify the factual accuracy of a document (spec, tasks, or a generated HTML review page) against the actual codebase and git history, correct inaccuracies in place, and add a verification summary. Run after implementation to catch drift between docs and code.
argument-hint: "[path to the document — defaults to the newest HTML in the current feature directory]"
---

# Fact Checker

Verify the factual accuracy of a document that makes claims about a codebase. Read the file, extract every verifiable claim, check each against the actual code and git history, correct inaccuracies in place, and add a verification summary.

> Named `fact-checker`, **not** `fact-check`, on purpose: `/fact-check` is a Claude Code built-in, so a same-named primitive would shadow it and confuse which one runs. `fact-checker` is our own, available on every harness.

For HTML files: inspect the target file's own `<style>` block to match its existing aesthetic (colors, fonts, card patterns) when inserting the verification summary. Do not load the `visual-explainer` skill — the target file's own CSS is the source of truth for styling.

## Target Document

Determine what to verify from the argument:

- **Explicit path** → verify that specific file (`.html`, `.md`, or any text document).
- **No argument** → verify the most recently modified `.html` file in the current feature directory under `docs/features/` (`ls -t docs/features/**/*.html | head -1`).

Auto-detect the document type and adjust the verification strategy:

- **HTML review pages** (diff-review, plan-review, project-recap): detect from page content; verify against the git ref or plan file the review was based on.
- **Plan / spec documents** (markdown, e.g. `spec.md`, `tasks.md`): verify file references, function/type names, behavior descriptions, and architecture claims against the current codebase.
- **Any other document**: extract and verify whatever factual claims about code it contains.

## Phase 1: Extract claims

Read the file. Extract every verifiable factual claim:

- **Quantitative** — line counts, file counts, function/module/test counts, any numeric metric
- **Naming** — function names, type names, module names, file paths referenced in the document
- **Behavioral** — descriptions of what code does, how things work, before/after comparisons
- **Structural** — architecture claims, dependency relationships, import chains, module boundaries
- **Temporal** — git history claims, commit attributions, timeline entries

Skip subjective analysis (opinions, design judgments, readability assessments) — these aren't verifiable facts.

## Phase 2: Verify against source

For each extracted claim, go to the source:

- Re-read every file referenced in the document — check signatures, type definitions, and behavior against the actual code.
- For git-history claims: re-run git commands (`git diff --stat`, `git log`, `git diff --name-status`, etc.) and compare against the document's numbers.
- For diff-reviews: read both the ref version (`git show <ref>:file`) and the working-tree version to verify before/after claims aren't swapped or fabricated.
- For plan docs: verify that the files, functions, and types referenced actually exist and behave as described.
- For project-recaps: re-run `git log` commands to verify the activity narrative and timeline.

Classify each claim: **Confirmed** (matches exactly), **Corrected** (was inaccurate — note what was wrong and the correct value), or **Unverifiable** (can't be checked — missing file, runtime-only behavior).

## Phase 3: Correct in place

Edit the file directly with surgical replacements:

- Fix incorrect numbers, names, paths, and behavior descriptions; fix before/after swaps (a common review-page error).
- If a section is fundamentally wrong (not just a detail), rewrite that section's content while preserving the surrounding structure.
- **HTML**: preserve layout, CSS, animations, and Mermaid diagrams (unless a node label or edge description is factually wrong).
- **Markdown**: preserve heading structure, formatting, and organization.

## Phase 4: Add a verification summary

- **HTML files**: insert a verification section (banner at the top or a final section) matching the page's existing styling — a subtle card with muted colors.
- **Markdown files**: append a `## Verification Summary` section at the end.

Include: total claims checked, claims confirmed (count), corrections made (brief list — e.g. "Changed `processCleanup` → `runCleanup` to match `worker.ts:45`"), and any unverifiable claims flagged.

## Phase 5: Report

Tell the user what was checked, what was corrected, and open the file (HTML in the browser, markdown path in chat). If nothing needed correction, say so — confirmation still has value.

This is **not a re-review**: it does not second-guess analysis, opinions, or design judgments, and it does not change the document's structure or organization. It verifies that the data matches reality, corrects what doesn't, and leaves everything else alone. Write corrections to the original file.
