# Plan: Improve /build-feature Pipeline from ECC Research

## Goal

Enhance the /build-feature skill pipeline with 6 improvements inspired by the everything-claude-code (ECC) repo: verification loop, security review, domain-knowledge skills, post-edit hooks, always-on common rules, and a code-review gate.

## Research Reference

`docs/claude/20260309-1522-improve-build-feature-pipeline/research.md`

## Approach

We'll make changes at three layers:

1. **Modify existing skills** — Add verification-loop, security review, and code-review gate steps to `implement/SKILL.md`
2. **Create new skill files** — Domain-knowledge reference skills (`api-design`, `frontend-patterns`) that the plan phase can detect and pull in
3. **Create hooks config** — A `hooks.json` that auto-formats and type-checks after edits during implementation

The changes are purely additive — no existing functionality is removed. Each improvement is independent, so a failure in one doesn't affect others.

**Key design decision**: Rather than copying ECC's approach of always-on rules loaded into every conversation (which bloats context), we'll embed domain knowledge as **on-demand skills** that the plan phase pulls in when relevant. This keeps the context lean while still providing the patterns when needed.

---

## Detailed Changes

### 1. `skills/implement/SKILL.md` — Add verification loop, security review, and code-review gate

The current process ends with: implement → simplify → fact-check.

The new process will be: implement → **verify** → **security review** → simplify → **code review** → fact-check.

#### Current steps 5-7 (lines 40-44):

```markdown
5. **Verify**: After all tasks are done, run the full test suite...
6. **Simplify**: You MUST invoke `/simplify`...
7. **Fact-check the plan**: You MUST invoke `/fact-check`...
```

#### New steps 5-9:

```markdown
5. **Verify (comprehensive)**: After all tasks are done, run a systematic verification loop:
   1. **Type check**: Run the project's type checker (e.g., `npx tsc --noEmit`, `mypy`, `go vet`)
   2. **Lint**: Run the project's linter (e.g., `npx eslint .`, `ruff check .`, `rubocop`)
   3. **Test**: Run the full test suite and confirm all tests pass
   4. **Build**: Run the build command if one exists (e.g., `npm run build`, `go build ./...`)

   If any step fails, fix the issue before proceeding. Repeat the loop until all 4 pass cleanly.

6. **Security review**: Scan the changed files for common security issues:
   - Hardcoded secrets (API keys, passwords, tokens, connection strings)
   - SQL injection (string concatenation in queries)
   - XSS vulnerabilities (unescaped user input in HTML/JSX)
   - Path traversal (user-controlled file paths)
   - Missing authentication/authorization checks on new endpoints
   - Sensitive data in logs

   If CRITICAL issues are found, fix them immediately. Report any findings to the user.

7. **Simplify**: You MUST invoke `/simplify` to review the changed code for reuse opportunities, quality issues, and efficiency improvements. Fix any issues found. Then re-run the test suite to confirm nothing broke.

8. **Code review**: Review all changed files with a quality lens:
   - Functions over 50 lines → split
   - Files over 800 lines → extract modules
   - Deep nesting (>4 levels) → flatten with early returns
   - Missing error handling → add
   - Mutation patterns → refactor to immutable
   - Dead code or unused imports → remove

   Fix any HIGH issues found. Re-run tests after fixes.

9. **Fact-check the plan**: You MUST invoke `/fact-check` on the plan document. This is not optional. Use the Skill tool to invoke `fact-check` with the plan file path as the argument. This verifies that all claims (file paths, line numbers, function names, behavior descriptions) match what was actually implemented. Do NOT skip this step.
```

### 2. `skills/plan/SKILL.md` — Add domain-knowledge skill detection

Add a new step between "Step 1b: Detect Frontend Work" and "Step 2: Write the plan document" that checks for and pulls in relevant domain-knowledge skills.

#### New Step 1c: Detect Domain Context

```markdown
### Step 1c: Detect Domain Context

After reading context, check whether the feature involves specific domains where reference skills exist:

1. **API design**: Does the feature involve creating or modifying REST API endpoints, adding pagination, designing error responses, or implementing rate limiting? If a skill named `api-design` is available, invoke it to load REST API patterns (URL naming, status codes, pagination strategies, error response format, versioning).

2. **Frontend patterns**: Does the feature involve React components, state management, custom hooks, performance optimization, or accessibility? If a skill named `frontend-patterns` is available, invoke it to load component patterns, hook recipes, and performance strategies.

When a domain skill is loaded, reference its patterns in the plan — e.g., "Use cursor-based pagination per the api-design skill" rather than inventing patterns from scratch.

**If no domain skills match, or the relevant skills are not installed, skip this step entirely.**
```

