#!/usr/bin/env bun
//
// Claude Code guardrail shim (enforcement tier B, ADR-0011). Claude's hooks
// are external commands, not in-process functions, so this shim is the thin
// transport adapter: it reads Claude's PreToolUse payload from stdin,
// normalizes it into the harness-neutral shape, routes it through the SAME
// shared guard core every other harness uses, and emits Claude's verdict
// format on stdout. All detection logic lives in the core, not here.
//
// Claude's static `permissions.deny` denylist remains in settings.json as
// fast, declarative defense-in-depth alongside this programmable layer.

import { evaluate } from "../../../shared/guard-core";

const raw = await Bun.stdin.text();

let input: { tool_name?: string; tool_input?: Record<string, unknown> };
try {
  input = JSON.parse(raw);
} catch {
  process.exit(0); // Unparseable payload — defer to Claude's other layers.
}

const toolInput = input.tool_input ?? {};
const rawPath = toolInput.file_path ?? toolInput.path;

const verdict = evaluate({
  tool: String(input.tool_name ?? "").toLowerCase(),
  command: toolInput.command != null ? String(toolInput.command) : undefined,
  path: rawPath != null ? String(rawPath) : undefined,
});

if (verdict) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: verdict.reason,
      },
    }),
  );
}

process.exit(0);
