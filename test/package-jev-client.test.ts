import { expect, test } from "bun:test";
import { classifyJev, JEV_MODEL } from "../harnesses/jev-client";
import { POLICIES } from "../guard/policy-registry";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

test("native Jev bridge uses existing provider configuration with a loopback-only synthetic service", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "jev-native-")));
  const requests: any[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json() as any;
    requests.push(body);
    return Response.json({ model: JEV_MODEL, answers: Object.fromEntries(Object.keys(body.questions).map(key => [key, { type: "noul", noul: 0.91 }])), usage: { input_tokens: 80, output_tokens: 0 } });
  } });
  try {
    const agent = join(home, ".pi/agent");
    mkdirSync(agent, { recursive: true });
    writeFileSync(join(agent, "models.json"), JSON.stringify({ providers: { typesafe: { baseUrl: `http://127.0.0.1:${server.port}/v1` } } }));
    const input = join(home, "request.json");
    writeFileSync(input, JSON.stringify({ state: { excerpt: "Only synthetic evidence" }, questions: { support: question } }));
    const node = execFileSync("node", ["-p", "process.execPath"], { encoding: "utf8" }).trim();
    const child = Bun.spawn([node, resolve("harnesses/pi/jev-bridge.mjs"), input], { cwd: home,
      env: { HOME: home, PI_CODING_AGENT_DIR: agent, TYPESAFE_API_KEY: "fixture", PATH: `${dirname(node)}:/opt/homebrew/bin:/usr/bin:/bin`, XDG_CACHE_HOME: join(home, ".cache"), AI_REVIEW_EXCLUDED_SOURCES: JSON.stringify([join(home, "source")]) },
      stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
    try {
      const [status, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(status, error).toBe(0);
      const result = JSON.parse(output);
      expect(result.status).toBe("ok");
      expect(result.probabilities.support).toBe(0.91);
      expect(result.inputTokens).toBe(80);
      expect(requests).toHaveLength(1);
      expect(requests[0].model).toBe(JEV_MODEL);
      expect(requests[0].state).toEqual({ excerpt: "Only synthetic evidence" });
    } finally { clearTimeout(timer); }
  } finally { server.stop(true); rmSync(home, { recursive: true, force: true }); }
}, 15000);

test("a response from an unexpected model cannot be reported as the pinned Jev result", async () => {
  const result = await classifyJev({ findOfType: () => ({ provider: "typesafe", id: "jev-latest", type: "classifier" }),
    classify: async () => ({ stopReason: "stop", model: "different-model", answers: { check: { type: "bool", probability: 0.01 } } }),
  } as any, { state: {}, questions: { check: question } });
  expect(result.status).toBe("unavailable");
  expect(result.probabilities).toEqual({});
});

test("known credential literals are rejected locally before any classifier call", async () => {
  let calls = 0;
  const content = POLICIES.find(policy => policy.id === "no-hardcoded-secret")!.example.content;
  const result = await classifyJev({ findOfType: () => ({ provider: "typesafe", id: "jev-latest", type: "classifier" }),
    classify: async () => { calls++; return { stopReason: "stop", model: JEV_MODEL, answers: { check: { type: "bool", probability: 0.01 } } }; },
  } as any, { state: { excerpt: content }, questions: { check: question } });
  expect(result.status).toBe("unavailable");
  expect(calls).toBe(0);
});

test.each([["NaN", NaN], ["infinite", Infinity], ["negative", -0.1], ["over-one", 1.1], ["string", "0.01"], ["missing", undefined]])("malformed %s probability cannot become a valid judgment", async (_label, value) => {
  const result = await classifyJev({ findOfType: () => ({ provider: "typesafe", id: "jev-latest", type: "classifier" }),
    classify: async () => ({ stopReason: "stop", model: JEV_MODEL, answers: { check: { type: "bool", probability: value } } }),
  } as any, { state: {}, questions: { check: question } });
  expect(result.status).toBe("unavailable");
  expect(result.probabilities).toEqual({});
});

test("aborting a classifier that ignores cancellation does not leave the caller waiting", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10);
  try {
    const result = await classifyJev({ findOfType: () => ({ provider: "typesafe", id: "jev-latest", type: "classifier" }),
      classify: async () => new Promise(() => {}),
    } as any, { state: {}, questions: { check: question } }, controller.signal);
    expect(result.status).toBe("unavailable");
  } finally { clearTimeout(timer); }
}, 1000);

test("oversized input and already-aborted calls never reach a provider", async () => {
  let calls = 0;
  const registry = { findOfType: () => { calls++; return undefined; }, classify: async () => { throw Error("not called"); } };
  const request = { state: { text: "x".repeat(32769) }, questions: { check: question } };
  expect((await classifyJev(registry as any, request)).status).toBe("unavailable");
  expect((await classifyJev(registry as any, { ...request, state: {} }, AbortSignal.abort())).status).toBe("unavailable");
  expect(calls).toBe(0);
});

const question = { type: "bool" as const, instructions: "Does the evidence support the condition?",
  criteria: { true: "Supported", false: "Not supported" } };

test("Jev uses one pinned batched request and exposes only validated numeric judgments", async () => {
  const calls: unknown[] = [];
  const registry = {
    findOfType: () => ({ type: "classifier", provider: "typesafe", id: "jev-latest" }),
    classify: async (...args: unknown[]) => {
      calls.push(args);
      return { stopReason: "stop", model: JEV_MODEL,
        answers: { first: { type: "bool", probability: 0.95 }, second: { type: "bool", probability: 0.2 } },
        usage: { input: 123, output: 0 } };
    },
  };
  const result = await classifyJev(registry as any, { state: { excerpt: "Synthetic source" }, questions: { first: question, second: question } });
  expect(calls).toHaveLength(1);
  expect((calls[0] as any[])[0].id).toBe(JEV_MODEL);
  expect(result.status).toBe("ok");
  expect(result.probabilities).toEqual({ first: 0.95, second: 0.2 });
  expect(result.inputTokens).toBe(123);
});
