# Git Workflow

## Commit message format

Follow the template at `~/.gitmessage`:

```
TYPE: Subject line in imperative mood

What is this change?

Why is the change being made?

Link(s) to issue tracker ticket(s)
```

**Types**: `FEATURE`, `FIX`, `REFACTOR`, `STYLE`, `DOCS`, `TEST`, `CHORE`

**Rules**:
- Capitalize the subject line
- Limit lines to 72 characters
- Use imperative mood ("Add feature" not "Added feature")
- Do not end the subject line with a period
- Separate subject from body with a blank line
- Use the body to explain what and why, not how

## Branching

- Work on feature branches, not main
- Branch names: `type/short-description` (e.g., `feature/cursor-pagination`, `fix/auth-redirect`)

## Committing docs/claude files

When committing changes, always check for corresponding files in `docs/claude/` (research documents, plans, architecture diagrams) that were created or modified as part of the work. Include them in the commit unless `docs/claude/` is in `.gitignore`. These artifacts are part of the feature's history.

## General

- Commit early and often. Small, focused commits are easier to review and revert.
- Each commit should be a single logical change. Don't mix refactoring with feature work.
- Never force-push to shared branches.
- Never commit secrets, credentials, or `.env` files.
