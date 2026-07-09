---
description: Coach-guided implementation — AI writes ONE test at a time, the user writes the code, AI verifies
---
Load the implement-coach skill, then coach the user through implementing the approved tasks: $ARGUMENTS

Follow the implement-coach skill workflow. Read `tasks.md` and the linked `spec.md` thoroughly. Work one slice at a time in dependency order. For each slice: present the proposed public interface from the spec Testing Decisions and slice Test surface, then write ONE failing test that exercises that interface. Wait for the user to implement just enough code to make it pass. Verify by running the test when they say "check" or "verify". Then write the next test for the next acceptance criterion. Never ask which modules need tests, never queue up multiple tests in advance — batched tests describe imagined behavior, not actual behavior. Refactor together when all the slice's tests pass; never refactor while RED.

**Waiting is the deliverable, not incomplete work.** When you have written the current test and handed off, your turn is complete. Do not advance because the harness reminds you of remaining acceptance criteria, do not read the user's implementation files to guess at silent progress, and do not switch to `/implement` unless the user explicitly says so. Silence is not consent — stay silent yourself. See the skill's *Holding the line* section.

If no argument is given, look in `docs/features/` for the most recent `*/tasks.md` and confirm with the user.
