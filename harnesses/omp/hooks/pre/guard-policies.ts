// guard-policies.ts
//
// oh-my-pi guardrail adapter (enforcement tier A, ADR-0011). A thin wiring
// layer: it normalizes oh-my-pi's structured tool_call event into the
// harness-neutral shape and routes it through the shared guard core, which
// holds all detection logic. This adapter carries no policy logic of its own,
// so the same matchers run identically here and in every other harness.
//
// Supersedes the per-policy guard-credentials.ts (and, as policies migrate,
// guard-rm.ts / guard-sudo.ts / guard-curl-pipe.ts), which each carried their
// own copy of the detection logic.

import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";
import { evaluate } from "../../../../shared/guard-core";

export default function (pi: HookAPI): void {
  pi.on("tool_call", (event) => {
    const input = (event.input ?? {}) as Record<string, unknown>;
    const rawPath = input.path ?? input.file_path;
    const verdict = evaluate({
      tool: String(event.toolName ?? ""),
      command: input.command != null ? String(input.command) : undefined,
      path: rawPath != null ? String(rawPath) : undefined,
    });
    if (verdict) return { block: true, reason: verdict.reason };
  });
}
