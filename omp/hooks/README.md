# omp hooks

TS/JS modules that subscribe to omp's runtime events via the `HookAPI` from
`@oh-my-pi/pi-coding-agent/extensibility/hooks`. Per omp's hooks doc, the
discovery convention is:

```
~/.omp/agent/hooks/pre/*.ts       # global pre-tool hooks
~/.omp/agent/hooks/post/*.ts      # global post-tool hooks
```

This directory is the version-controlled source; `install.sh` symlinks every
`omp/hooks/pre/*.ts` and `omp/hooks/post/*.ts` into the matching path under
`~/.omp/agent/hooks/`. README files and other non-code are skipped so omp's
loader doesn't try to import them.

## Convention

- **`pre/guard-*.ts`** — pre-hooks that BLOCK dangerous tool calls. Subscribe
  to `tool_call`; return `{ block: true, reason }` when the call should be
  refused. The hook API does NOT support `{ allow: true }` to skip approval
  prompts — only `{ block }` (verified against
  `shared-events.ts:265`).

- **`post/redact-*.ts`** — post-hooks that MUTATE tool output before the model
  sees it. Subscribe to `tool_result`; return `{ content, details, isError }`
  to replace what the model receives. Used for secret redaction and similar
  output transforms TTSR cannot perform.

The shape contract is enforced by `scripts/test-pipeline.sh`'s
`test_omp_hook_shape` check: each file must `export default function`, import
`HookAPI` from the omp hooks package, and follow the `guard-*` /
`redact-*` naming convention based on its directory.

## When to author a hook vs. a TTSR rule

See [ADR-0006](../../docs/adr/0006-hooks-replace-ttsr-for-input-bound-patterns.md)
for the decision tree. Short version: hooks for input-bound patterns with
known regex bypasses, or anywhere output mutation is needed; TTSR for
content-based patterns (Write/Edit payloads) or simple bash regex with no
realistic bypass.
