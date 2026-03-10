# Research: /build-feature Pipeline Testing Framework

## Overview

The `/build-feature` pipeline is a 3-phase AI-assisted development workflow — Research → Plan → Implement — orchestrated by `skills/build-feature/SKILL.md`. It coordinates 4 skills, 6 agents, 13 commands, 6 rules, and a visual-explainer system with 6 reference files, 4 templates, and a core quality guide. There are currently **zero automated tests** for any of this.

The pipeline is a configuration-as-code system: markdown files define behavior, YAML frontmatter defines metadata, and `install.sh` symlinks everything into `~/.claude/`. Testing this system means verifying that the configuration is internally consistent, complete, and correctly wired.

## Architecture

### Layer Model

```
Layer 4: Orchestrator     skills/build-feature/SKILL.md
                          ↓ invokes via Skill tool
Layer 3: Phase Skills     skills/research/SKILL.md
                          skills/plan/SKILL.md
                          skills/implement/SKILL.md
                          ↓ invoke via Agent tool + Skill tool
Layer 2: Agents           agents/tdd-guide.md        (sonnet)
          & Commands      agents/architect.md         (opus)
                          agents/code-reviewer.md     (sonnet)
                          agents/refactor-cleaner.md  (sonnet)
                          agents/database-reviewer.md (sonnet)
                          agents/doc-updater.md       (sonnet)
                          commands/generate-architecture-diagram.md
                          commands/generate-visual-plan.md
                          commands/diff-review.md
                          commands/fact-check.md
                          + /simplify (built-in)
                          ↓ read reference files
Layer 1: References       skills/visual-explainer/core.md
          & Rules         skills/visual-explainer/references/css-core.md
                          skills/visual-explainer/references/css-mermaid.md
                          skills/visual-explainer/references/css-components.md
                          skills/visual-explainer/references/libraries.md
                          skills/visual-explainer/references/responsive-nav.md
                          skills/visual-explainer/references/slide-patterns.md
                          skills/visual-explainer/templates/*.html (4 files)
                          rules/*.md (6 files)
```

### Domain Skills (loaded conditionally by /plan)

- `skills/api-design/SKILL.md` — REST API patterns
- `skills/frontend-patterns/SKILL.md` — Frontend component/state patterns
- `frontend-design` — referenced but not found in this repo (may be external)

### Installation

`install.sh` creates symlinks:
- `skills/*/` → `~/.claude/skills/*/` (directory symlinks)
- `rules/*.md` → `~/.claude/rules/*.md` (file symlinks)
- `commands/*.md` → `~/.claude/commands/*.md` (file symlinks)
- `agents/*.md` → `~/.claude/agents/*.md` (file symlinks)
- Also installs to OpenCode: `commands/*.md` → `~/.config/opencode/commands/*.md`

## Key Files

| File | Lines | Role |
|------|-------|------|
| `skills/build-feature/SKILL.md` | 166 | Orchestrator — 3-phase workflow |
| `skills/research/SKILL.md` | 98 | Phase 1 — deep codebase investigation |
| `skills/plan/SKILL.md` | 180 | Phase 2 — plan + annotation cycles |
| `skills/implement/SKILL.md` | 100 | Phase 3 — execute plan with agents |
| `agents/tdd-guide.md` | 80 | TDD red-green-refactor cycle |
| `agents/architect.md` | 98 | Architecture review |
| `agents/code-reviewer.md` | 141 | Code review + OWASP security |
| `agents/refactor-cleaner.md` | 77 | Dead code detection/removal |
| `agents/database-reviewer.md` | 72 | SQL/schema/performance review |
| `agents/doc-updater.md` | 63 | Documentation sync |
| `commands/fact-check.md` | 62 | Verify document claims against code |
| `commands/generate-architecture-diagram.md` | 21 | Architecture HTML diagrams |
| `commands/generate-visual-plan.md` | 88 | Visual plan HTML pages |
| `commands/diff-review.md` | 68 | Visual diff review HTML pages |
| `skills/visual-explainer/SKILL.md` | 416 | Full VE skill (general-purpose) |
| `skills/visual-explainer/core.md` | 93 | Compact quality guide for commands |
| `install.sh` | 117 | Symlink installer |

## Data Flow

### Full /build-feature Pipeline

