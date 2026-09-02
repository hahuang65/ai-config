#!/usr/bin/env bun

import crypto from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import {
  resolveMemoryPolicy,
  resolveProjectIdentity,
  type AgentMemoryConfigurationEnvironment,
} from "../../../shared/agentmemory-config.ts";

const MAX_CAPTURE_CHARS = 8_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

type JsonRecord = Record<string, any>;
type CaptureEnvironment = AgentMemoryConfigurationEnvironment & {
  AGENTMEMORY_SECRET?: string;
  AGENTMEMORY_URL?: string;
  CLAUDE_PROJECT_DIR?: string;
};
type CaptureState = {
  clear: (sessionId: string) => unknown;
  disable: (sessionId: string) => unknown;
  isDisabled: (sessionId: string) => boolean;
};
type CaptureDependencies = {
  environment?: CaptureEnvironment;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  projectIdentity?: (cwd: string) => string;
  state?: CaptureState;
};

function markerPath(sessionId: string): string {
  const digest = crypto.createHash("sha256").update(sessionId).digest("hex");
  return path.join(homedir(), ".agentmemory", "capture-state", `${digest}.off`);
}

function captureState(): CaptureState {
  return {
    isDisabled(sessionId) {
      const state = lstatSync(markerPath(sessionId), { throwIfNoEntry: false });
      return Boolean(state);
    },
    disable(sessionId) {
      const target = markerPath(sessionId);
      const directory = path.dirname(target);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const directoryState = lstatSync(directory);
      if (!directoryState.isDirectory() || directoryState.isSymbolicLink()) return;
      const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
      writeFileSync(temporary, "off\n", { encoding: "utf8", mode: 0o600 });
      renameSync(temporary, target);
    },
    clear(sessionId) {
      try {
        unlinkSync(markerPath(sessionId));
      } catch {
        // A missing marker is already clear.
      }
    },
  };
}

function safeSerialize(value: unknown): string {
  try {
    return (typeof value === "string" ? value : JSON.stringify(value ?? "")).slice(0, MAX_CAPTURE_CHARS);
  } catch {
    return "[unserializable]";
  }
}

function wildcardMatch(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

function isAgentMemoryTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return normalized.includes("agentmemory") || normalized.startsWith("memory_");
}

function isNamedMemoryTool(toolName: string, name: string): boolean {
  return isAgentMemoryTool(toolName) && toolName.toLowerCase().endsWith(name);
}

function isRecallTool(toolName: string): boolean {
  if (!isAgentMemoryTool(toolName)) return false;
  return ![
    "memory_save",
    "memory_governance_delete",
    "memory_lesson_save",
    "memory_lesson_delete",
  ].some((allowed) => toolName.toLowerCase().endsWith(allowed));
}

function isConfluenceTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return normalized.includes("confluence") || normalized.includes("atlassian");
}

