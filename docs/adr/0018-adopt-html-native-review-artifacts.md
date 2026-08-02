# Adopt HTML-native review artifacts

Feature artifacts that require feedback or approval are canonical semantic HTML documents reviewed through the locally owned `review-artifact` skill, rather than Markdown deliverables with visual companions.
The browser review returns targeted annotations, messages, and an explicit approval event while the agent updates the same live-reloading HTML; chat remains a fallback, and merely ending a session is not approval.
This follows the core review loop demonstrated by `lavish-axi` without taking a runtime dependency on it or adopting its whiteboards, sharing, export, hooks, playbooks, or telemetry.

## Considered Options

- Keep Markdown canonical and use HTML only as a visual companion.
- Wrap the upstream `lavish-axi` package at runtime.
- Own a pipeline-focused HTML review implementation in this repository.

## Consequences

- `specs.html` and `tasks.html` replace their former Markdown counterparts and are consumed directly by later pipeline phases.
- Review artifacts use ordinary semantic HTML, with only narrowly required pipeline metadata such as task status and dependencies.
- The repository owns the security, accessibility, browser compatibility, persistence, and maintenance of the local review runtime.
- Agent-only event consumption uses a per-daemon local capability with serialized startup, transient and durable review messages share validation before persistence or rendering, and runtime compatibility is enforced through a versioned health handshake.
