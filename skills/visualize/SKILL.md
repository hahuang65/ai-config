---
name: visualize
description: Explain a system, plan, data set, or scoped code change in self-contained HTML, including before-and-after comparisons grounded in current sources.
---

# Visualize

Clarify the question the visual should answer and inspect relevant context and current sources.
Choose a simple diagram, table, timeline, or comparison that makes the facts easier to understand.
Do not impose a design system, slide deck, or large report when a small page is enough.
Use the project's language and define unfamiliar terms.

## Explain a change

Establish an explicit base, target, and file scope before comparing changes.
Ask when a branch, commit, range, or working-tree target is ambiguous; do not assume a default branch.
For working-tree scope, distinguish staged, unstaged, and relevant untracked files.
Read both the before and after code plus the nearby interfaces needed to understand the change.
Do not switch branches, modify sources, or fetch remote content merely to create a diagram.

Show the problem, before-and-after behavior or structure, affected interfaces, and important invariants.
Reference source paths and authoritative decisions so the explanation can be checked.
Describe actual test evidence separately from intended coverage or checks not run.
Do not fabricate rationale, rejected alternatives, measurements, review findings, or evidence.
If a reason is unknown, say so; label any useful interpretation as inference, not an agreed decision.
This explanation is not a substitute for [change review](../review-change/SKILL.md) and does not claim approval.

## Render and present

Write one self-contained HTML file with inline CSS and semantic elements.
For feedback, decisions, or approval through `review-artifact`, build diagrams with static HTML/CSS or a supported raster image (PNG, JPEG, WebP, or GIF) confined to the HTML directory or embedded as bounded data.
The review sanitizer removes SVG; never ask the user to approve a diagram that will not appear there.
Use inline SVG only for informational pages opened in the ordinary browser, not for `review-artifact` decisions.
No external resources or scripts: avoid remote fonts, libraries, analytics, and executable page scripts.
Escape source text, keep labels readable, use useful captions, and do not rely on color alone.
Check narrow layouts, reading order, contrast, and overflow.
Do not hide a second content model or fabricate screenshots.

Follow the project's artifact convention, otherwise use a descriptive file in an agreed documentation or OS temp location.
Do not overwrite an existing authoritative artifact without permission.
Open informational output in the ordinary browser with the platform's normal opener and give the absolute path.
If requesting feedback, a decision, or approval, use [review-artifact](../review-artifact/SKILL.md) instead and update the same file.
If browser tools are unavailable, state that limit; never claim the page was inspected or approved.
A request for visualization does not authorize implementation or publication.
