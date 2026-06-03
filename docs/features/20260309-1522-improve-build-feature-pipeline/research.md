# Research: Improving /build-feature Pipeline from everything-claude-code (ECC)

## Overview

The [everything-claude-code](https://github.com/affaan-m/everything-claude-code) (ECC) repo is a production-ready Claude Code plugin containing 13+ specialized agents, 50+ skills, 33 commands, automated hooks, and cross-editor rules (Claude Code, Cursor, Codex, OpenCode). It's designed as a comprehensive AI coding framework with strong opinions about workflow discipline.

Your current `/build-feature` pipeline is a 3-phase orchestrator (Research → Plan → Implement) with visual-explainer integration. It's well-designed for the core workflow but lacks several patterns and capabilities that ECC has systematized.

## Architecture Comparison

### Your System (current)
```
~/.claude/skills/
├── build-feature/SKILL.md    # Orchestrator (Research → Plan → Implement)
├── research/SKILL.md         # Deep-read + architecture diagram
├── plan/SKILL.md             # Plan + annotation cycles + visual plan
├── implement/SKILL.md        # Execute plan + simplify + fact-check
└── visual-explainer/SKILL.md # HTML diagrams, slides, diff reviews

+ superpowers/ skills:
  - brainstorming, TDD, debugging, code-review, verification, git-worktrees, etc.
```

### ECC System
```
agents/           # 13 specialized subagents (planner, tdd-guide, code-reviewer, security-reviewer, architect, etc.)
skills/           # 50+ domain-knowledge skills (api-design, frontend-patterns, content-engine, etc.)
commands/         # 33 slash commands (/tdd, /plan, /code-review, /orchestrate, /evolve, etc.)
hooks/            # Automated triggers (pre/post tool use, session lifecycle, quality gates)
rules/            # Always-on guidelines split by concern (common-* + language-specific)
mcp-configs/      # 14 MCP server integrations
scripts/          # Cross-platform Node.js utilities for hooks
```

## Key Findings: What ECC Does Differently

### 1. Layered Rules System (common-* rules)

ECC has **9 common rules** that are `alwaysApply: true` — they load into every conversation automatically:

| Rule File | Purpose |
|-----------|---------|
| `common-coding-style.md` | Immutability mandate, file size limits (200-400 lines, 800 max), error handling, input validation |
| `common-development-workflow.md` | Plan → TDD → Review → Commit pipeline |
| `common-git-workflow.md` | Conventional commits format, PR process |
| `common-testing.md` | 80% coverage minimum, TDD mandatory, all 3 test types required |
| `common-security.md` | Pre-commit security checklist, secret management, response protocol |
| `common-patterns.md` | Repository pattern, API response envelope, skeleton project discovery |
| `common-agents.md` | Agent orchestration table, parallel execution patterns, multi-perspective analysis |
| `common-hooks.md` | Hook types, auto-accept permissions, TodoWrite best practices |
| `common-performance.md` | Model selection strategy (Haiku/Sonnet/Opus), context window management |

These are supplemented by **language-specific rules** (e.g., `typescript-coding-style.md`, `python-security.md`, `golang-patterns.md`, `swift-testing.md`) that extend the common rules with language-specific patterns.

**Gap in your system**: Your `CLAUDE.md` and superpowers skills cover some of this, but there's no equivalent of always-on common rules that establish baseline standards for every conversation. Your pipeline assumes the user/project has its own standards, rather than providing opinionated defaults.

### 2. Specialized Agent Delegation

ECC defines 13+ agents as markdown files with YAML frontmatter specifying:
- `name`, `description`, `tools` (which tools the agent can use), `model` (which model tier)
- Full prompt with review checklists, output formats, worked examples

Key agents relevant to your pipeline:

| Agent | Model | Tools | What It Does |
|-------|-------|-------|-------------|
| `planner` | opus | Read, Grep, Glob | Creates phased implementation plans with worked examples |
| `code-reviewer` | sonnet | Read, Grep, Glob, Bash | Confidence-based review (>80% sure), CRITICAL/HIGH/MEDIUM/LOW severity |
| `tdd-guide` | sonnet | Read, Write, Edit, Bash, Grep | Enforces Red-Green-Refactor, 80%+ coverage, edge case checklist |
| `security-reviewer` | sonnet | All | OWASP Top 10 check, pattern-based vulnerability detection |
| `architect` | opus | Read, Grep, Glob | System design and scalability decisions |
| `build-error-resolver` | sonnet | All | Fix build/type errors incrementally |
| `refactor-cleaner` | sonnet | All | Dead code cleanup |

**Gap in your system**: Your pipeline uses the superpowers skills (TDD, code review, debugging) but doesn't define dedicated agent profiles with model selection and tool restrictions. ECC's approach of defining agents as separate files with explicit model tiers (use Sonnet for reviews, Opus for planning) is more cost-efficient and allows parallel execution.

### 3. Hooks System (Automated Quality Gates)

ECC has a sophisticated hooks system that runs automatically:

**Pre-Tool Hooks:**
- `auto-tmux-dev.js` — Auto-start dev servers in tmux
- `pre-bash-tmux-reminder.js` — Remind to use tmux for long-running commands
- `pre-bash-git-push-reminder.js` — Review changes before pushing
- `doc-file-warning.js` — Warn about non-standard documentation files
- `suggest-compact.js` — Suggest manual compaction at logical intervals

**Post-Tool Hooks:**
- `post-edit-format.js` — Auto-format JS/TS files after edits (detects Biome or Prettier)
- `post-edit-typecheck.js` — TypeScript check after editing .ts/.tsx
- `post-edit-console-warn.js` — Warn about console.log statements
- `quality-gate.js` — Run quality gate checks after file edits
- `post-bash-pr-created.js` — Log PR URL after creation
- `post-bash-build-complete.js` — Async build analysis

**Session Lifecycle:**
- `session-start.js` — Load previous context and detect environment
- `session-end.js` — Persist session state
- `evaluate-session.js` — Extract patterns from sessions
- `cost-tracker.js` — Track token and cost metrics per session
- `pre-compact.js` — Save state before context compaction

**Stop Hooks:**
- `check-console-log.js` — Audit modified files for console.log

**Continuous Learning:**
- Pre/Post observe hooks that capture tool use patterns for learning

**Gap in your system**: Your pipeline has no automated hooks. Quality checks (linting, formatting, type checking) happen only when the implement skill says to do them. ECC's hooks make these automatic — every edit triggers formatting and type checking, every session tracks cost, every push gets reviewed.

### 4. Domain-Knowledge Skills (Beyond Workflow)

ECC has rich domain-knowledge skills that your pipeline doesn't have:

| Skill | What It Provides |
|-------|-----------------|
| `api-design` | REST API patterns: URL naming, status codes, pagination (offset vs cursor), filtering, rate limiting, versioning, with implementation examples in TS/Python/Go |
| `frontend-patterns` | React component patterns (compound, render props), hooks (debounce, toggle, data fetching), state management (Context+Reducer), performance (virtualization, code splitting), accessibility |
| `backend-patterns` | Repository pattern, caching strategies, database patterns |
| `coding-standards` | Universal coding standards across languages |
| `e2e-testing` | Playwright E2E testing patterns |
| `eval-harness` | Eval-driven development (pass@1, pass@3 stability) |
| `strategic-compact` | Context window management strategies |
| `verification-loop` | Build → test → lint → typecheck → security loop |
| `content-engine` | Platform-native social content creation |
| `article-writing` | Long-form content with voice matching |
| `investor-materials` | Pitch decks, financial models, one-pagers |
| `market-research` | Competitive analysis with source attribution |

**Gap in your system**: Your pipeline focuses on workflow orchestration but doesn't carry domain knowledge. When implementing an API, there's no skill that says "here's how to do pagination, status codes, and error responses." ECC embeds this knowledge so the AI doesn't have to reinvent patterns.

### 5. Plugin Architecture

ECC is packaged as a **Claude Code plugin** with:
- `.claude-plugin/plugin.json` — Plugin metadata, version, configuration schema
- `.claude-plugin/marketplace.json` — Marketplace listing
- `hooks/hooks.json` — Plugin-level hook definitions using `${CLAUDE_PLUGIN_ROOT}` for portability
- `scripts/hooks/run-with-flags.js` — Hook runner with configurable strictness levels (minimal, standard, strict)
- CI validation scripts for agents, commands, hooks, rules, and skills

The plugin supports **flag-based hook configuration** where hooks have strictness levels:
- `minimal` — Basic session tracking only
- `standard` — Quality gates, formatting, type checking
- `strict` — All checks including security review and console.log auditing

**Gap in your system**: Your skills are symlinked from `~/.dotfiles/ai/skills/`. This works but isn't distributable or configurable. ECC's plugin format means others can install it, and the flag system lets users choose their strictness level.

### 6. Multi-Editor Support

ECC maintains parallel configurations for:
- **Claude Code**: `CLAUDE.md`, `AGENTS.md`, `hooks/hooks.json`
- **Cursor**: `.cursor/rules/`, `.cursor/hooks.json`, `.cursor/skills/`
- **Codex**: `.codex/AGENTS.md`, `.codex/config.toml`
- **OpenCode**: `.opencode/instructions/`, `.opencode/commands/`, `.opencode/plugins/`

Each editor gets a tailored version of the same rules and skills. The `.agents/skills/` directory contains skills with OpenAI-compatible YAML agent configs alongside the markdown.

**Observation**: This is ambitious but may be unnecessary for your use case. However, the pattern of having skills that work across tools is worth noting.

### 7. Proactive Agent Invocation

ECC's `AGENTS.md` and `common-agents.md` establish that agents should be used **proactively without user prompts**:

> - Complex feature requests → **planner** agent
> - Code just written/modified → **code-reviewer** agent
> - Bug fix or new feature → **tdd-guide** agent
> - Architectural decision → **architect** agent
> - Security-sensitive code → **security-reviewer** agent

This is enforced through hooks (post-edit triggers review) and rules (always-on agent orchestration rules).

**Gap in your system**: Your superpowers skills have similar patterns (brainstorming before creative work, TDD before implementation), but ECC makes it more systematic with hooks that automatically trigger the right agent at the right time.

### 8. Cost-Aware Model Routing

ECC explicitly recommends model tiers per task:

| Model | Use For | Cost |
|-------|---------|------|
| Haiku 4.5 | Lightweight agents, pair programming, worker agents | Cheapest |
| Sonnet 4.6 | Main development, orchestration, complex coding | Mid-tier |
| Opus 4.5 | Architecture decisions, deep reasoning, research | Most expensive |

Agent definitions specify which model to use. The code-reviewer uses Sonnet (fast, good enough), while the planner uses Opus (needs deeper reasoning).

**Gap in your system**: No model routing. Every skill runs on whatever model the user has selected.

## Specific Improvements for Your /build-feature Pipeline

### High-Impact, Low-Effort

1. **Add a verification-loop step to implement phase**: After implementation, run a systematic build → test → lint → typecheck → security loop. ECC's `verification-loop` skill does this as a mandatory post-implementation step.

2. **Add security review to the pipeline**: Your implement skill has no security check. ECC runs `security-reviewer` before every commit. Add a security scan step between implementation and the existing simplify/fact-check steps.

3. **Add domain-knowledge skills**: Create skills like `api-design.md`, `frontend-patterns.md` that the plan phase can reference. When the plan involves API endpoints, the planner should pull in API design patterns automatically.

4. **Hook into post-edit formatting**: Add hooks that auto-format and type-check after each edit during implementation. This catches issues immediately instead of at the end.

### Medium-Impact, Medium-Effort

5. **Define agent profiles for pipeline phases**: Instead of running everything on the same model, define profiles:
   - Research phase → Opus (deep reasoning for code exploration)
   - Plan review → Sonnet (fast annotation processing)
   - Implementation → Sonnet (best coding model, fast)
   - Code review → Sonnet with restricted tools (Read, Grep, Glob only)

6. **Add always-on coding standards rules**: Create `common-*.md` rules that establish baseline standards (immutability, file size limits, error handling, testing requirements) for every project. These load automatically and inform the plan phase.

7. **Add a code-review gate between plan approval and completion**: After implementation, automatically run a code review (like ECC's code-reviewer agent) that checks for CRITICAL/HIGH issues before declaring success.

8. **Add a "skeleton project" discovery step**: ECC's common-patterns rule describes searching for existing templates before building from scratch. Your research phase could include this.

### Lower-Priority / Aspirational

9. **Package as a Claude Code plugin**: Make your skills installable by others via the plugin format.

10. **Add continuous learning hooks**: ECC captures tool use patterns during sessions and extracts reusable patterns at session end. This feeds back into improved skills over time.

11. **Add cost tracking**: ECC tracks token usage and cost per session. Useful for understanding which phases of the pipeline are most expensive.

12. **Multi-perspective review**: ECC suggests using "split role sub-agents" for complex analysis — factual reviewer, senior engineer, security expert, etc. This could enrich the research or review phases.

## Edge Cases & Gotchas

- ECC's `alwaysApply: true` rules load into **every** conversation, which can bloat context. Your skill-based approach is more selective but risks missing important standards.
- ECC's hook system is Cursor-specific (`.cursor/hooks.json`). Claude Code hooks use a different format (`hooks/hooks.json` with `PreToolUse`/`PostToolUse`/`Stop` matchers). You'd need the Claude Code format.
- ECC's agent model selection (`model: opus` vs `model: sonnet`) assumes the plugin system can route to different models. In Claude Code, the user selects the model — agent definitions can suggest but not enforce model choice.
- The "80% coverage minimum" rule is aggressive for all projects. Consider making it configurable.
- ECC's plugin uses `${CLAUDE_PLUGIN_ROOT}` for portability. If you package as a plugin, use this pattern.

## Current State

Your pipeline is strong on the core workflow (research → plan → implement) with excellent annotation cycle support and visual integration. The main gaps are:

1. **No automated quality enforcement** (hooks for formatting, type checking, security)
2. **No domain-knowledge skills** (API design, frontend patterns, etc.)
3. **No agent-level model routing** (everything runs on the same model)
4. **No always-on coding standards** (standards only come from the project's CLAUDE.md)
5. **No security review step** in the implementation phase
6. **No cost tracking or session learning**

The ECC patterns that would have the most impact on your pipeline are: verification loop, security review, domain-knowledge skills, and post-edit hooks.
