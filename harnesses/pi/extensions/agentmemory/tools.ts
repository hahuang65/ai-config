import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { AgentMemoryRuntime } from "./runtime.ts";
import {
  displayField,
  integerSchema,
  objectSchema,
  OPTIONAL_STRING_SCHEMA,
  STRING_SCHEMA,
} from "./support.ts";

function captureControlTool(runtime: AgentMemoryRuntime) {
  return {
    name: "memory_capture_control",
    label: "Memory Capture Control",
    description: "Set agentmemory capture before reading sensitive content, or report its status",
    parameters: objectSchema({ mode: { type: "string", enum: ["off", "metadata", "full", "status"], "~kind": "String" } }, ["mode"]),
    async execute(_id: string, parameters: any, _signal: unknown, _update: unknown, context: any) {
      const text = parameters.mode === "status"
        ? `agentmemory capture ${runtime.captureMode}; recall ${runtime.recallMode}.`
        : await runtime.setCaptureMode(parameters.mode, context);
      return { content: [{ type: "text", text }], details: { captureMode: runtime.captureMode, recallMode: runtime.recallMode } };
    },
  };
}

function healthTool(runtime: AgentMemoryRuntime) {
  return {
    name: "memory_health",
    label: "Memory Health",
    description: "Check whether the optional agentmemory server is available",
    parameters: objectSchema({}),
    async execute(_id: string, _parameters: unknown, _signal: unknown, _update: unknown, context: any) {
      const health = await runtime.health();
      runtime.updateStatus(context);
      const version = health ? displayField(health, "version") ?? "unknown version" : undefined;
      return { content: [{ type: "text", text: health ? `agentmemory is available (${version}).` : "agentmemory is unavailable; continue without it." }], details: health ?? { available: false } };
    },
  };
}

function searchTool(runtime: AgentMemoryRuntime) {
  return {
    name: "memory_smart_search",
    label: "Memory Smart Search",
    description: "Explicitly search project-scoped historical evidence; verify useful results against current canonical sources",
    parameters: objectSchema({ query: STRING_SCHEMA, limit: integerSchema(5, 10) }, ["query"]),
    async execute(_id: string, parameters: any) {
      const result = await runtime.search(parameters.query, parameters.limit ?? 5);
      return { content: [{ type: "text", text: result.text }], details: { results: result.results } };
    },
  };
}

function saveTool(runtime: AgentMemoryRuntime) {
  return {
    name: "memory_save",
    label: "Memory Save",
    description: "Explicitly save a historical fact, preference, lesson, or gotcha that is not already canonical",
    parameters: objectSchema({
      content: STRING_SCHEMA,
      type: { ...OPTIONAL_STRING_SCHEMA, default: "fact" },
      concepts: OPTIONAL_STRING_SCHEMA,
      files: OPTIONAL_STRING_SCHEMA,
    }, ["content"]),
    async execute(_id: string, parameters: any) {
      const saved = await runtime.save(parameters);
      return { content: [{ type: "text", text: runtime.savedText(saved) }], details: saved ?? { saved: false } };
    },
  };
}

function sessionsTool(runtime: AgentMemoryRuntime) {
  return {
    name: "memory_sessions",
    label: "Memory Sessions",
    description: "List historical sessions for confirmed pickup fallback",
    parameters: objectSchema({ limit: integerSchema(20, 50) }),
    async execute(_id: string, parameters: any) {
      if (runtime.recallMode === "off") return { content: [{ type: "text", text: "Recall is off; session history is unavailable." }], details: { recallMode: runtime.recallMode } };
      const sessions = await runtime.sessions(parameters.limit ?? 20);
      const text = sessions ? `Historical sessions only; verify current repository state.\n${JSON.stringify(sessions)}` : "agentmemory is unavailable; continue without it.";
      return { content: [{ type: "text", text }], details: sessions ?? {} };
    },
  };
}

function verifyTool(runtime: AgentMemoryRuntime) {
  return {
    name: "memory_verify",
    label: "Memory Verify",
    description: "Trace the provenance of a recalled memory or observation before relying on it",
    parameters: objectSchema({ id: STRING_SCHEMA }, ["id"]),
    async execute(_id: string, parameters: any) {
      const verification = await runtime.verify(parameters.id);
      return { content: [{ type: "text", text: verification ? JSON.stringify(verification) : "agentmemory could not verify this record." }], details: verification ?? {} };
    },
  };
}

function governanceDeleteTool(runtime: AgentMemoryRuntime) {
  return {
    name: "memory_governance_delete",
    label: "Memory Governance Delete",
    description: "Delete confirmed stale explicit memories by id with an audit reason",
    parameters: objectSchema({ memoryIds: STRING_SCHEMA, reason: OPTIONAL_STRING_SCHEMA }, ["memoryIds"]),
    async execute(_id: string, parameters: any) {
      const deleted = await runtime.delete(parameters.memoryIds, parameters.reason);
      return { content: [{ type: "text", text: deleted ? JSON.stringify(deleted) : "agentmemory could not delete the requested memories." }], details: deleted ?? {} };
    },
  };
}

export function registerAgentMemoryTools(pi: ExtensionAPI, runtime: AgentMemoryRuntime): void {
  const tools = [
    captureControlTool(runtime),
    healthTool(runtime),
    searchTool(runtime),
    saveTool(runtime),
    sessionsTool(runtime),
    verifyTool(runtime),
    governanceDeleteTool(runtime),
  ];
  for (const tool of tools) pi.registerTool(tool as any);
}
