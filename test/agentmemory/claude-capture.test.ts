import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  getClaudeAgentMemoryStatus,
  handleClaudeCaptureHook,
} from "../../harnesses/claude/hooks/agentmemory-capture.ts";

type FetchCall = { url: string; init?: RequestInit };

function harness(environment: Record<string, string | undefined> = {}) {
  const calls: FetchCall[] = [];
  const isolatedEnvironment = {
    AGENTMEMORY_POLICY_PATH: "/nonexistent-agentmemory-policy-test.json",
    ...environment,
  };
  const disabled = new Set<string>();
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ ok: true }) } as Response;
  };
  const dependencies = {
    environment: isolatedEnvironment,
    fetch: fetch as typeof globalThis.fetch,
    now: () => new Date("2026-09-02T10:00:00.000Z"),
    projectIdentity: () => "github.com/acme/service",
    state: {
      clear: (sessionId: string) => disabled.delete(sessionId),
      disable: (sessionId: string) => disabled.add(sessionId),
      isDisabled: (sessionId: string) => disabled.has(sessionId),
    },
  };
  return { calls, dependencies, disabled };
}

function body(call: FetchCall): Record<string, any> {
  return JSON.parse(String(call.init?.body));
}

function withoutColor(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

const base = {
  session_id: "claude-session-1",
  cwd: "/worktrees/service-one",
};

describe("managed Claude agentmemory capture", () => {
  test("captures a project-scoped session, prompt, and tool result", async () => {
    const instance = harness();

    await handleClaudeCaptureHook({ ...base, hook_event_name: "SessionStart" }, instance.dependencies);
    await handleClaudeCaptureHook({
      ...base,
      hook_event_name: "UserPromptSubmit",
      prompt: "Add rate limiting",
    }, instance.dependencies);
    await handleClaudeCaptureHook({
      ...base,
      hook_event_name: "PostToolUse",
      tool_name: "Read",
      tool_input: { file_path: "src/auth.ts" },
      tool_response: "source",
    }, instance.dependencies);

    expect(body(instance.calls[0])).toMatchObject({
      sessionId: "claude-session-1",
      project: "github.com/acme/service",
      cwd: "/worktrees/service-one",
    });
    expect(body(instance.calls[1])).toMatchObject({
      hookType: "prompt_submit",
      project: "github.com/acme/service",
      data: { prompt: "Add rate limiting" },
    });
    expect(body(instance.calls[2])).toMatchObject({
      hookType: "post_tool_use",
      data: {
        tool_name: "Read",
        tool_input: '{"file_path":"src/auth.ts"}',
        tool_output: "source",
        tool_error: false,
      },
    });
  });

  test("metadata mode omits prompt and tool content", async () => {
    const instance = harness({ AGENTMEMORY_CAPTURE: "metadata" });

    await handleClaudeCaptureHook({
      ...base,
      hook_event_name: "UserPromptSubmit",
      prompt: "Private prompt",
    }, instance.dependencies);
    await handleClaudeCaptureHook({
      ...base,
      hook_event_name: "PostToolUse",
      tool_name: "Read",
      tool_input: { file_path: "private.txt" },
      tool_response: "private content",
    }, instance.dependencies);

    expect(instance.calls).toHaveLength(1);
    expect(body(instance.calls[0]).data).toEqual({
      tool_name: "Read",
      tool_error: false,
    });
  });

  test("turns capture off before a Confluence read and keeps it off", async () => {
    const instance = harness();

    await handleClaudeCaptureHook({
      ...base,
      hook_event_name: "PreToolUse",
      tool_name: "mcp__atlassian__getConfluencePage",
      tool_input: { pageId: "123" },
    }, instance.dependencies);
    await handleClaudeCaptureHook({
      ...base,
      hook_event_name: "PostToolUse",
      tool_name: "mcp__atlassian__getConfluencePage",
      tool_response: "confidential page",
    }, instance.dependencies);
    await handleClaudeCaptureHook({
      ...base,
      hook_event_name: "UserPromptSubmit",
      prompt: "Summarize that page",
    }, instance.dependencies);

    expect(instance.disabled.has("claude-session-1")).toBe(true);
    expect(instance.calls).toHaveLength(0);
  });

  test("honors configured tool exclusions", async () => {
    const instance = harness({ AGENTMEMORY_EXCLUDED_TOOLS: "Read" });

    await handleClaudeCaptureHook({
      ...base,
      hook_event_name: "PostToolUse",
      tool_name: "Read",
      tool_response: "content",
    }, instance.dependencies);

    expect(instance.calls).toHaveLength(0);
  });

  test("never captures agentmemory MCP tool traffic", async () => {
    const instance = harness();

    await handleClaudeCaptureHook({
      ...base,
      hook_event_name: "PostToolUse",
      tool_name: "mcp__agentmemory__memory_smart_search",
      tool_input: { query: "old bug" },
      tool_response: "memory result",
    }, instance.dependencies);

    expect(instance.calls).toHaveLength(0);
  });

  test("blocks unfiltered recall and injects project scope into filtered recall", async () => {
    const instance = harness();

    const unfiltered = await handleClaudeCaptureHook({
      ...base,
      hook_event_name: "PreToolUse",
      tool_name: "mcp__agentmemory__memory_smart_search",
      tool_input: { query: "old bug" },
    }, instance.dependencies);
    const filtered = await handleClaudeCaptureHook({
      ...base,
      hook_event_name: "PreToolUse",
      tool_name: "mcp__agentmemory__memory_timeline",
      tool_input: { anchor: "old bug" },
    }, instance.dependencies);

    expect(unfiltered).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: "deny",
      },
    });
    expect(filtered).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: "allow",
        updatedInput: {
          anchor: "old bug",
          project: "github.com/acme/service",
        },
      },
    });
  });

  test("injects project scope into explicit saves", async () => {
    const instance = harness();

    const result = await handleClaudeCaptureHook({
      ...base,
      hook_event_name: "PreToolUse",
      tool_name: "mcp__agentmemory__memory_save",
      tool_input: { content: "Historical lesson" },
    }, instance.dependencies);

    expect(result).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: "allow",
        updatedInput: {
          content: "Historical lesson",
          project: "github.com/acme/service",
        },
      },
    });
  });

  test("blocks recall tools when recall is off while leaving save available", async () => {
    const instance = harness({ AGENTMEMORY_RECALL: "off" });

    const blocked = await handleClaudeCaptureHook({
      ...base,
      hook_event_name: "PreToolUse",
      tool_name: "mcp__agentmemory__memory_timeline",
    }, instance.dependencies);
    const save = await handleClaudeCaptureHook({
      ...base,
      hook_event_name: "PreToolUse",
      tool_name: "mcp__agentmemory__memory_save",
    }, instance.dependencies);

    expect(blocked).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
      },
    });
    expect(save).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: "allow",
        updatedInput: { project: "github.com/acme/service" },
      },
    });
  });

  test("keeps capture independent from recall", async () => {
    const instance = harness({ AGENTMEMORY_RECALL: "off" });

    await handleClaudeCaptureHook({
      ...base,
      hook_event_name: "UserPromptSubmit",
      prompt: "Capture this prompt",
    }, instance.dependencies);

    expect(instance.calls).toHaveLength(1);
    expect(body(instance.calls[0]).data.prompt).toBe("Capture this prompt");
  });

  test("honors capture-off policy without contacting the server", async () => {
    const instance = harness({ AGENTMEMORY_CAPTURE: "off" });

    await handleClaudeCaptureHook({ ...base, hook_event_name: "SessionStart" }, instance.dependencies);
    await handleClaudeCaptureHook({
      ...base,
      hook_event_name: "PostToolUse",
      tool_name: "Read",
      tool_response: "content",
    }, instance.dependencies);

    expect(instance.calls).toHaveLength(0);
  });

  test("refuses authenticated capture over remote plaintext HTTP", async () => {
    const instance = harness({
      AGENTMEMORY_SECRET: "example-secret",
      AGENTMEMORY_URL: "http://memory.example.test:3111",
    });

    await handleClaudeCaptureHook({ ...base, hook_event_name: "SessionStart" }, instance.dependencies);

    expect(instance.calls).toHaveLength(0);
  });

  test("captures the final assistant message without ending an active session", async () => {
    const instance = harness();

    await handleClaudeCaptureHook({
      ...base,
      hook_event_name: "Stop",
      last_assistant_message: "The change is complete.",
    }, instance.dependencies);

    expect(instance.calls).toHaveLength(1);
    expect(instance.calls[0].url).toEndWith("/observe");
    expect(body(instance.calls[0]).data).toEqual({
      tool_name: "conversation",
      tool_output: "The change is complete.",
    });
  });

  test("ends an ordinary session", async () => {
    const instance = harness();

    await handleClaudeCaptureHook({ ...base, hook_event_name: "SessionEnd" }, instance.dependencies);

    expect(instance.calls).toHaveLength(1);
    expect(instance.calls[0].url).toEndWith("/session/end");
    expect(body(instance.calls[0])).toEqual({ sessionId: "claude-session-1" });
  });

  test("clears sensitive capture state without sending a session event", async () => {
    const instance = harness();
    instance.disabled.add("claude-session-1");

    await handleClaudeCaptureHook({ ...base, hook_event_name: "SessionEnd" }, instance.dependencies);

    expect(instance.calls).toHaveLength(0);
    expect(instance.disabled.has("claude-session-1")).toBe(false);
  });

  test("reports the same named status as pi", async () => {
    const instance = harness();

    expect(withoutColor(await getClaudeAgentMemoryStatus(
      "/worktrees/service-one",
      "claude-session-1",
      instance.dependencies,
    ))).toBe("🧠 agentmemory · recall explicit · capture full");

    instance.disabled.add("claude-session-1");
    expect(withoutColor(await getClaudeAgentMemoryStatus(
      "/worktrees/service-one",
      "claude-session-1",
      instance.dependencies,
    ))).toBe("🧠 agentmemory · recall explicit · capture off");
  });

  test("is wired without installing upstream hooks or skills", () => {
    const settings = JSON.parse(readFileSync(
      new URL("../../harnesses/claude/settings.json", import.meta.url),
      "utf8",
    ));
    expect(JSON.stringify(settings.enabledPlugins)).not.toContain("agentmemory");
    expect(readFileSync(
      new URL("../../harnesses/claude/statusline.sh", import.meta.url),
      "utf8",
    )).toContain("agentmemory-capture.ts --status");
    for (const event of [
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "PostToolUseFailure",
      "Stop",
      "SessionEnd",
    ]) {
      expect(JSON.stringify(settings.hooks[event])).toContain("agentmemory-capture.ts");
    }
  });
});
