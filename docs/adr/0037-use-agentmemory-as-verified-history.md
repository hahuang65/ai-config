# Use agentmemory as verified historical evidence

An automatic recall injected an old implementation observation before a workflow had read the current canonical artifacts, so the model could mistake history for current truth.

Use agentmemory as an optional historical evidence service rather than a documentation source or automatic instruction channel.
Workflows read their current canonical sources first, request memory only at named checkpoints, and verify useful results before use.
Managed pi and Claude Code adapters retain session capture, but recall is explicit and every result is labelled as historical and unverified.
Both adapters assign the same stable project identity and apply the same user-owned capture policy.
Pi uses agentmemory's project-filtered search endpoint because its smart-search endpoint does not filter observations by project.
Claude Code blocks unfiltered MCP recall and injects the stable identity into project-filtered timeline and save calls.
A separate owner extension restores the managed pi adapter and reloads pi once if `agentmemory connect pi` replaces its installed entry point.

## Considered Options

Automatic recall offers the least user effort, but it gives stale and low-provenance observations authority before a workflow can assess them.
Disabling agentmemory entirely avoids that risk but loses useful cross-session history, debugging lessons, and pickup fallback.

## Consequences

Rules, context documentation, decision records, Authoritative intent, approvals, and task status remain in their existing canonical sources.
Agentmemory may be absent without blocking a workflow.
The repository exposes no competing agentmemory workflow skills and uses only its optional memory tools.
Managed Claude Code hooks capture lifecycle observations without injecting recalled context and disable capture before selected Confluence content is read.
