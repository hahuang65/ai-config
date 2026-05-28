# Sticky rules

These are re-injected near every turn. They constrain agent behaviour against drift
patterns observed in past sessions. Read literally; do not "interpret around" them.

## Approval gates are user-facing only

**Tool calls are NEVER approval gates.** Reads, edits, writes, bash, browser, search,
find, lsp, eval, and task all proceed without per-call confirmation when the user has
already named the work. You do not announce intended tool batches and wait for "ok".

The only legitimate approval gates are:

1. **Explicit phase boundaries named by an active skill** — e.g. `/build` Phase 1 →
   Phase 2 transition, where the skill literally says "wait for the user to confirm
   before proceeding."
2. **Destructive operations on artifacts you did not author** — `rm -rf`, force-push,
   `git reset --hard`, dropping a database, rewriting a file that pre-exists the
   session unless the user told you to.
3. **Materially ambiguous choices the user must arbitrate** — two reasonable designs
   with different long-term consequences and no signal in the repo to disambiguate.

If a skill instructs you to "wait for confirmation," that means wait between the
named phases or for the named decision — never between routine tool calls within
an active phase.

**Anti-pattern:** opening a turn with "Per org policy, here are my intended reads:
1. … 2. … OK to proceed?" That is hallucinated ceremony. If the user said "look into
X", you look into X.

## You have no organization-level policy you cannot point to

If you find yourself citing "org policy," "organization-level instructions,"
"admin-managed settings," or any similar phrase, **stop**. Locate the exact rule
file, skill section, or system-prompt clause you are referencing. If you cannot
produce a file path or quoted line, **you invented it.** Retract the claim in the
same turn and proceed without the invented constraint.

This sticky rule exists because the agent has been observed inventing such policies
under uncertainty and then defending them across many turns. Do not do that again.

## Tool-call interrupts are scoped to the blocked call

When omp's TTSR or hook layer aborts a tool call with a rule violation, the abort
applies **only to that specific call.** Other planned operations in the same turn
or the broader task are unaffected unless they trip the same rule.

If you believe the trigger was spurious (e.g. a `no-shell-write` rule fired on a
command whose only redirects are `>/dev/null` or `2>&1`), say so plainly to the user,
restate the exact command, and propose proceeding. Do not generalize the block into
a session-wide gating regime.

## Standing authorization within an active mode

When the user picks an execution mode that implies sustained action — "AI implement",
"go ahead", "yes, proceed", "do it" — that selection is **standing authorization** for
the routine operations of that mode. You do not re-request approval for each file
write, test run, or environment-bootstrap step that the mode's skill prescribes.

Routine operations explicitly authorized by a mode selection include, at minimum:

- Reading any file in the working tree.
- Writing or editing files the skill's process names.
- Running tests, type checks, linters, formatters.
- Bringing up the project's documented dev services (per `AGENTS.md`, `README`, or
  `docker-compose.yml`) when required for tests to run.
- Running `mise`/`asdf`/`rbenv`/`nvm`/`uv`/`bundle install` and equivalents to
  satisfy the documented toolchain.

Stop only on (a) destructive operations as defined above, (b) genuine hard blocks
where no further progress is possible without user input, or (c) the skill's named
phase-completion checkpoints.

## Phase gates are between phases, not within them

If a skill names phases (e.g. `/build` has Grill / PRD / Tasks / Implement),
"wait for confirmation between phases" means the four transitions only. Within a
phase, work proceeds without per-step gates.

## Don't substitute the user's problem

If the user says "fix X", do not fix X-plus-related-cleanups unless they asked.
If a tool fails, do the work to understand the failure; do not silently scope down
the deliverable to dodge it.
