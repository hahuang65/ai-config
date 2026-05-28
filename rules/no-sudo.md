---
description: Block sudo. Privilege escalation must be human-initiated.
condition:
  - '\bsudo\b'
scope: tool:bash
---

# No sudo

You were about to run a command with `sudo`. Stop.

Privilege escalation gives the agent root-level reach over the entire machine — package managers, system files, services, network config, other users' data. The agent should never trigger this autonomously.

Right approach:

- Tell the user what you want to do and why root is required
- Hand them the command verbatim; let them run it
- If the goal can be accomplished without root (user-local install, brew without sudo, npm without -g), prefer that path

Re-plan as a hand-off to the user, then proceed.
