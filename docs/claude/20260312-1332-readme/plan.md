# Plan: README.md for ai-config

## Goal

Write a comprehensive `README.md` for the `ai-config` repository that primarily onboards readers to the `/build-feature` workflow and secondarily explains the repository's structure and dual-tool configuration.

## Research Reference

`docs/claude/20260312-1332-readme/research.md`

## Approach

The README mirrors the research document's structure — leading with the `/build-feature` pipeline as the hero content, then covering components, conventions, and infrastructure. The tone is practical and direct: a developer reading this should understand how to use `/build-feature` within 2 minutes and grasp the full repo layout within 5.

The document is a single markdown file (`README.md` at repo root) with no external dependencies. It uses standard GitHub-flavored markdown: tables, fenced code blocks, and nested lists. No HTML, no images, no links to external docs.

**Key structural decision**: The README is organized in "importance order" rather than "component order." The `/build-feature` workflow comes first because that's what a new user needs most. Repository structure, installation, and infrastructure come after — they're reference material, not onboarding.

## Detailed Changes

### `README.md` (new file at repo root)

The file has 10 sections in this order:

#### Section 1: Title + One-liner
```markdown
# ai-config

Centralized configuration for AI coding assistants — Claude Code and OpenCode.
```

Short, no badges, no logo. Sets context immediately.

#### Section 2: Quick Start (4 lines)
```markdown
## Quick Start

git clone <repo> ~/.dotfiles/ai
cd ~/.dotfiles/ai
./install.sh
```

Gets the reader to a working install before explaining anything. Three commands, no prose.

#### Section 3: The /build-feature Workflow (hero section)

This is the longest section — approximately 40% of the document. Structured as:

1. **One-paragraph summary**: What it is, why it exists, what it produces.
2. **Feature directory layout**: The `docs/claude/<timestamp>-<slug>/` tree showing all 5 artifacts.
3. **Phase 1: Research**: Succinct numbered list (7 items). Sub-bullets for sections in `research.md` and the visual sync mandate.
4. **Phase 2: Plan**: Succinct numbered list (9 items). Sub-bullets for `plan.md` sections, architect agent callout, reference skill auto-loading, and visual sync mandate.
5. **Phase 3: Implement**: Succinct numbered list (15 items). Each agent-using step explicitly names the agent and its model tier. Sub-bullets for the verification loop details.
6. **Annotation cycles callout**: A short paragraph explaining the `//` annotation convention shared across research and plan phases.
7. **Visual Sync Guarantee callout**: A short paragraph explaining the mandatory HTML regeneration invariant.

#### Section 4: Skill / Rule / Agent Graph

The ASCII tree from the research document, showing `/build-feature` as root with its three phase skills, each skill's agent and rule dependencies:

```
/build-feature (orchestrator)
├── research (opus)
│   └── visual-explainer → research.html
├── plan (opus)
│   ├── architect (opus) → design review
│   ├── frontend-patterns / api-design (loaded if detected)
│   └── visual-explainer → plan.html
└── implement (sonnet)
    ├── tdd-guide (sonnet) → TDD
    ├── code-reviewer (sonnet) → OWASP review
    ├── refactor-cleaner (sonnet) → dead code
    ├── database-reviewer (sonnet) → conditional
    ├── doc-updater (sonnet) → conditional
    └── visual-explainer → plan.html, diff-review.html

Rules (6 files) loaded as always-on context in every session.
Agents read a subset relevant to their role.
```

#### Section 5: Repository Structure

A directory tree with one-line descriptions. This is a reference section — not prose:

```
.
├── skills/           8 workflow skills (build-feature, research, plan, implement, ...)
├── commands/         13 slash commands (/diff-review, /fact-check, ...)
├── agents/           7 sub-agents (architect, tdd-guide, code-reviewer, ...)
├── rules/            6 always-on rules (coding-style, testing, security, ...)
├── claude/           Claude Code config (settings.json, hooks.json, statusline.sh)
├── opencode/         OpenCode config (opencode.jsonc auto-generated, tui.json)
├── config/           Shared config (opencode-only.json)
├── scripts/          Tooling (sync-permissions.py, test-pipeline.sh, hooks/)
├── docs/claude/      Feature artifacts (research, plans, visuals)
├── .githooks/        Pre-commit hook (runs tests + sync)
├── .builds/          CI (sr.ht → GitHub mirror)
└── install.sh        Symlink installer
```

