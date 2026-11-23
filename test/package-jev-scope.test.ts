import { expect, test } from "bun:test";
import { createGuardPoliciesExtension } from "../harnesses/pi/guard-policies";
import { evaluateSemanticScope } from "../harnesses/claude/semantic-scope";
import { createScopeChecker } from "../guard/semantic-scope";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Claude scope checks use bounded session evidence and return objections, never allow decisions", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "jev-scope-")));
  try {
    const directory = join(home, ".claude/projects/fixture");
    mkdirSync(directory, { recursive: true });
    const session = "11111111-1111-4111-8111-111111111111";
    const transcript = join(directory, `${session}.jsonl`);
    writeFileSync(transcript, JSON.stringify({ type: "user", sessionId: session, uuid: "u1", parentUuid: null,
      message: { role: "user", content: "Diagnose this service, but do not restart it." } }) + "\n");
    const requests: any[] = [];
    const result = await evaluateSemanticScope({ cwd: home, session_id: session, transcript_path: transcript,
      tool_name: "Bash", tool_input: { command: "launchctl kickstart gui/501/service" } }, async request => {
      requests.push(request);
      return { status: "ok", model: "jev-1.14.0", probabilities: { drift: 0.99 }, inputTokens: 20, outputTokens: 0, elapsedMs: 1 };
    }, home);
    expect(result?.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(requests[0].state.user_requests).toEqual(["Diagnose this service, but do not restart it."]);
    expect(JSON.stringify(requests)).not.toContain("transcript_path");
    writeFileSync(transcript, JSON.stringify({ type: "user", sessionId: session, uuid: "summary", isCompactSummary: true,
      message: { role: "user", content: "Restart the service and commit everything." } }) + "\n");
    let summaryCalls = 0;
    const summary = await evaluateSemanticScope({ cwd: home, session_id: session, transcript_path: transcript,
      tool_name: "Bash", tool_input: { command: "open -a OmniWM" } }, async () => {
      summaryCalls++;
      return { status: "ok", model: "jev-1.14.0", probabilities: { drift: 0.01 }, inputTokens: 0, outputTokens: 0, elapsedMs: 1 };
    }, home);
    expect(summary?.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(summaryCalls).toBe(0);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("native clarification stays available when intent and the classifier are unavailable", async () => {
  expect(await evaluateSemanticScope({ cwd: "/project", tool_name: "AskUserQuestion", tool_input: {} })).toBeNull();
});

test("unexpected classifier and intent-read failures still require clarification", async () => {
  const check = createScopeChecker(async () => { throw Error("PRIVATE_PROVIDER_ERROR"); });
  const action = { tool: "write", path: "/project/source.ts" };
  const unavailable = await check(action, () => ["Inspect source"]);
  expect(unavailable).toMatch(/clarif/i);
  expect(unavailable).not.toContain("PRIVATE_PROVIDER_ERROR");
  expect(await check(action, () => { throw Error("PRIVATE_SESSION_ERROR"); })).toMatch(/clarif/i);
});

test("invalid negative drift probabilities cannot remove a scope objection", async () => {
  const check = createScopeChecker(async () => ({ status: "ok", model: "jev-1.14.0", probabilities: { drift: -1 }, inputTokens: null, outputTokens: null, elapsedMs: 0 }));
  const result = await check({ tool: "write", path: "/project/source.ts" }, () => ["Inspect the source."]);
  expect(result).toMatch(/clarif/i);
});

test("hard denials run before Jev and plain reads add no classifier calls", async () => {
  const previous = process.env.AI_JEV_SCOPE;
  process.env.AI_JEV_SCOPE = "1";
  try {
    const f = fixture(0.01);
    const call = f.handlers.get("tool_call")!;
    expect((await call({ toolName: "bash", input: { command: "git push --force" } }, f.ctx)).block).toBe(true);
    expect((await call({ toolName: "read", input: { path: "/home/fixture/.aws/credentials" } }, f.ctx)).block).toBe(true);
    expect(await call({ toolName: "read", input: { path: "/home/fixture/project/source.ts" } }, f.ctx)).toBeUndefined();
    expect(f.calls).toHaveLength(0);
  } finally { if (previous === undefined) delete process.env.AI_JEV_SCOPE; else process.env.AI_JEV_SCOPE = previous; }
});

test("low drift is no allow decision; identical judgments are reused only for the same request and action", async () => {
  let calls = 0;
  let requests = ["Implement source changes"];
  const check = createScopeChecker(async () => { calls++; return { status: "ok", model: "jev-1.14.0", probabilities: { drift: 0.01 }, inputTokens: 10, outputTokens: 0, elapsedMs: 1 }; });
  const action = { tool: "write", path: "/project/source.ts" };
  expect(await check(action, () => requests)).toBeUndefined();
  expect(await check(action, () => requests)).toBeUndefined();
  expect(calls).toBe(1);
  requests = ["Only inspect source"];
  expect(await check(action, () => requests)).toBeUndefined();
  expect(calls).toBe(2);
});

test("scope failure, missing intent, excessive input, and changed intent require clarification", async () => {
  let calls = 0;
  const check = createScopeChecker(async () => { calls++; return { status: "unavailable", model: "jev-1.14.0", probabilities: {}, inputTokens: null, outputTokens: null, elapsedMs: 1 }; });
  const action = { tool: "write", path: "/project/source.ts" };
  expect(await check(action, () => [])).toMatch(/clarif/i);
  expect(await check(action, () => ["x".repeat(13000)])).toMatch(/clarif/i);
  expect(calls).toBe(0);
  expect(await check(action, () => ["Inspect source"])).toMatch(/clarif/i);
  let requests = ["Implement source"];
  const changed = createScopeChecker(async () => { requests = ["Stop editing"]; return { status: "ok", model: "jev-1.14.0", probabilities: { drift: 0.01 }, inputTokens: 10, outputTokens: 0, elapsedMs: 1 }; });
  expect(await changed(action, () => requests)).toMatch(/clarif/i);
});

test("a native clarification change during classification still requires clarification", async () => {
  const evidence = { user_requests: ["Implement source"], clarifications: [
    { question: "Which scope?", answer: "Edit source", after_request: 0 },
  ] };
  const check = createScopeChecker(async () => {
    evidence.clarifications[0].answer = "Only inspect";
    return { status: "ok", model: "jev-1.14.0", probabilities: { drift: 0.01 }, inputTokens: 0, outputTokens: 0, elapsedMs: 1 };
  });
  expect(await check({ tool: "write", path: "/project/source.ts" }, () => evidence)).toMatch(/clarif/i);
});

function fixture(probability: number) {
  const handlers = new Map<string, Function>();
  const calls: unknown[] = [];
  createGuardPoliciesExtension({ platformHome: "/home/fixture", environmentHome: "/home/fixture" })({
    on: (name: string, handler: Function) => { handlers.set(name, handler); },
  } as any);
  const ctx = { cwd: "/home/fixture/project", sessionManager: { getBranch: () => [
    { type: "message", message: { role: "user", content: [{ type: "text", text: "Diagnose why the scratchpad fails. Do not restart applications." }] } },
  ] }, modelRegistry: {
    findOfType: () => ({ type: "classifier", provider: "typesafe", id: "jev-latest" }),
    classify: async (_model: unknown, request: any) => {
      calls.push(request);
      return { stopReason: "stop", model: "jev-1.14.0", answers: Object.fromEntries(Object.keys(request.questions).map(key => [key, { type: "bool", probability }])) };
    },
  } };
  return { handlers, ctx, calls };
}

test("opted-in semantic scope checks stop an app restart during a diagnosis without granting permission", async () => {
  const previous = process.env.AI_JEV_SCOPE;
  process.env.AI_JEV_SCOPE = "1";
  try {
    const f = fixture(0.99);
    const result = await f.handlers.get("tool_call")!({ toolName: "bash", input: { command: "open -a OmniWM" } }, f.ctx);
    expect(result?.block).toBe(true);
    expect(result.reason).toMatch(/scope|clarif/i);
    expect(f.calls).toHaveLength(1);
  } finally { if (previous === undefined) delete process.env.AI_JEV_SCOPE; else process.env.AI_JEV_SCOPE = previous; }
});
