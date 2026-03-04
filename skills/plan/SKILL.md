---
name: plan
description: Create a detailed implementation plan for a feature or change, then support iterative annotation cycles where the user adds inline notes and you refine the plan. Use after research is complete or when the user wants to plan before coding.
argument-hint: [feature-description]
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

## Process

### Step 1: Read Context

Before writing the plan:

- Check `docs/claude/` for any recent feature directories containing a `research.md` related to the topic. Read the most relevant one thoroughly.
- Read relevant source files referenced in the research or related to `$ARGUMENTS`
- Base the plan on the ACTUAL codebase, not assumptions

### Step 2: Write the plan document

Create the file at the path described above with:

- **Goal**: What we're building and why (1-2 sentences)
- **Research Reference**: The relative path or name of the research file used to generate the plan
- **Approach**: High-level strategy and architectural decisions
- **Detailed Changes**: For each file that will be modified or created:
  - File path
  - What changes are needed and why
  - Code snippets showing the actual changes (not pseudocode)
- **New Files**: Any new files to create, with their purpose and structure
- **Dependencies**: New libraries or services needed
- **Considerations & Trade-offs**: Alternative approaches considered and why this one was chosen
- **Migration / Data Changes**: Any database migrations, data backfills, or config changes
- **Testing Strategy**: What tests to write or update

### Step 3: Wait for Annotation

After writing the plan, STOP and tell the user the exact file path, then:

> The plan is ready for your review. Open `<file-path>` in your editor, add inline notes anywhere you want to correct, reject, or refine, then tell me to address your notes.
>
> Common annotation patterns:
>
> - Correct assumptions: "this should be a PATCH, not a PUT"
> - Reject approaches: "remove this section entirely, we don't need caching here"
> - Add constraints: "the signatures of these functions should not change"
> - Provide domain knowledge: "use drizzle:generate for migrations, not raw SQL"
> - Redirect design: "this field should be on the list, not on individual items"

### Step 4: Address Annotations

When the user says they've added notes:

1. Read the updated plan document
2. Find ALL inline notes/annotations the user added
3. Address every single note - do not skip any
4. Update the plan document accordingly
5. Remove the user's inline notes as you address them (so they don't accumulate)
6. STOP and tell the user the plan is updated, ready for another review

**Do NOT implement yet.** Repeat this cycle until the user explicitly says the plan is approved.

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

**Still do NOT implement.** Wait for the user to trigger implementation.

## Important Guidelines

- Use a real markdown file, not chat summaries - the file IS the specification
- Include actual code snippets, not vague descriptions
- Reference existing code patterns in the codebase when proposing changes
- If you've seen a good implementation in an open source repo or the user provides a reference, use it as a model
- The annotation cycle typically repeats 1-6 times - this is normal and expected
- Every annotation from the user must be addressed; never ignore feedback
- Keep the plan focused - actively suggest cutting scope if it grows too large

## Visual Companion (when invoked from build-feature)

When this skill is invoked as part of the `build-feature` workflow, the orchestrator may generate a visual implementation plan (HTML page with state machines, before/after panels, file maps, edge cases) after the plan is approved — but only if the `visual-explainer` skill is available. If it is not available, the visual step is silently skipped. The plan skill itself does NOT generate the visual — it focuses purely on the markdown artifact and annotation cycles.
