---
description: Build a throwaway prototype to flesh out a design — terminal app for logic questions, or radically different UI variants for design questions
---
Load the prototype skill, then prototype: $ARGUMENTS

Follow the prototype skill workflow. First decide which branch:
- **Logic** ("does this state model feel right?") → tiny interactive terminal app that drives the state machine through hard-to-reason-about cases.
- **UI** ("what should this look like?") → 3 radically different variants on a single route, switchable via `?variant=` URL param and a floating bottom bar.

Rules for both: throwaway from day one and clearly marked as such, one command to run, no persistence by default, skip the polish, surface the state, delete or absorb when the prototype has answered its question.

If the question is genuinely ambiguous and the user isn't reachable, default to whichever branch matches the surrounding code (backend module → logic; page or component → UI) and state the assumption at the top of the prototype.
