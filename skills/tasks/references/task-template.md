# Task Template

Write `tasks.md` using this structure. Number slices in dependency order (blockers first). Use `CONTEXT.md` vocabulary in titles and descriptions.

```markdown
# {Feature Name} — Tasks

Source PRD: [prd.md](./prd.md)

## Slice 1: {Short descriptive title}

**Type:** AFK
**Blocked by:** None — can start immediately
**User stories covered:** 1, 2, 3 (from the PRD)

### What to build

A concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation.

### Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

---

## Slice 2: {Short descriptive title}

**Type:** HITL — needs design review before implementation
**Blocked by:** Slice 1
**User stories covered:** 4, 5

### What to build

...

### Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

---
```

Avoid specific file paths or code snippets in the slice body. *Exception:* if the PRD's Implementation Decisions section already inlined a critical snippet (state machine, reducer, schema, type shape) tied to this slice, you may inline it here too. Trim to the decision-rich parts.