### 3. New file: `skills/api-design/SKILL.md` — API design reference skill

A condensed version of ECC's api-design skill, adapted for our pipeline. This is a **reference skill** — it doesn't orchestrate a workflow, it provides patterns for the plan phase to draw from.

```markdown
---
name: api-design
description: REST API design patterns including resource naming, status codes, pagination, filtering, error responses, versioning, and rate limiting. Reference skill loaded by the plan phase when API work is detected.
argument-hint: [topic-or-question]
---

# API Design Patterns

Reference patterns for designing consistent REST APIs.

## Resource URL Structure

- Resources are nouns, plural, lowercase, kebab-case
- `GET /api/v1/users`, `POST /api/v1/users`, `GET /api/v1/users/:id`
- Sub-resources for relationships: `GET /api/v1/users/:id/orders`
- Actions that don't map to CRUD: `POST /api/v1/orders/:id/cancel`

## HTTP Status Codes

| Code | When |
|------|------|
| 200 | GET, PUT, PATCH with response body |
| 201 | POST (include Location header) |
| 204 | DELETE, PUT with no body |
| 400 | Validation failure, malformed input |
| 401 | Missing or invalid authentication |
| 403 | Authenticated but not authorized |
| 404 | Resource doesn't exist |
| 409 | Duplicate entry, state conflict |
| 422 | Valid JSON but semantically invalid |
| 429 | Rate limit exceeded |

## Pagination

### Offset-Based (simple, for small datasets <10K)
`GET /api/v1/users?page=2&per_page=20`

### Cursor-Based (scalable, for large datasets or infinite scroll)
`GET /api/v1/users?cursor=eyJpZCI6MTIzfQ&limit=20`

Response includes `meta.has_next` and `meta.next_cursor`.

## Error Response Format

\```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      { "field": "email", "message": "Must be a valid email", "code": "invalid_format" }
    ]
  }
}
\```

## Filtering and Sorting

- Equality: `?status=active&customer_id=abc`
- Comparison: `?price[gte]=10&price[lte]=100`
- Multiple values: `?category=electronics,clothing`
- Sorting: `?sort=-created_at,price` (prefix `-` for descending)
- Sparse fieldsets: `?fields=id,name,email`

## Rate Limiting Headers

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640000000
```

## Versioning

Use URL path versioning: `/api/v1/users`. Maintain at most 2 active versions. Non-breaking changes (adding fields, adding endpoints) don't need a new version.

## Input Validation

Always validate at the boundary with schema-based validation (Zod, Pydantic, etc.). Return 422 with field-level error details.
```

### 4. New file: `skills/frontend-patterns/SKILL.md` — Frontend patterns reference skill

```markdown
---
name: frontend-patterns
description: React/frontend development patterns including component composition, custom hooks, state management, performance optimization, and accessibility. Reference skill loaded by the plan phase when frontend work is detected.
argument-hint: [topic-or-question]
---

# Frontend Development Patterns

Reference patterns for React and modern frontend development.

## Component Patterns

### Composition Over Inheritance
Use children and slot props instead of inheritance. Build compound components (Card + CardHeader + CardBody) for flexible layouts.

### Compound Components
Share state between related components via React Context. The parent manages state, children consume it. Example: Tabs + TabList + Tab + TabPanel.

### Render Props / Children as Function
Pass a function as children for flexible data loading patterns. Useful for DataLoader, AuthGuard, and similar wrapper components.

## Custom Hook Recipes

### useToggle
`const [isOpen, toggle] = useToggle(false)` — Simple boolean toggle.

### useDebounce
`const debouncedQuery = useDebounce(searchQuery, 500)` — Debounce a rapidly changing value.

### useQuery (data fetching)
`const { data, loading, error, refetch } = useQuery(key, fetcher)` — Async data with loading/error states.

## State Management