```
Phase 1: Research
  build-feature → invokes research skill
    research → reads codebase files
    research → writes research.md
    research → invokes /generate-architecture-diagram
      command → reads core.md, css-core, css-mermaid, libraries, architecture template
      command → writes architecture.html
    research → STOP (wait for user)

Phase 2: Plan
  build-feature → invokes plan skill
    plan → reads research.md + source files
    plan → (conditional) invokes architect agent
      architect → reads rules/coding-style, rules/performance, rules/security
      architect → reads codebase
    plan → (conditional) invokes domain skills (api-design, frontend-patterns)
    plan → writes plan.md
    plan → STOP (wait for annotations)
    plan → (loop) address annotations → update plan.md → STOP
    plan → generates todo list in plan.md
    plan → invokes /generate-visual-plan
      command → reads core.md, css-core, css-mermaid, css-components, libraries
      command → writes visual-plan.html
    plan → STOP (wait for "implement")

Phase 3: Implement
  build-feature → invokes implement skill
    implement → reads plan.md
    implement → (loop) invokes tdd-guide agent (batches of 3-5 tasks)
      tdd-guide → reads rules/testing, rules/coding-style
      tdd-guide → writes code + tests
    implement → marks tasks [x] in plan.md
    implement → runs verify loop (type check, lint, test, build)
    implement → (conditional) invokes database-reviewer agent
      database-reviewer → reads rules/security, rules/performance
    implement → invokes /simplify
    implement → invokes refactor-cleaner agent
      refactor-cleaner → reads rules/coding-style
    implement → invokes code-reviewer agent
      code-reviewer → reads rules/coding-style, testing, security, performance
    implement → (conditional) invokes doc-updater agent
      doc-updater → reads rules/git-workflow
    implement → invokes /fact-check on plan.md
    implement → (conditional) refreshes visual-plan.html
    implement → reports completion

  build-feature → (conditional, if VE available)
    invokes /diff-review
      command → reads core.md, css-core, css-mermaid, css-components, libraries
      command → writes diff-review.html
    invokes /fact-check on diff-review.html
```

### Artifact Production

Each /build-feature run produces these files in `docs/claude/<timestamp>-<slug>/`:

| File | Phase | Required | Producer |
|------|-------|----------|----------|
| `research.md` | 1 | Yes | research skill |
| `architecture.html` | 1 | Conditional (VE) | /generate-architecture-diagram |
| `plan.md` | 2 | Yes | plan skill |
| `visual-plan.html` | 2 | Conditional (VE) | /generate-visual-plan |
| `diff-review.html` | 3 | Conditional (VE) | /diff-review |

## Patterns & Conventions

### Frontmatter Schema

Skills use YAML frontmatter with these fields:
- `name` (required): skill identifier
- `description` (required): what the skill does
- `argument-hint` (optional): placeholder for arguments
- `model` (optional): `opus` or `sonnet` (default varies)
- `disable-model-invocation` (optional): `true` for orchestrators

Agents use:
- `name` (required): agent identifier
- `description` (required): what the agent does
- `tools` (required): JSON array of tool names
- `model` (optional): `opus` or `sonnet`

Commands use:
- `description` (required): what the command does

### Cross-Reference Patterns

References fall into categories:
1. **Skill → Skill**: `build-feature` invokes `research`, `plan`, `implement` via Skill tool
2. **Skill → Agent**: `implement` invokes `tdd-guide`, `code-reviewer`, etc. via Agent tool; `plan` invokes `architect`
3. **Skill → Command**: `research` invokes `/generate-architecture-diagram`; `plan` invokes `/generate-visual-plan`; `implement` invokes `/simplify`, `/fact-check`, `/generate-visual-plan`
4. **Command → Reference**: commands read VE reference files by absolute path (`~/.claude/skills/visual-explainer/...`)
5. **Agent → Rules**: agents read rule files from `rules/` or `~/.claude/rules/`

### Reference Path Conventions

- Commands reference VE files as: `~/.claude/skills/visual-explainer/references/<file>`
- VE SKILL.md references its own files as: `./references/<file>`
- Agents reference rules as: `rules/` or `~/.claude/rules/`

## Dependencies

### Internal Dependencies (what references what)

**Agents and their rule dependencies:**
| Agent | Rules Read |
|-------|-----------|
| tdd-guide | testing, coding-style |
| architect | coding-style, performance, security |
| code-reviewer | coding-style, testing, security, performance |
| refactor-cleaner | coding-style |
| database-reviewer | security, performance |
| doc-updater | git-workflow |

