# Validation Evidence

Run the smallest relevant focused checks that can substantiate Authoritative intent, never a full repository suite during Change review; missing evidence becomes an `ask-user` warning rather than a claim of success.
Implementation already owns broad local regression coverage, and remote CI may own it for a pull request.

## Evidence selection

Prefer the highest stable public interface affected by the change.
Record every command or manual check, its scope, its outcome, and any artifact it produced.
Do not describe an unexecuted check as passing.
Do not treat model confidence as evidence.

For UI, HTML, CSS, copy placement, or visual layout changes, attempt reviewer-visible screenshots, rendered HTML, or another inspectable artifact.
If a suitable environment cannot be started safely, explain why and emit the missing-evidence Finding.

## Project commands

Use only project-documented commands and the existing toolchain.
Set bounded timeouts for subprocesses and external calls.
Never invent a broad command when a focused package, test file, endpoint, component, or manual scenario can establish the criterion.

## Output

Return:

- `tested` — exact commands and manual checks;
- `testing_summary` — what the evidence establishes;
- `artifacts` — local paths or provider URLs safe for the user to inspect; and
- a Finding for every required criterion that remains unproven.