### When to use what
- **useState**: Component-local state, form inputs, UI toggles
- **useReducer**: Complex state transitions, multiple related values
- **Context + Reducer**: Shared state across a subtree (auth, theme, cart)
- **Zustand/Jotai**: Global state, cross-cutting concerns, performance-critical

### Context + Reducer Pattern
Define State type, Action union type, reducer function. Wrap in Provider. Consume via custom `useMyContext()` hook that throws if used outside Provider.

## Performance

- **useMemo**: Expensive computations derived from props/state
- **useCallback**: Functions passed to memoized children
- **React.memo**: Pure components that receive stable props
- **Lazy loading**: `React.lazy(() => import('./HeavyComponent'))` with Suspense
- **Virtualization**: `@tanstack/react-virtual` for lists with 100+ items

## Accessibility

- Keyboard navigation: Handle ArrowUp/Down/Enter/Escape in dropdowns and menus
- Focus management: Trap focus in modals, restore focus on close
- ARIA attributes: `role`, `aria-expanded`, `aria-haspopup`, `aria-modal`
- Semantic HTML: Use `<button>` not `<div onClick>`, `<nav>` not `<div class="nav">`
```

### 5. New file: `hooks.json` — Post-edit quality hooks

This lives at `~/.dotfiles/ai/claude/hooks.json` and gets symlinked to `~/.claude/hooks.json`. It provides automatic formatting and type checking after file edits.

**Important**: Claude Code hooks use the format with `PreToolUse`/`PostToolUse`/`Stop` matchers and `type: "command"` hooks. The hook commands must be simple, fast, and non-blocking.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'FILE=$(echo \"$TOOL_INPUT\" | grep -o '\"file_path\"[[:space:]]*:[[:space:]]*\"[^\"]*\"' | head -1 | sed 's/.*\"\\([^\"]*\\)\"$/\\1/'); [ -z \"$FILE\" ] && exit 0; case \"$FILE\" in *.ts|*.tsx|*.js|*.jsx) which prettier >/dev/null 2>&1 && prettier --write \"$FILE\" 2>/dev/null; which biome >/dev/null 2>&1 && biome format --write \"$FILE\" 2>/dev/null;; *.py) which ruff >/dev/null 2>&1 && ruff format \"$FILE\" 2>/dev/null;; *.rb) which rubocop >/dev/null 2>&1 && rubocop -A \"$FILE\" 2>/dev/null;; *.go) which gofmt >/dev/null 2>&1 && gofmt -w \"$FILE\" 2>/dev/null;; esac; exit 0'"
          }
        ],
        "description": "Auto-format files after edit (detects language and available formatter)"
      },
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'FILE=$(echo \"$TOOL_INPUT\" | grep -o '\"file_path\"[[:space:]]*:[[:space:]]*\"[^\"]*\"' | head -1 | sed 's/.*\"\\([^\"]*\\)\"$/\\1/'); [ -z \"$FILE\" ] && exit 0; case \"$FILE\" in *.ts|*.tsx) [ -f tsconfig.json ] && npx tsc --noEmit 2>&1 | head -20;; esac; exit 0'",
            "timeout": 30000
          }
        ],
        "description": "TypeScript type check after editing .ts/.tsx files"
      }
    ]
  }
}
```

**Trade-off note**: I considered more hooks (console.log detection, security scanning, pre-compact state saving) but starting with just format + typecheck keeps things simple and fast. We can add more hooks incrementally.

### 6. `skills/build-feature/SKILL.md` — No changes needed

The build-feature orchestrator doesn't need changes because the improvements flow through its sub-skills:
- The implement skill now handles verification, security review, and code review
- The plan skill now detects and loads domain-knowledge skills

### 7. Installation: symlinks and settings

The new skills need to be symlinked like the existing ones, and the hooks.json needs to be symlinked.

In `install.sh` (or manually):
```bash
# New skill symlinks
ln -sf /Users/hhhuang/.dotfiles/ai/skills/api-design ~/.claude/skills/api-design
ln -sf /Users/hhhuang/.dotfiles/ai/skills/frontend-patterns ~/.claude/skills/frontend-patterns

# Hooks symlink
ln -sf /Users/hhhuang/.dotfiles/ai/claude/hooks.json ~/.claude/hooks.json
```

---

## New Files

