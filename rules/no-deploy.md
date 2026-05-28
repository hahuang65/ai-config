---
description: Block deployment commands. Deploys must always be human-initiated.
condition:
  - 'make\s+(apply|deploy[a-z-]*|push-(to-prod|staging|live|release)[a-z-]*)\b'
  - 'npm\s+run\s+deploy\b'
  - '(yarn|pnpm)\s+deploy\b'
  - 'cap\s+\S+\s+deploy\b'
  - 'fly\s+deploy\b'
  - 'vercel\s+(--prod\b|deploy\s+--prod\b)'
  - 'wrangler\s+deploy\b'
  - '(sls|serverless)\s+deploy\b'
  - 'kubectl\s+apply\b'
  - 'helm\s+(install|upgrade)\b'
scope: tool:bash
---

# No deployments

You were about to run a deployment command. Stop.

Deployments — `make deploy`, `npm run deploy`, `fly deploy`, `vercel --prod`, `wrangler deploy`, `kubectl apply`, `helm install`, and so on — change production or shared environments. The agent should never initiate these autonomously.

Right approach:

- Tell the user what command you'd run and which environment it targets
- Wait for them to execute it themselves
- If the user explicitly asked you to "deploy," confirm one more time before they execute

Re-plan as a hand-off to the user, then proceed.
