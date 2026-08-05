export function describeToolCall(toolName, args = {}) {
  const value = (key) => typeof args?.[key] === "string" ? args[key] : "";
  if (toolName === "read") return `Read ${value("path")}`;
  if (toolName === "grep") return `Search ${value("pattern")}${value("path") ? ` in ${value("path")}` : ""}`;
  if (toolName === "find") return `Find ${value("pattern") || value("path")}`;
  if (toolName === "bash") return `Run ${value("command")}`;
  if (toolName === "subagent") return `Dispatch ${value("agent") || "subagent"}${value("task") ? ` — ${value("task")}` : ""}`;
  if (["write", "edit"].includes(toolName)) return `${toolName} ${value("path")}`;
  return toolName ? `Use ${toolName}` : "";
}

export function summarizeToolResult(toolName, result) {
  const content = Array.isArray(result?.content)
    ? result.content.filter((part) => part?.type === "text").map((part) => part.text).join("\n")
    : "";
  const lines = String(content).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (toolName === "bash") {
    const exitCode = result?.details?.exitCode ?? result?.details?.code;
    const exit = Number.isInteger(exitCode) ? `exit ${exitCode}` : "";
    return [exit, ...lines.slice(-2)].filter(Boolean).join(" · ");
  }
  if (["read", "grep", "find"].includes(toolName) && lines.length > 0) {
    return `${lines.length} output line${lines.length === 1 ? "" : "s"}`;
  }
  return lines.slice(-1).join("");
}
