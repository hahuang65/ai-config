# PRD Template

Write `prd.md` using this structure. Use `CONTEXT.md` vocabulary throughout. No code snippets or file paths in the body (except the narrow exception in Implementation Decisions).

```markdown
# {Feature Name} — PRD

## Problem Statement

The problem the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A LONG, numbered list of user stories. Each in the format:

1. As an <actor>, I want a <feature>, so that <benefit>

Example: "As a mobile bank customer, I want to see the balance on my accounts, so that I can make better informed decisions about my spending."

This list should be extensive and cover all aspects of the feature.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified (from the module sketch)
- The interfaces of those modules
- Technical clarifications agreed during grilling
- Architectural decisions (and pointers to relevant ADRs)
- Schema changes
- API contracts
- Specific interactions

**Do NOT include specific file paths or code snippets.** They go stale fast and the PRD outlives them.

*Exception:* if grilling produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it within the relevant decision and note briefly where it came from. Trim to the decision-rich parts — not a working demo, just the important bits.

## Testing Decisions

A list of testing decisions that were derived from the module sketch and [../../shared/references/testable-interfaces.md](../../shared/references/testable-interfaces.md). Include:

- A description of what makes a good test in this codebase (test external behavior through stable public interfaces, not implementation details — see the testing rules)
- The test surface for each module: direct public-interface test, covered through a higher-level interface, or no product test with rationale
- Prior art for the tests (i.e. similar types of tests already in the codebase)

Do **not** write that the user still needs to decide which modules get tests. The PRD proposes that decision; the user only corrects module boundaries or public-interface choices.

## Out of Scope

A description of things that are deliberately out of scope for this PRD.

## Further Notes

Any further notes about the feature.
```
