import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { AgentMemoryRuntime } from "./runtime.ts";
import { isSensitiveTool } from "./support.ts";

export function registerAgentMemoryEvents(
  pi: ExtensionAPI,
  runtime: AgentMemoryRuntime,
): void {
  pi.on("session_start", async (_event, context) => {
    await runtime.initializeSession(context);
  });

  pi.on("before_agent_start", async (event) => {
    await runtime.capturePrompt(event);
  });

  pi.on("tool_call", (event, context) => {
    if (isSensitiveTool(event.toolName ?? "")) runtime.pauseCapture(context);
  });

  pi.on("tool_result", async (event) => {
    await runtime.captureTool(event);
  });

  pi.on("agent_end", async (event) => {
    await runtime.captureConversation(event);
  });

  pi.on("agent_settled", (_event, context) => {
    runtime.resumeCapture(context);
  });

  pi.on("session_shutdown", async (event) => {
    await runtime.shutdown(event.reason);
  });
}
