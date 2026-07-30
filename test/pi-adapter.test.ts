import { test, expect } from "bun:test";
import guard from "../harnesses/pi/extensions/guard-policies";

// Drive the pi adapter the way pi would: register its tool_call handler via a
// fake ExtensionAPI, then invoke the handler with a structured event. pi's
// Drive pi's extension API through a representative tool_call event.
function runToolCall(event: unknown): { block?: boolean; reason?: string } | undefined {
  let handler: ((e: unknown) => any) | undefined;
  const pi = { on: (name: string, fn: (e: unknown) => any) => { if (name === "tool_call") handler = fn; } };
  guard(pi as any);
  return handler?.(event);
}

test("pi adapter blocks a credential read by routing through the guard core", () => {
  const result = runToolCall({ toolName: "read", input: { path: "/home/user/.ssh/id_rsa" } });
  expect(result?.block).toBe(true);
});

test("pi adapter allows an ordinary read", () => {
  const result = runToolCall({ toolName: "read", input: { path: "/home/user/project/main.ts" } });
  expect(result).toBeUndefined();
});

test("pi adapter blocks a write that smuggles a hardcoded secret through content", () => {
  // Key built by concatenation so this test file is not itself a secret literal.
  const key = "AKIA" + "IOSFODNN7EXAMPLE";
  const result = runToolCall({ toolName: "write", input: { file_path: "config.ts", content: `const id = '${key}';` } });
  expect(result?.block).toBe(true);
});
