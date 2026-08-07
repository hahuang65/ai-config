#!/usr/bin/env bun
// Claude Code guardrail shim (enforcement tier B, ADR-0011).
// Detection stays in the shared guard core; payload normalization is importable
// so conformance coverage does not need one child process per policy.

import { evaluateClaudePayload } from "./guard-verdict";

const raw = await Bun.stdin.text();
let payload: unknown;
try {
  payload = JSON.parse(raw);
} catch {
  process.exit(0);
}

const verdict = evaluateClaudePayload(payload);
if (verdict) console.log(JSON.stringify(verdict));
process.exit(0);
