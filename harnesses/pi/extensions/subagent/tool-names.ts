const PI_TOOL_NAMES: Readonly<Record<string, string>> = Object.freeze({
  read: "read",
  write: "write",
  edit: "edit",
  bash: "bash",
  grep: "grep",
  glob: "find",
  find: "find",
  ls: "ls",
});

export function parseAgentTools(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;

  const rawNames = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const names = rawNames.map((name) => String(name).trim()).filter(Boolean);
  if (names.length === 0) throw new Error("Agent tools must contain at least one supported pi tool");

  const unsupported = names.filter((name) => !PI_TOOL_NAMES[name.toLowerCase()]);
  if (unsupported.length > 0) {
    throw new Error(`Unsupported pi subagent tools: ${[...new Set(unsupported)].join(", ")}`);
  }

  return [...new Set(names.map((name) => PI_TOOL_NAMES[name.toLowerCase()]))];
}
