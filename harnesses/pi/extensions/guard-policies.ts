// guard-policies.ts
//
// pi guardrail adapter (enforcement tier A, ADR-0011). A thin extension for pi
// (@earendil-works/pi-coding-agent): it normalizes pi's structured tool_call
// event and routes it through the shared guard core, which holds all detection
// logic. No policy logic of its own — the same matchers run here, on oh-my-pi,
// and through the Claude shim.
//
// pi has no built-in permission system, so this extension is pi's entire
// policy layer (sandboxing is a separate, deferred concern). pi auto-discovers
// extensions from ~/.pi/agent/extensions/.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { evaluate } from "../../../shared/guard-core";

export default function (pi: ExtensionAPI): void {
  pi.on("tool_call", (event) => {
    const input = (event.input ?? {}) as Record<string, unknown>;
    const rawPath = input.path ?? input.file_path;
    const rawContent = input.content ?? input.new_string;
    const verdict = evaluate({
      tool: String(event.toolName ?? ""),
      command: input.command != null ? String(input.command) : undefined,
      path: rawPath != null ? String(rawPath) : undefined,
      content: rawContent != null ? String(rawContent) : undefined,
    });
    if (verdict) return { block: true, reason: verdict.reason };
  });
}
