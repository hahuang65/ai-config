import { test, expect } from "bun:test";
import guard from "../harnesses/omp/hooks/pre/guard-policies";

// Drive the oh-my-pi adapter the way oh-my-pi would: register its tool_call
// handler via a fake HookAPI, then invoke the handler with a structured event.
function runToolCall(event: unknown): { block?: boolean; reason?: string } | undefined {
  let handler: ((e: unknown) => any) | undefined;
  const pi = { on: (name: string, fn: (e: unknown) => any) => { if (name === "tool_call") handler = fn; } };
  guard(pi as any);
  return handler?.(event);
}

test("oh-my-pi adapter blocks a credential read by routing through the guard core", () => {
  const result = runToolCall({ toolName: "read", input: { path: "/home/user/.ssh/id_rsa" } });
  expect(result?.block).toBe(true);
});

test("oh-my-pi adapter allows an ordinary read", () => {
  const result = runToolCall({ toolName: "read", input: { path: "/home/user/project/main.ts" } });
  expect(result).toBeUndefined();
});