function safeBaseUrl(environment: CaptureEnvironment): string | undefined {
  const baseUrl = environment.AGENTMEMORY_URL?.trim() || "http://localhost:3111";
  try {
    const parsed = new URL(baseUrl);
    if (
      environment.AGENTMEMORY_SECRET
      && parsed.protocol !== "https:"
      && !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())
    ) return undefined;
    return baseUrl.replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

export async function getClaudeAgentMemoryStatus(
  cwd: string,
  sessionId: string,
  dependencies: CaptureDependencies = {},
): Promise<string> {
  const environment = dependencies.environment ?? process.env;
  const projectIdentity = dependencies.projectIdentity ?? ((directory) => (
    resolveProjectIdentity(directory, { environment })
  ));
  const policy = resolveMemoryPolicy(projectIdentity(cwd), { environment });
  const state = dependencies.state ?? captureState();
  const capture = state.isDisabled(sessionId) ? "off" : policy.capture;
  const baseUrl = safeBaseUrl(environment);
  let available = false;
  if (baseUrl) {
    const headers: Record<string, string> = {};
    if (environment.AGENTMEMORY_SECRET) {
      headers.Authorization = `Bearer ${environment.AGENTMEMORY_SECRET}`;
    }
    try {
      const response = await (dependencies.fetch ?? globalThis.fetch)(
        `${baseUrl}/agentmemory/health`,
        { headers, signal: AbortSignal.timeout(250) },
      );
      available = response.ok;
    } catch {
      // The status bar reports an unavailable optional service.
    }
  }
  const icon = available ? "🧠" : "⚠️";
  const color = available ? "\u001b[32m" : "\u001b[31m";
  return `${icon} ${color}agentmemory\u001b[0m · recall ${policy.recall} · capture ${capture}`;
}

export async function handleClaudeCaptureHook(
  payload: JsonRecord,
  dependencies: CaptureDependencies = {},
): Promise<JsonRecord | undefined> {
  const environment = dependencies.environment ?? process.env;
  const sessionId = String(payload.session_id ?? payload.sessionId ?? "unknown");
  const cwd = String(payload.cwd ?? environment.CLAUDE_PROJECT_DIR ?? process.cwd());
  const projectIdentity = dependencies.projectIdentity ?? ((directory) => (
    resolveProjectIdentity(directory, { environment })
  ));
  const project = projectIdentity(cwd);
  const policy = resolveMemoryPolicy(project, { environment });
  const state = dependencies.state ?? captureState();
  const eventName = String(payload.hook_event_name ?? "");

  if (eventName === "SessionEnd") {
    const wasDisabled = state.isDisabled(sessionId);
    state.clear(sessionId);
    if (policy.capture === "off" || wasDisabled) return;
  }
  const toolName = String(payload.tool_name ?? "");
  if (eventName === "PreToolUse") {
    const unfiltered = ["memory_smart_search", "memory_recall", "memory_sessions"]
      .some((name) => isNamedMemoryTool(toolName, name));
    if (unfiltered) {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "Use project-filtered memory_timeline instead.",
        },
      };
    }
    if (policy.recall === "off" && isRecallTool(toolName)) {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "Agentmemory recall is off for this project.",
        },
      };
    }
    const addsProject = isNamedMemoryTool(toolName, "memory_timeline")
      || isNamedMemoryTool(toolName, "memory_save");
    if (addsProject) {
      const input = payload.tool_input && typeof payload.tool_input === "object"
        ? payload.tool_input
        : {};
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          updatedInput: { ...input, project },
        },
      };
    }
    if (isConfluenceTool(toolName)) {
      state.disable(sessionId);
      return;
    }
  }
  if (policy.capture === "off" || state.isDisabled(sessionId)) return;

  const baseUrl = safeBaseUrl(environment);
  if (!baseUrl) return;
  const fetch = dependencies.fetch ?? globalThis.fetch;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (environment.AGENTMEMORY_SECRET) {
    headers.Authorization = `Bearer ${environment.AGENTMEMORY_SECRET}`;
  }
  const call = async (endpoint: string, body: JsonRecord) => {
    try {
      await fetch(`${baseUrl}/agentmemory/${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(1_500),
      });
    } catch {
      // Historical capture is optional and must not block Claude Code.
    }
  };
  const observe = (hookType: string, data: JsonRecord) => call("observe", {
    hookType,
    sessionId,
    project,
    cwd,
    timestamp: (dependencies.now ?? (() => new Date()))().toISOString(),
    data,
  });

  if (eventName === "SessionStart") {
    await call("session/start", { sessionId, project, cwd });
    return;
  }
  if (eventName === "SessionEnd") {
    await call("session/end", { sessionId });
    return;
  }
  if (eventName === "UserPromptSubmit") {
    if (policy.capture === "full" && typeof payload.prompt === "string") {
      await observe("prompt_submit", { prompt: payload.prompt.slice(0, MAX_CAPTURE_CHARS) });
    }
    return;
  }
  if (eventName === "Stop") {
    if (policy.capture === "full" && typeof payload.last_assistant_message === "string") {
      await observe("post_tool_use", {
        tool_name: "conversation",
        tool_output: payload.last_assistant_message.slice(0, MAX_CAPTURE_CHARS),
      });
    }
    return;
  }
  if (eventName !== "PostToolUse" && eventName !== "PostToolUseFailure") return;

  const observedToolName = toolName || "unknown";
  const excluded = isAgentMemoryTool(observedToolName)
    || policy.excludedTools.some((pattern) => wildcardMatch(observedToolName, pattern));
  if (excluded) return;
  const data: JsonRecord = {
    tool_name: observedToolName,
    tool_error: eventName === "PostToolUseFailure",
  };
  if (policy.capture === "full") {
    data.tool_input = safeSerialize(payload.tool_input);
    data.tool_output = safeSerialize(payload.tool_response ?? payload.error);
  }
  await observe("post_tool_use", data);
}

async function main(): Promise<void> {
  if (process.argv[2] === "--status") {
    const cwd = process.argv[3] || process.cwd();
    const sessionId = process.argv[4] || "unknown";
    process.stdout.write(await getClaudeAgentMemoryStatus(cwd, sessionId));
    return;
  }
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  try {
    const payload = JSON.parse(input);
    if (payload && typeof payload === "object") {
      const result = await handleClaudeCaptureHook(payload);
      if (result) process.stdout.write(JSON.stringify(result));
    }
  } catch {
    // Invalid hook input must not block Claude Code.
  }
}

if (import.meta.main) void main();
