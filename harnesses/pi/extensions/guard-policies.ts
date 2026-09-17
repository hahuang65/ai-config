// guard-policies.ts
//
// pi guardrail adapter (enforcement tier A, ADR-0011). A thin extension for pi
// (@earendil-works/pi-coding-agent): it normalizes pi's structured tool_call
// event and routes it through the shared guard core, which holds all detection
// logic. No policy logic of its own — the same matchers run here and through
// the Claude shim.
//
// pi has no built-in permission system, so this extension is pi's entire
// policy layer (sandboxing is a separate, deferred concern). pi auto-discovers
// extensions from ~/.pi/agent/extensions/.

import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { evaluate, resolveGuardHome } from "../../../shared/guard-core";

interface GuardHomeSource {
  environmentHome?: string;
  platformHome: string;
}

const UNSAFE_HOME_REASON = "Refused — a safe absolute home directory could not be established for guard evaluation.";

export function createGuardPoliciesExtension(homeSource: GuardHomeSource) {
  return function guardPolicies(pi: ExtensionAPI): void {
    const home = resolveGuardHome(homeSource.environmentHome, homeSource.platformHome);
    pi.on("tool_call", (event, ctx) => {
      if (!home) return { block: true, reason: UNSAFE_HOME_REASON };
      const input = (event.input ?? {}) as Record<string, unknown>;
      const tool = String(event.toolName ?? "").toLowerCase();
      const rawPath = input.path ?? input.file_path;
      const rawContent = input.content ?? input.new_string;
      const verdict = evaluate({
        tool,
        command: input.command != null ? String(input.command) : undefined,
        path: rawPath != null ? String(rawPath) : undefined,
        pattern: tool === "glob" && input.pattern != null ? String(input.pattern) : undefined,
        content: rawContent != null ? String(rawContent) : undefined,
        cwd: ctx?.cwd,
        home,
      });
      if (verdict) return { block: true, reason: verdict.reason };
    });
  };
}

export default function guardPolicies(pi: ExtensionAPI): void {
  createGuardPoliciesExtension({
    environmentHome: process.env.HOME,
    platformHome: homedir(),
  })(pi);
}
