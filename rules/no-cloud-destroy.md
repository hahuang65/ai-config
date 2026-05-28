---
description: Block AWS/GCP/Terraform/kubectl destructive operations on cloud or cluster state.
condition:
  - 'aws\s+\S+\s+(delete|terminate)-[a-z-]+'
  - 'terraform\s+(apply|destroy)\b'
  - 'gcloud\s+\S+\s+delete\b'
  - 'kubectl\s+delete\b'
scope: tool:bash
---

# No cloud destroy

You were about to run a cloud-destructive command. Stop.

These patterns — `aws … delete-*` or `terminate-*`, `terraform apply` or `destroy`, `gcloud … delete`, `kubectl delete` — modify shared infrastructure. The blast radius is large, the actions are often irreversible, and the agent should never trigger them autonomously.

Right approach:

- Tell the user what you'd run and ask them to execute it manually
- For Terraform: produce the plan (`terraform plan`) for the user to review; never apply
- For AWS / GCP: assemble the command and hand it over; never execute

Re-plan as a hand-off to the user, then proceed.
