---
description: Block curl|bash and similar remote-code-execution shortcuts.
condition:
  - 'curl\b[^|;&\n]*\|[^|;&\n]*\|?\s*(bash|sh|zsh|python|python3|node|ruby|perl|sudo)\b'
  - 'wget\b[^|;&\n]*\|[^|;&\n]*\|?\s*(bash|sh|zsh|python|python3|node|ruby|perl|sudo)\b'
scope: tool:bash
---

# No curl | bash

You were about to pipe a network download straight into an interpreter. Stop.

Patterns like `curl https://example.com/install.sh | bash` execute remote code with no opportunity to inspect what's about to run. This is exactly how supply-chain attacks compromise developer machines.

Right approach:

1. Download the script first: `curl -o /tmp/install.sh https://example.com/install.sh`
2. Verify a checksum or signature if the project publishes one
3. Read what the script does
4. Run it explicitly after you're satisfied

If you genuinely want to install something quickly, ask the user — they may have a package manager command (`brew`, `apt`, `npm`, etc.) that's safer.

Re-plan the command, then proceed.
