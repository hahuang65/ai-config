import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import registerAgentMemory, {
  resolveMemoryPolicy,
  resolveProjectIdentity,
  type AgentMemoryEnvironment,
} from "../../harnesses/pi/extensions/agentmemory/index.ts";

type FetchCall = { url: string; init?: RequestInit };
type ToolDefinition = {
  name: string;
  execute: (...args: any[]) => Promise<any>;
};
function response(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

function harness(environment: AgentMemoryEnvironment = {}) {
  const isolatedEnvironment = {
    AGENTMEMORY_POLICY_PATH: "/nonexistent-agentmemory-policy-test.json",
    ...environment,
  };
  const handlers = new Map<string, Array<(event: any, context: any) => any>>();
  const tools = new Map<string, ToolDefinition>();
  const commands = new Map<string, (args: string, context: any) => any>();
  const calls: FetchCall[] = [];
  const statuses: string[] = [];
  const notifications: string[] = [];
  const footers: unknown[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/health")) return response({ status: "healthy", version: "0.9.29" });
    if (url.includes("/search")) {
      return response({
        format: "compact",
        results: [
          {
            obsId: "obs-17",
            type: "decision",
            title: "Old authentication decision",
            timestamp: "2026-01-02T03:04:05.000Z",
            sessionId: "session-9",
            score: 0.91,
          },
        ],
      });
    }
    if (url.includes("/sessions")) return response({ sessions: [] });
    if (url.includes("/verify")) return response({ id: "obs-17", verified: true });
    return response({ ok: true, id: "mem-1", deleted: 1 });
  };
  const pi = {
    on(name: string, handler: (event: any, context: any) => any) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    registerTool(definition: ToolDefinition) {
      tools.set(definition.name, definition);
    },
    registerCommand(name: string, definition: { handler: (args: string, context: any) => any }) {
      commands.set(name, definition.handler);
    },
  };
  const context = {
    cwd: "/worktrees/service-one",
    ui: {
      setStatus: (_key: string, text: string) => statuses.push(text),
      setFooter: (footer: unknown) => footers.push(footer),
      notify: (text: string) => notifications.push(text),
      theme: {
        fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
      },
    },
    sessionManager: {
      getSessionFile: () => "/sessions/session-1.jsonl",
    },
  };

  registerAgentMemory(pi as any, {
    fetch: fetch as typeof globalThis.fetch,
    environment: isolatedEnvironment,
    projectIdentity: () => "github.com/acme/service",
    randomUUID: () => "random-session",
    now: () => new Date("2026-09-02T10:00:00.000Z"),
  });

  return { handlers, tools, commands, calls, statuses, notifications, footers, context };
}

async function emit(
  instance: ReturnType<typeof harness>,
  eventName: string,
  event: Record<string, unknown> = {},
) {
  const results = [];
  for (const handler of instance.handlers.get(eventName) ?? []) {
    results.push(await handler(event, instance.context));
  }
  return results;
}

function requestBody(call: FetchCall): any {
  return call.init?.body ? JSON.parse(String(call.init.body)) : undefined;
}

describe("optional agentmemory pi adapter", () => {
  test("is installed by the pi harness module", () => {
    const manifest = readFileSync(new URL("../../harnesses/pi/manifest.sh", import.meta.url), "utf8");
    expect(manifest).toContain('"$MOD/extensions/agentmemory/index.ts"');
  });

  test("registers the shared memory tool surface without automatic recall", () => {
    const instance = harness();

    expect([...instance.tools.keys()].sort()).toEqual([
      "memory_capture_control",
      "memory_governance_delete",
      "memory_health",
      "memory_save",
      "memory_sessions",
      "memory_smart_search",
      "memory_verify",
    ]);
  });

  test("captures a prompt without injecting recalled memory into the system prompt", async () => {
    const instance = harness();
    await emit(instance, "session_start", { reason: "startup" });
    expect(instance.statuses.at(-1)).toContain("🧠 <success>agentmemory</success>");
    expect(instance.footers).toHaveLength(1);
    const [result] = await emit(instance, "before_agent_start", {
      prompt: "Add rate limiting",
      systemPrompt: "original system prompt",
      systemPromptOptions: { cwd: "/worktrees/service-one" },
    });

    expect(result).toBeUndefined();
    const observation = instance.calls.find((call) => call.url.endsWith("/observe"));
    expect(requestBody(observation!)).toMatchObject({
      project: "github.com/acme/service",
      data: { prompt: "Add rate limiting" },
    });
    expect(instance.calls.some((call) => call.url.endsWith("/smart-search"))).toBe(false);
  });

  test("capture off sends no session or observation data", async () => {
    const instance = harness({ AGENTMEMORY_CAPTURE: "off" });

    await emit(instance, "session_start", { reason: "startup" });
    await emit(instance, "before_agent_start", {
      prompt: "Sensitive prompt",
      systemPromptOptions: { cwd: "/worktrees/service-one" },
    });
    await emit(instance, "tool_result", {
      toolName: "mcp__atlassian__getConfluencePage",
      input: { pageId: "secret-page" },
      content: [{ type: "text", text: "confidential content" }],
    });
    await emit(instance, "agent_end", { messages: [] });

    expect(instance.calls.map((call) => call.url)).toEqual([
      "http://localhost:3111/agentmemory/health",
    ]);
  });

  test("captures completed conversations through agentmemory's supported observation hook", async () => {
    const instance = harness();
    await emit(instance, "session_start", { reason: "startup" });
    await emit(instance, "before_agent_start", {
      prompt: "Explain the change",
      systemPromptOptions: { cwd: "/worktrees/service-one" },
    });

    await emit(instance, "agent_end", {
      messages: [{ role: "assistant", content: [{ type: "text", text: "The change is complete." }] }],
    });

    const observations = instance.calls.filter((call) => call.url.endsWith("/observe"));
    expect(requestBody(observations.at(-1)!)).toMatchObject({
      hookType: "post_tool_use",
      data: {
        tool_name: "conversation",
        tool_input: "Explain the change",
        tool_output: "The change is complete.",
      },
    });
  });

  test("metadata capture omits tool arguments and output", async () => {
    const instance = harness({ AGENTMEMORY_CAPTURE: "metadata" });
    await emit(instance, "session_start", { reason: "startup" });

    await emit(instance, "tool_result", {
      toolName: "read",
      input: { path: "sensitive.md" },
      content: [{ type: "text", text: "confidential content" }],
      isError: false,
    });

    const observations = instance.calls.filter((call) => call.url.endsWith("/observe"));
    expect(requestBody(observations[0])).toMatchObject({
      data: { tool_name: "read", tool_error: false },
    });
    expect(JSON.stringify(requestBody(observations[0]))).not.toContain("sensitive.md");
    expect(JSON.stringify(requestBody(observations[0]))).not.toContain("confidential content");
  });

  test("honors configured tool exclusions", async () => {
    const instance = harness({ AGENTMEMORY_EXCLUDED_TOOLS: "*confluence*,mcp__private__*" });
    await emit(instance, "session_start", { reason: "startup" });

    await emit(instance, "tool_result", {
      toolName: "mcp__atlassian__confluence_page",
      input: { page: "confidential" },
      content: [{ type: "text", text: "confidential" }],
    });

    expect(instance.calls.filter((call) => call.url.endsWith("/observe"))).toHaveLength(0);
  });

  test("never captures agentmemory tool results", async () => {
    const instance = harness();
    await emit(instance, "session_start", { reason: "startup" });

    await emit(instance, "tool_result", {
      toolName: "memory_save",
      input: { content: "Do not feed this back" },
      content: [{ type: "text", text: "Saved" }],
    });

    expect(instance.calls.filter((call) => call.url.endsWith("/observe"))).toHaveLength(0);
  });

  test("search is explicit, project scoped, and labels results as historical", async () => {
    const instance = harness();
    const search = instance.tools.get("memory_smart_search")!;

    const result = await search.execute("call-1", { query: "authentication", limit: 5 });

    const searchCall = instance.calls.find((call) => call.url.endsWith("/search"));
    expect(requestBody(searchCall!)).toEqual({
      query: "authentication",
      limit: 5,
      format: "compact",
      project: "github.com/acme/service",
    });
    expect(result.content[0].text).toContain("Historical information");
    expect(result.content[0].text).toContain("obs-17");
    expect(result.content[0].text).toContain("2026-01-02T03:04:05.000Z");
    expect(result.content[0].text).toContain("session-9");
    expect(result.content[0].text).toContain("origin=unknown");
  });

  test("recall off refuses searches without contacting agentmemory", async () => {
    const instance = harness({ AGENTMEMORY_RECALL: "off" });
    const search = instance.tools.get("memory_smart_search")!;

    const result = await search.execute("call-1", { query: "authentication" });

    expect(result.content[0].text).toContain("Recall is off");
    expect(instance.calls).toHaveLength(0);
  });

  test("save sends concepts, files, and the stable project identity", async () => {
    const instance = harness();
    const save = instance.tools.get("memory_save")!;

    await save.execute("call-1", {
      content: "A historical finding",
      type: "gotcha",
      concepts: "auth, token-rotation",
      files: "src/auth.ts",
    });

    const saveCall = instance.calls.find((call) => call.url.endsWith("/remember"));
    expect(requestBody(saveCall!)).toEqual({
      content: "A historical finding",
      type: "gotcha",
      concepts: ["auth", "token-rotation"],
      files: ["src/auth.ts"],
      project: "github.com/acme/service",
    });
  });

  test("ends replaced sessions but not extension reloads", async () => {
    const replaced = harness();
    await emit(replaced, "session_start", { reason: "startup" });
    await emit(replaced, "session_shutdown", { reason: "new" });
    expect(replaced.calls.some((call) => call.url.endsWith("/session/end"))).toBe(true);

    const reloaded = harness();
    await emit(reloaded, "session_start", { reason: "startup" });
    await emit(reloaded, "session_shutdown", { reason: "reload" });
    expect(reloaded.calls.some((call) => call.url.endsWith("/session/end"))).toBe(false);
  });

  test("refuses bearer authentication over remote plaintext HTTP", async () => {
    const instance = harness({
      AGENTMEMORY_URL: "http://memory.example.com:3111",
      AGENTMEMORY_SECRET: "configured-outside-source",
    });

    await expect(emit(instance, "session_start", { reason: "startup" })).rejects.toThrow(
      "refuses to send a bearer token",
    );
    expect(instance.calls).toHaveLength(0);
  });

  test("capture control turns capture off before its own result can be observed", async () => {
    const instance = harness();
    await emit(instance, "session_start", { reason: "startup" });
    const control = instance.tools.get("memory_capture_control")!;

    const result = await control.execute("call-1", { mode: "off" }, undefined, undefined, instance.context);
    await emit(instance, "tool_result", {
      toolName: "memory_capture_control",
      input: { mode: "off" },
      content: result.content,
    });

    expect(result.content[0].text).toContain("capture off");
    expect(instance.calls.filter((call) => call.url.endsWith("/observe"))).toHaveLength(0);
  });
});

describe("agentmemory user-owned policy", () => {
  test("applies a matching project policy without repository configuration", () => {
    const policy = resolveMemoryPolicy("github.com/acme/payments", {
      environment: {},
      readFile: () => JSON.stringify({
        default: { capture: "metadata", recall: "explicit" },
        projects: {
          "github.com/acme/payments": {
            capture: "off",
            recall: "off",
            excludedTools: ["*atlassian*"],
          },
        },
      }),
    });

    expect(policy).toEqual({
      capture: "off",
      recall: "off",
      excludedTools: ["memory_*", "*atlassian*"],
    });
  });

  test("lets process environment settings override the user-owned file", () => {
    const policy = resolveMemoryPolicy("github.com/acme/payments", {
      environment: {
        AGENTMEMORY_CAPTURE: "full",
        AGENTMEMORY_EXCLUDED_TOOLS: "private_*",
      },
      readFile: () => JSON.stringify({ default: { capture: "off" } }),
    });

    expect(policy.capture).toBe("full");
    expect(policy.excludedTools).toEqual(["memory_*", "private_*"]);
  });
});

describe("agentmemory project identity", () => {
  test("prefers an explicit cross-harness project name", () => {
    expect(
      resolveProjectIdentity("/worktree", {
        environment: { AGENTMEMORY_PROJECT_NAME: "acme/payments" },
        git: () => "ignored",
      }),
    ).toBe("acme/payments");
  });

  test("normalizes a GitHub origin and shares it across worktrees", () => {
    expect(
      resolveProjectIdentity("/worktree", {
        environment: {},
        git: (args) => {
          if (args[0] === "remote") return "git@github.com:acme/payments.git";
          return "/repos/payments/.git";
        },
      }),
    ).toBe("github.com/acme/payments");
  });

  test("uses a stable local identity when no remote exists", () => {
    const dependencies = {
      environment: {},
      git: (args: string[]) => {
        if (args[0] === "remote") throw new Error("no origin");
        return "/repos/payments/.git";
      },
    };

    expect(resolveProjectIdentity("/worktree-a", dependencies)).toBe(
      resolveProjectIdentity("/worktree-b", dependencies),
    );
    expect(resolveProjectIdentity("/worktree-a", dependencies)).toMatch(/^local\/payments-[a-f0-9]{12}$/);
  });
});