| File | Purpose |
|------|---------|
| `skills/api-design/SKILL.md` | REST API design reference patterns |
| `skills/frontend-patterns/SKILL.md` | React/frontend development reference patterns |
| `claude/hooks.json` | Post-edit auto-format and type-check hooks |

## Modified Files

| File | Changes |
|------|---------|
| `skills/implement/SKILL.md` | Add verification loop (step 5), security review (step 6), code review (step 8); renumber existing steps |
| `skills/plan/SKILL.md` | Add Step 1c for domain-knowledge skill detection |
| `install.sh` | Add symlinks for new skills and hooks.json |

## Dependencies

None. All hooks use tools already on the system (prettier, biome, ruff, rubocop, gofmt, tsc). Hooks gracefully skip if the tool isn't installed.

## Considerations & Trade-offs

### Why on-demand skills instead of always-on rules?

ECC uses `alwaysApply: true` rules that load into every conversation. This bloats context with ~2000 tokens of rules even for simple tasks. Our approach loads domain knowledge only when the plan phase detects it's needed. Trade-off: you must invoke `/plan` to get the patterns; ad-hoc coding won't benefit. This is acceptable because our workflow is plan-first by design.

### Why not model routing?

Claude Code doesn't support per-skill model selection — the user picks the model. We could add `model: sonnet` suggestions in skill metadata, but it would be advisory only. Deferred for now.

### Why not cost tracking?

Cost tracking requires persistent state across sessions (a file that accumulates token counts). This adds complexity for unclear benefit. Deferred until there's a concrete need.

### Hooks: simple bash vs Node.js scripts?

ECC uses Node.js scripts for hooks. We use inline bash for simplicity — no additional runtime dependencies, no script files to maintain. Trade-off: harder to read, but our hooks are simple (format a file, run tsc). If hooks grow more complex, we should extract them to scripts.

### Security review: inline vs dedicated skill?

We could create a `/security-review` skill like ECC's `security-reviewer` agent. For now, we embed the security checklist directly in the implement skill to avoid another skill file. If security review needs grow, we can extract it.

## Migration / Data Changes

None. This is purely additive — new files and edits to existing skill files.

## Testing Strategy

These are skill files (markdown documents), not code with a test suite. Validation is done by running the pipeline on a real feature and confirming each new step fires correctly.

| Test Case | How to Validate | Expected Outcome |
|-----------|----------------|-----------------|
| Verification loop runs after implementation | Run `/implement` on a project with a test suite | Steps 5.1-5.4 execute in order; failures are caught and fixed before proceeding |
| Security review catches hardcoded secrets | Add a hardcoded API key to test code, run `/implement` | Step 6 flags the hardcoded key and removes it |
| Domain skill loads during planning | Run `/plan` on an API feature in a project with `api-design` skill installed | Step 1c detects API work and references api-design patterns in the plan |
| Domain skill skipped when not relevant | Run `/plan` on a database migration (no API or frontend) | Step 1c runs but loads no skills; plan proceeds normally |
| Post-edit format hook fires | Edit a .ts file with the hooks installed | The file is auto-formatted by prettier or biome after the edit |
| Post-edit typecheck hook fires | Edit a .ts file with a type error and hooks installed | TypeScript errors appear in hook output after the edit |
| Code review gate catches quality issues | Implement a feature with a 60-line function | Step 8 identifies it and splits it |
| Hooks degrade gracefully when tools missing | Edit a .py file on a machine without ruff | Hook exits 0 without error; no formatting happens |

---

## Todo List

### Phase 1: New Domain-Knowledge Skills
- [x] Create `skills/api-design/SKILL.md` with REST API design patterns
- [x] Create `skills/frontend-patterns/SKILL.md` with framework-agnostic frontend patterns

### Phase 2: Modify Existing Skills
- [x] Update `skills/implement/SKILL.md` — replace steps 5-7 with new steps 5-10 (verification loop, security review, simplify, code review, fact-check) + MUST language + TDD enforcement
- [x] Update `skills/plan/SKILL.md` — add Step 1c (domain-knowledge skill detection) between Step 1b and Step 2

### Phase 3: Hooks Configuration
- [x] Create `claude/hooks.json` with PostToolUse hook for auto-format (new files only, no TS typecheck per user preference)

### Phase 4: Installation
- [x] Update `install.sh` to add symlinks for new skills and hooks.json
- [x] Create symlinks manually for immediate use