**Commands and their VE reference dependencies:**
| Command | References Read |
|---------|----------------|
| generate-architecture-diagram | core.md, css-core, css-mermaid, libraries, templates/architecture.html |
| generate-visual-plan | core.md, css-core, css-mermaid, css-components, libraries |
| diff-review | core.md, css-core, css-mermaid, css-components, libraries |
| plan-review | core.md, css-core, css-mermaid, css-components, libraries |
| project-recap | core.md, css-core, css-mermaid, css-components, libraries |
| generate-web-diagram | core.md, css-core, css-mermaid, css-components, libraries |
| generate-slides | core.md, css-core, css-mermaid, css-components, libraries, slide-patterns |

### External Dependencies

- Google Fonts (loaded by VE-generated HTML)
- Mermaid.js CDN (loaded by VE-generated HTML)
- `gh` CLI (used by diff-review for PR diffs)
- `surf` CLI (optional, for AI image generation)
- Browser (to view generated HTML)

## Edge Cases & Gotchas

### 1. Symlink Fragility

`install.sh` creates symlinks but has no verification. If:
- A source file is renamed/deleted, symlinks become dangling
- A new file is added but install.sh isn't re-run, it won't be available
- Symlink targets use absolute paths, so moving the dotfiles repo breaks everything

### 2. Cross-Reference Staleness

The biggest risk. When a file is renamed, moved, or deleted, references from other files go stale. This happened recently when `css-patterns.md` was split into 3 modules — 10+ files needed updating. There's no mechanism to detect stale references except manual grep.

### 3. Agent Tool Lists

Agent frontmatter declares available tools as a JSON array. If a tool name changes in Claude Code, or a new tool is needed, the frontmatter must be updated. No validation exists.

### 4. Frontmatter Schema Drift

There's no schema validation for frontmatter. A typo in `tools` array or missing `name` field would silently fail at runtime.

### 5. Rule File Coverage

Each agent declares which rules it reads. If a new rule is added, no existing agent automatically picks it up. The mapping is manual.

### 6. Step Numbering in guide.html Files

The guide.html files for build-feature, implement, plan, and research contain step numbers, agent step references, and Mermaid flowcharts that must stay in sync with the SKILL.md files. These are manually maintained.

### 7. VE Reference Path Mismatch

Commands use `~/.claude/skills/visual-explainer/references/...` while SKILL.md uses `./references/...`. If the skill directory structure changes, one convention might break while the other works.

### 8. Conditional Steps Without Feature Flags

Several implement steps are conditional ("if DB code touched", "if feature warrants it") but the criteria are prose descriptions, not machine-checkable conditions. The model must interpret them each time.

### 9. Built-in Skill Dependencies

`implement/SKILL.md` invokes `/simplify` and `plan/SKILL.md` references `frontend-design` — both are built-in Claude Code skills with no local files. These external dependencies can't be validated by local tests.

### 10. Plan Document as Mutable Shared State

The plan.md file is read and written by multiple phases. The implement skill marks tasks `[x]`, fact-check edits claims, and annotation cycles modify content. Concurrent edits (if somehow triggered) could corrupt the file.

## Current State

### No Tests Exist

There are zero test files, test scripts, or test infrastructure in this repository. The entire pipeline is validated manually by running it end-to-end and inspecting outputs.

### Recent Changes (Token Optimization)

A recent commit (`28f3793`) made significant structural changes:
- Split `css-patterns.md` into 3 modules
- Created `/generate-architecture-diagram` command
- Merged `security-reviewer` into `code-reviewer`
- Made `architect` conditional in plan skill
- Added tdd-guide batching in implement skill
- Removed redundant rules reads from plan/implement

These changes touched 28 files and created new cross-references that could have introduced inconsistencies.

### File Counts

- 7 skills (4 pipeline + 3 domain/utility)
- 6 agents
- 13 commands
- 6 rules
- 6 VE reference files + 1 core guide + 4 templates
- 4 guide.html files
- 1 install script

### Known Issues

1. Two stub files remain from the token optimization: `css-patterns.md` and `security-reviewer.md` — both contain redirect comments but should be deleted
2. `/simplify` and `frontend-design` are built-in Claude Code skills with no local command files — external dependencies that can't be validated locally
