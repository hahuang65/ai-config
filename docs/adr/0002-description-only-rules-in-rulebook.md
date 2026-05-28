# Rules use description-only frontmatter — omp rulebook, not always-apply

omp puts rules into one of two buckets: **always-apply** (full content injected into the system prompt every turn, requires `alwaysApply: true`) or **rulebook** (listed by name + description, model reads on demand via `rule://<name>`, requires `description:`). Claude Code's behavior is closer to always-apply — it injects all `~/.claude/rules/*.md` automatically. For behavior parity with Claude we could have added `alwaysApply: true` to every rule; we chose **rulebook with load-trigger descriptions** instead.

Reasons:

1. **Context tax per turn.** omp's `alwaysApply` injects raw content into every system prompt of every session. Six rules totaling several hundred lines would mean every omp turn pays that cost upfront, even for tasks where the rules are irrelevant (e.g. asking a question about an unrelated codebase).
2. **The rulebook mechanism is the omp-native equivalent.** Listing by name + description lets the model decide when to load — and descriptions written as load-triggers ("Read before writing tests…", "Read when handling user input…") make that decision tractable.
3. **Behavior drift is acceptable.** Claude users get rules in every turn whether they need them or not; omp users get them on demand. Both are valid; neither is wrong. The rules themselves are identical.
4. **TTSR is the right tool for hard guardrails.** When we want "always enforce X," `condition:` (TTSR — mid-stream regex injection) is more targeted than `alwaysApply` and pays zero per-turn context cost. Reserving `alwaysApply` for cases we never actually use lets TTSR be the headline safety mechanism for omp (see ADR-0003 for the 8 TTSR rules this enables).

Consequences worth knowing:

- Rule descriptions must be **load-triggers**, not summaries. "Coding conventions" is a bad description; "Read before writing or modifying source files — covers immutability, file size limits, naming" is good.
- Adding a new rule requires writing a description that helps the model decide when to read it. Files with only `# Heading` + bullets won't work in omp.
- If a rule needs to *guarantee* it gets seen by omp (e.g. a critical safety rule), use TTSR (`condition:`), not `alwaysApply`. See ADR-0003 for the 8 TTSR rules this repo ships and the rationale.
