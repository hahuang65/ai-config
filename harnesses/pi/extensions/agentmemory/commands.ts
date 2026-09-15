import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { AgentMemoryRuntime } from "./runtime.ts";

export function registerAgentMemoryCommands(
  pi: ExtensionAPI,
  runtime: AgentMemoryRuntime,
): void {
  pi.registerCommand("agentmemory-capture", {
    description: "Temporarily pause capture, or set it to off, metadata, or full",
    handler: async (args, context) => {
      const requested = args.trim();
      if (requested === "pause") {
        context.ui.notify(runtime.pauseCapture(context), "info");
        return;
      }
      if (requested !== "off" && requested !== "metadata" && requested !== "full") {
        context.ui.notify(
          `Usage: /agentmemory-capture pause|off|metadata|full. Current: ${runtime.captureStatus}`,
          "info",
        );
        return;
      }
      context.ui.notify(await runtime.setCaptureMode(requested, context), "info");
    },
  });
}
