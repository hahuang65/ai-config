import { evaluate } from "../../../shared/guard-core";

interface ClaudePayload {
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

export function evaluateClaudePayload(payload: unknown, home = process.env.HOME) {
  if (!isClaudePayload(payload)) return null;
  const toolInput = payload.tool_input ?? {};
  const rawPath = toolInput.file_path ?? toolInput.path;
  const rawContent = toolInput.content ?? toolInput.new_string;
  const verdict = evaluate({
    tool: String(payload.tool_name ?? "").toLowerCase(),
    command: optionalString(toolInput.command),
    path: optionalString(rawPath),
    content: optionalString(rawContent),
    cwd: payload.cwd,
    home,
  });
  if (!verdict) return null;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: verdict.reason,
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
