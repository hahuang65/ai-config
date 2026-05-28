---
description: Block reading credential files — AWS credentials, kubeconfig, SSH private keys, .netrc, .pgpass, npm auth tokens, .secrets.*, anything named "credentials".
condition:
  - '\.aws/credentials'
  - '\.kube/config'
  - '\.ssh/id_[A-Za-z0-9]+'
  - '\.netrc'
  - '\.pgpass'
  - '\.npmrc.*_authToken'
  - '\.secrets\.'
  - '(^|[/"''])credentials($|[/"''])'
scope: tool:read, tool:edit, tool:bash
---

# No credential file reads

You were about to read a file that almost certainly contains secrets. Stop.

The matched paths — AWS credentials, kubeconfig, SSH private keys, `.netrc`, `.pgpass`, `.npmrc` auth tokens, `.secrets.*`, anything named "credentials" — hold secret material that should never reach the model's context. Once read, the content lives in the conversation transcript and any subsequent system you forward it to.

This rule fires regardless of which tool you used. Common bypasses that this rule explicitly blocks:

- The `read` tool with the credential path as input
- The `edit` tool opening the credential file
- The `bash` tool running `cat`, `awk`, `grep`, `sed`, `head`, `tail`, `less`, `more`, or any other utility that prints credential file contents to stdout (which gets captured into the conversation transcript)

Right approach: **ask the user.** The regex is intentionally broad — any mention of a credential path in a bash invocation triggers this rule, including `ls -la ~/.aws/credentials` or `test -f ~/.aws/credentials`. Even existence-checking should be human-confirmed; the user almost certainly knows what credentials they have set up.

Specific patterns:

- **Need a specific value from the file?** Ask the user to read it themselves and paste only the value you need.
- **Need to know if the file exists?** Ask: "Do you have AWS credentials configured?" — don't touch the path.
- **Need to update the config?** Walk through it with the user, don't autonomously rewrite files holding secret material.

Re-plan with the user in the loop, then proceed.
