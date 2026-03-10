---
name: plan
description: Create a detailed implementation plan for a feature or change, then support iterative annotation cycles where the user adds inline notes and you refine the plan. Use after research is complete or when the user wants to plan before coding.
argument-hint: [feature-description]
model: opus
---

# Planning Phase

Create a detailed implementation plan as a persistent markdown artifact and iteratively refine it through annotation cycles with the user.

## File Naming Convention

When invoked **standalone** (not from build-feature), create a feature directory under `docs/claude/`:

```text
docs/claude/<YYYYMMDD-HHMM>-<slug>/plan.md
```

To generate:

1. Derive a short slug from `$ARGUMENTS` (lowercase, hyphens, no special chars, max ~5 words)
2. Get the current timestamp via `date +%Y%m%d-%H%M`
3. Create directory `docs/claude/<timestamp>-<slug>/` if it doesn't exist (or reuse if a research phase already created it)
4. Write to `plan.md` inside that directory

**Examples:**

- `docs/claude/20260227-1430-cursor-pagination/plan.md`
- `docs/claude/20260227-1545-sortable-ids/plan.md`

When invoked **from build-feature**, the orchestrator will provide the directory path. Write `plan.md` into the provided directory.

## Core Principle

**Never write code until the plan is reviewed and approved.** The plan is a shared mutable document between you and the user. The user will annotate it with corrections, constraints, and domain knowledge. You will refine it until the user says it's ready.

## Rules Adherence

Comply with the project rules already loaded in context (coding-style, testing, security, performance, git-workflow). Code snippets must follow coding-style rules. The testing strategy must follow testing rules. Architectural decisions must respect security and performance rules.

## Process

### Step 1: Read Context

Before writing the plan:

- Check `docs/claude/` for any recent feature directories containing a `research.md` related to the topic. Read the most relevant one thoroughly.
- Read relevant source files referenced in the research or related to `$ARGUMENTS`
- Base the plan on the ACTUAL codebase, not assumptions

### Step 1b: Architecture Review (conditional)

For features that involve architectural decisions (new modules, cross-cutting changes, API design, database schema changes, or features touching 5+ files), use the `architect` agent (via the Agent tool) to evaluate architectural implications. Incorporate findings into the plan's **Approach** and **Considerations & Trade-offs** sections.

Skip the architect for simple features (bug fixes, single-file changes, UI tweaks, configuration changes) — the planning skill's own analysis is sufficient.

### Step 1c: Detect Domain Context

After reading context, check whether the feature involves specific domains where reference skills exist. For each that matches, invoke the corresponding skill to load its patterns before writing the plan:

1. **Frontend design**: Does the feature involve frontend/UI work? Check `$ARGUMENTS` for UI/page/component/frontend/form/dashboard/layout terms, `research.md` for frontend files (`.tsx`, `.jsx`, `.vue`, `.svelte`, `.html`, `.css`, `.scss`), and file scope for frontend directories (`src/components/`, `src/pages/`, `app/`, `templates/`). If yes and `frontend-design` is available, invoke it to commit to a bold aesthetic direction — purpose, tone, constraints, differentiator. Capture these decisions for the **Frontend Design Direction** section in the plan.

2. **Frontend patterns**: Does the feature involve UI components, state management, custom hooks, performance optimization, or accessibility? If `frontend-patterns` is available, invoke it to load component patterns, state management strategies, and performance techniques.

3. **API design**: Does the feature involve creating or modifying REST API endpoints, adding pagination, designing error responses, or implementing rate limiting? If `api-design` is available, invoke it to load REST API patterns (URL naming, status codes, pagination strategies, error response format, versioning).

When a domain skill is loaded, reference its patterns in the plan — e.g., "Use cursor-based pagination per the api-design skill" rather than inventing patterns from scratch.

**If no domain skills match, or the relevant skills are not installed, skip this step entirely — do not error or warn.**

### Step 2: Write the plan document

Create the file at the path described above with:

- **Goal**: What we're building and why (1-2 sentences)
- **Research Reference**: The relative path or name of the research file used to generate the plan
- **Approach**: High-level strategy and architectural decisions
- **Frontend Design Direction** *(only if frontend-design was loaded in Step 1c)*: Include this section after Approach. It must contain:
  - **Aesthetic**: The chosen design direction (e.g., "brutalist/raw", "luxury/refined", "retro-futuristic")
  - **Typography**: Specific display + body font pairing (sourced from Google Fonts or similar — never Inter, Roboto, Arial, or system defaults)
  - **Color Palette**: CSS custom properties with hex values for dominant, accent, background, and text colors
  - **Motion Strategy**: Specific animation approach (e.g., "staggered reveal on page load via animation-delay, scale-on-hover for cards")
  - **Spatial Composition**: Layout strategy (e.g., "asymmetric CSS Grid with overlapping hero section")
  - **Differentiator**: The one memorable thing about this interface
  - **Coding Guidelines**: Concrete rules the implement phase must follow (e.g., "All colors via CSS variables", "CSS-only animations preferred over JS", "No generic font stacks")
