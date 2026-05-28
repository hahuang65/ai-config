# omp extensions

TS/JS modules that hook omp's runtime (per
<https://omp.sh/docs/extensions> and the `tool_call` / `context` event
surface in `@oh-my-pi/pi-coding-agent/extensibility/hooks`).

`install.sh` symlinks every file under this directory into
`~/.omp/agent/extensions/`, where omp's native provider auto-discovers
them at session start.

## Authoring

Each extension is a single TS file with a default-exported factory:

```ts
import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

export default function (pi: HookAPI): void {
  pi.on("tool_call", async (event, ctx) => {
    // return { block: true, reason: "..." } to abort
    // (no { allow: true } — hooks can only block, not auto-approve)
  });
}
```

## Why this directory exists despite being empty

Empty for now — the natural use case (a "smart prompt suppressor" that
auto-approves safe bash commands) is not achievable with omp's current
hook API, which only supports `{ block, reason }`. Per-tool approval
remains binary (`allow` / `deny` / `prompt`) at the config level.

The directory is committed so future extensions have a home and
`install.sh` has a fixed target to symlink. Reasonable candidates that
WOULD work:

- A denylist hook that blocks bash patterns TTSR rules don't catch
  (largely redundant with TTSR; not currently needed)
- A `context` hook that filters specific message types out of LLM context
  (the pattern of the prior `suppress-todo-reminders.ts`)
- A `tool_result` hook that redacts secrets from tool output before they
  reach the conversation transcript

See [ADR-0004](../../docs/adr/0004-omp-permissions-and-hooks-decoupled.md)
for the safety-stack context this directory sits in.
