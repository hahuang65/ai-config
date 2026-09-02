import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { AgentMemoryRuntime } from "./runtime.ts";

export function registerAgentMemoryCommands(
  pi: ExtensionAPI,
  runtime: AgentMemoryRuntime,
): void {
  pi.registerCommand("agentmemory-capture", {
    description: "Set agentmemory capture to off, metadata, or full",
    handler: async (args, context) => {
      const requested = args.trim();
      if (requested !== "off" && requested !== "metadata" && requested !== "full") {
        context.ui.notify(
          `Usage: /agentmemory-capture off|metadata|full. Current: ${runtime.captureMode}`,
          "info",
        );
        return;
      }
      context.ui.notify(await runtime.setCaptureMode(requested, context), "info");
    },
  });
}
