import { homedir } from "node:os";

import { evaluate, resolveGuardHome } from "../../../shared/guard-core";
import { isReadOnlyGitHubCommand } from "./read-only-github";

interface GuardHomeSource {
  environmentHome?: string;
  platformHome: string;
}

interface ClaudePayload {
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

export function evaluateClaudePayload(
  payload: unknown,
  homeSource: GuardHomeSource = {
    environmentHome: process.env.HOME,
    platformHome: homedir(),
  },
) {
  if (!isClaudePayload(payload)) return null;
  const home = resolveGuardHome(homeSource.environmentHome, homeSource.platformHome);
  if (!home) return deniedUnsafeHome();
  const toolInput = payload.tool_input ?? {};
  const tool = String(payload.tool_name ?? "").toLowerCase();
  const rawPath = toolInput.file_path ?? toolInput.path;
  const rawContent = toolInput.content ?? toolInput.new_string;
  const verdict = evaluate({
    tool,
    command: optionalString(toolInput.command),
    path: optionalString(rawPath),
    pattern: tool === "glob" ? optionalString(toolInput.pattern) : undefined,
    content: optionalString(rawContent),
    cwd: payload.cwd,
    home,
  });
  if (verdict) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: verdict.reason,
      },
    };
  }
  const command = optionalString(toolInput.command);
  if (tool !== "bash" || !command) return null;
  if (!isReadOnlyGitHubCommand(command)) return null;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "Read-only GitHub CLI request.",
    },
  };
}

function deniedUnsafeHome() {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Refused — a safe absolute home directory could not be established for guard evaluation.",
    },
  };
}

function isClaudePayload(payload: unknown): payload is ClaudePayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const candidate = payload as ClaudePayload;
  return candidate.tool_input === undefined
    || !!candidate.tool_input && typeof candidate.tool_input === "object" && !Array.isArray(candidate.tool_input);
}

function optionalString(value: unknown) {
  return value == null ? undefined : String(value);
}
