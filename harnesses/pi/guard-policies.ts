// Native Pi adapter for the replacement-owned shared guard policy.
import { homedir } from "node:os";
import { evaluate, resolveGuardHome } from "../../guard/guard-core";
import { initializeShellParser } from "../../guard/shell-parser";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type HomeSource = { environmentHome?: string; platformHome: string };
const UNSAFE_HOME = "Refused — a safe absolute home directory could not be established for guard evaluation.";

export function createGuardPoliciesExtension(homeSource: HomeSource) {
  return function guardPolicies(pi: ExtensionAPI): void {
    const home = resolveGuardHome(homeSource.environmentHome, homeSource.platformHome);
    pi.on("tool_call", async (event, ctx) => {
      if (!home) return { block: true, reason: UNSAFE_HOME };
      const input = event.input ?? {};
      const tool = String(event.toolName ?? "").toLowerCase();
      const rawPath = input.path ?? input.file_path;
      const rawContent = input.content ?? input.new_string;
      if (input.command != null) await initializeShellParser();
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
  createGuardPoliciesExtension({ environmentHome: process.env.HOME, platformHome: homedir() })(pi);
}
