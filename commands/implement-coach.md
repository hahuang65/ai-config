---
description: Coach-guided implementation — AI writes ONE test at a time, the user writes the code, AI verifies
---
Load the implement-coach skill, then coach the user through implementing the approved tasks: $ARGUMENTS

Follow the implement-coach skill workflow. Read `tasks.md` and the linked `prd.md` thoroughly. Work one slice at a time in dependency order. For each slice: present the proposed public interface, then write ONE failing test that exercises that interface. Wait for the user to implement just enough code to make it pass. Verify by running the test when they say "check" or "verify". Then write the next test for the next acceptance criterion. Never queue up multiple tests in advance — batched tests describe imagined behavior, not actual behavior. Refactor together when all the slice's tests pass; never refactor while RED.

If no argument is given, look in `docs/claude/` for the most recent `*/tasks.md` and confirm with the user.