- **Detailed Changes**: For each file that will be modified or created:
  - File path
  - What changes are needed and why
  - Code snippets showing the actual changes (not pseudocode)
- **New Files**: Any new files to create, with their purpose and structure
- **Dependencies**: New libraries or services needed
- **Considerations & Trade-offs**: Alternative approaches considered and why this one was chosen
- **Migration / Data Changes**: Any database migrations, data backfills, or config changes
- **Testing Strategy**: What tests to write or update. This MUST include concrete, specific test cases — not vague descriptions. Each test case must name the test file, describe the scenario, and state the expected outcome. Every test case listed here MUST appear as a task in the Todo List.

### Step 3: Wait for Annotation

After writing the plan, STOP and tell the user the exact file path, then:

> The plan is ready for your review at `<file-path>`.
>
> To annotate, add `//` comments anywhere in the file:
>
> ```markdown
> ### `src/api/users.ts`
>
> // this should be a PATCH, not a PUT
> - Update the `updateUser` handler to accept partial updates via PUT
>
> // remove this section entirely, we don't need caching here
> - Add Redis caching layer for user lookups
>
> // use drizzle:generate for migrations, not raw SQL
> ```
>
> Just type `//` followed by your note — corrections, rejections, constraints, or domain knowledge. Then tell me to address your notes.

### Step 4: Address Annotations

When the user says they've added notes:

1. Read the updated plan document
2. Find ALL `//` annotations the user added (lines starting with `//` or containing `//` after content)
3. Address every single note - do not skip any
4. Update the plan document accordingly
5. Remove the user's `//` annotations as you address them (so they don't accumulate)
6. STOP and tell the user the plan is updated, ready for another review

**Do NOT implement yet.** Repeat this cycle until the user explicitly says the plan is approved.

If `visual-plan.html` already exists from a previous approval cycle, regenerate it after addressing annotations so the visual stays in sync with the plan.

### Step 5: Generate Todo List

When the user approves the plan (or asks for a todo list), append a detailed task checklist to the plan document:

```markdown
## Todo List

### Phase 1: [Phase Name]
- [ ] Task 1 description
- [ ] Task 2 description

### Phase 2: [Phase Name]
- [ ] Task 3 description
- [ ] Task 4 description
```

Tasks should be granular enough that each one is a single, clear unit of work. Group them into logical phases.

**Test tasks are mandatory.** The Todo List MUST include tasks for every test case from the Testing Strategy. Tests are not optional — if the Testing Strategy says to test it, there must be a corresponding `- [ ]` item. Place test tasks in a dedicated phase or interleave them with implementation tasks for TDD ordering (write test before the code it validates).

### Step 6: Generate Visual Plan

After the Todo List is generated, invoke `/generate-visual-plan` to produce an HTML page with state machines, before/after comparisons, file maps, edge cases, and code snippets from the approved plan. The output MUST be written to `visual-plan.html` in the same feature directory as `plan.md` (e.g., `docs/claude/20260304-1430-auth-flow/visual-plan.html`). Do NOT write to `~/.agent/diagrams/` or any other location. Open it in the browser.

Then tell the user:

> **The plan is approved and the todo list is ready.**
> I've also generated a visual implementation plan at `<diagram-path>` (opened in your browser).
>
> Say **"implement"** when you're ready for me to start building.

**Still do NOT implement.** Wait for the user to trigger implementation.

## Important Guidelines

- **Always prefer the cleaner, more maintainable approach.** When choosing between approaches, favor the one that is simpler to understand, easier to maintain long-term, and produces less technical debt — even if it requires slightly more upfront effort. Avoid clever shortcuts that trade long-term clarity for short-term convenience.
- Use a real markdown file, not chat summaries - the file IS the specification
- Include actual code snippets, not vague descriptions
- Reference existing code patterns in the codebase when proposing changes
- If you've seen a good implementation in an open source repo or the user provides a reference, use it as a model
- The annotation cycle typically repeats 1-6 times - this is normal and expected
- Every annotation from the user must be addressed; never ignore feedback
- Keep the plan focused - actively suggest cutting scope if it grows too large

Ultrathink.