#### Section 6: Components

Four subsections, one per component type. Each is a table:

- **Skills**: name, model, role (8 rows)
- **Commands**: name, description (13 rows)
- **Agents**: name, model, role, rules read (7 rows)
- **Rules**: name, scope (6 rows)

#### Section 7: Dual-Tool Support

A comparison table (Claude Code vs OpenCode) covering: config location, skills, commands, agents, rules, permissions format, hooks. Then a short paragraph about the permission sync pipeline.

#### Section 8: Installation Details

Expands on what `install.sh` does: the 9-step symlink process, the command/skill duality (skipping commands with matching skill directories for Claude Code), and the git hooks setup.

#### Section 9: Infrastructure

Three sub-sections:
- **Permission Sync**: How `sync-permissions.py` works (6-step pipeline)
- **Test Pipeline**: What `test-pipeline.sh` validates (7 categories)
- **CI**: sr.ht mirror to GitHub

#### Section 10: License

```markdown
## License

MIT — see [LICENSE](LICENSE).
```

## New Files

| File | Purpose |
|------|---------|
| `README.md` | Repository documentation (repo root) |

## Dependencies

None. The README is plain markdown with no external dependencies.

## Considerations & Trade-offs

1. **Importance-ordered vs. component-ordered structure**: Chose importance-ordered (workflow first, infrastructure last) because the primary audience is someone learning to use `/build-feature`. A component-ordered README would bury the key workflow under installation instructions.

2. **Depth of /build-feature coverage**: The workflow section is deliberately detailed (numbered steps, agent callouts, visual sync) because it's the onboarding goal. Other sections are more terse — tables and trees rather than prose.

3. **No screenshots/images**: The repo produces HTML visuals, but the README itself stays pure markdown for portability and diff-friendliness. Users can open `.html` artifacts in a browser.

4. **ASCII tree for dependency graph**: Using a code block rather than a Mermaid diagram because GitHub renders Mermaid inconsistently and the tree is small enough to read as ASCII.

5. **Single file**: Everything in one `README.md` rather than splitting into `docs/`. The repo already has `docs/claude/` for feature artifacts — a separate docs structure would create confusion about what goes where.

## Migration / Data Changes

None.

## Testing Strategy

This is a documentation-only change. No automated tests apply. Manual verification:

1. **Render check**: Open `README.md` in a GitHub-flavored markdown previewer and verify all tables, code blocks, and nested lists render correctly.
2. **Accuracy check**: Run `/fact-check` on the README against the actual codebase to verify all file paths, counts (8 skills, 13 commands, 7 agents, 6 rules), and behavioral claims are accurate.
3. **Pre-commit passes**: The existing `test-pipeline.sh` should still pass — the README doesn't affect any validated frontmatter or cross-references.

## Todo List

### Phase 1: Write README.md
- [x] Create `README.md` at repo root
- [x] Write Section 1: Title + one-liner
- [x] Write Section 2: Quick Start
- [x] Write Section 3: /build-feature Workflow (hero section with all 3 phases)
- [x] Write Section 4: Skill / Rule / Agent dependency graph
- [x] Write Section 5: Repository Structure (directory tree)
- [x] Write Section 6: Components (skills, commands, agents, rules tables)
- [x] Write Section 7: Dual-Tool Support (comparison table + permission sync)
- [x] Write Section 8: Installation Details
- [x] Write Section 9: Infrastructure (permission sync, test pipeline, CI)
- [x] Write Section 10: License

### Phase 2: Verify
- [x] Render check: preview in GFM renderer, verify tables/lists/code blocks
- [x] Accuracy check: run `/fact-check` against codebase
- [x] Pre-commit check: run `test-pipeline.sh` to verify no regressions (298/298 passed)
