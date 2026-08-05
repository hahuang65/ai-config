---
description: Read before designing, implementing, or reviewing an Agent-facing CLI.
---

# CLI Ergonomics

An Agent-facing CLI is a public shell contract consumed by a model, even when the same executable also provides a human-facing terminal experience.
Optimize the contract for correct decisions and successful recovery, not for a particular serialization format or benchmark.

## Purpose-specific formats

- Choose compact JSON, JSONL, tailored text, or a human TUI according to the caller and ecosystem.
- Do not mandate TOON or any other format globally.
- Separate human presentation from deterministic automation output when their needs differ.
- Keep machine-readable standard output free of progress messages.
- Send diagnostics to standard error unless a documented machine-readable mode deliberately includes structured error data.
- Make no-argument behavior useful only when there is one safe, unsurprising default; otherwise show concise help or a usage error.

## Minimal bounded defaults

- Return only the fields needed to identify the result, understand its state, and choose the next action.
- Keep collection limits large enough for the common case but always bounded.
- Offer explicit field selection or detail commands when callers need more data.
- Avoid repeating static prose, schemas, or instructions in every row.

## Explicit truncation

- Include a useful preview rather than silently omitting oversized content.
- State the total size or omitted amount whenever content is truncated.
- Provide an explicit full-content escape hatch.
- Bound logs, errors, and nested dependency output as well as successful data.

## Cheap aggregates

- Include totals, derived states, or summaries when they are inexpensive and demonstrably avoid a likely follow-up call.
- Distinguish the returned page size from the total result count.
- Do not add expensive speculative aggregates merely because they might be useful.

## Definitive empty states

- Represent zero results explicitly and in the same contract as populated results.
- Make successful absence distinguishable from a silent failure, unavailable source, or truncated page.

## Strict invocation validation

- Validate the complete invocation before network access, filesystem mutation, provider calls, or other side effects.
- Reject unknown or misplaced flags, missing values, extra positional arguments, unsupported commands, and invalid option combinations.
- Name the rejected input and provide the smallest correction that can succeed.
- Never silently ignore invented constraints and then return plausible unscoped output.

## Meaningful exit codes

- Use status 0 only when the requested outcome succeeded, including a proven idempotent no-op.
- Distinguish usage failures from operational failures with stable nonzero statuses when the ecosystem permits it.
- Preserve the underlying requested state before treating a mutation as an idempotent no-op.
- Document any domain-specific statuses that callers are expected to branch on.

## Deterministic automation paths

- Make every automation operation completable through arguments or standard input without an interactive prompt.
- Provide explicit non-interactive alternatives for commands that also offer human confirmation or selection.
- Keep ordering, pagination, defaults, output channels, and side effects stable and documented.
- Apply timeouts to external work and make interruption leave state explicit.

## Concise corrective and contextual help

- Provide concise top-level and command-specific help with required inputs, accepted options, defaults, and representative usage.
- Make errors self-correcting by naming the relevant help or valid alternatives in the failure response.
- Suggest a small number of concrete next actions only when the current result leaves a likely decision unresolved.
- Carry forward fixed context in suggestions while leaving dynamic values as visible placeholders.
- Omit suggestions when the result already answers the request completely.

## Verification

Test through the executable process boundary whenever practical.
Cover the smallest useful success, populated and empty collections, truncation and full-content recovery, invalid input before side effects, runtime failure, exit status, output-channel separation, and non-interactive behavior.
Use lower-level tests only for a deep parser or formatter whose behavior is not adequately exercised through the executable.

## Provenance

This guidance is a project-owned adaptation of the MIT-licensed [AXI principles at revision 93c5f334d6ec074c29ca8d74fa629530dd298a43](https://github.com/kunchenguid/axi/tree/93c5f334d6ec074c29ca8d74fa629530dd298a43).
It is a pinned snapshot rather than an automatically synchronized copy.
