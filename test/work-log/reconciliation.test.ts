import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { handleClaudeWorkLogHook } from "../../harnesses/claude/hooks/work-log-reconcile.ts";

function harness() {
  let pending = false;
  let reminded = false;
  return {
    dependencies: {
      digest: () => "Work log for github.com/example/project:\nOther planned work: 2\n",
      observe: () => {
        pending = true;
        reminded = false;
      },
      reconcile: () => {
        if (!pending || reminded) return undefined;
        reminded = true;
        return "Record a Work log checkpoint before finishing.";
      },
    },
  };
}

describe("Claude Work log reconciliation", () => {
  test("wires the reconciliation hook to successful tools and Stop", () => {
    const settings = JSON.parse(readFileSync(
      new URL("../../harnesses/claude/settings.json", import.meta.url),
      "utf8",
    ));

    expect(JSON.stringify(settings.hooks.SessionStart)).toContain("work-log-reconcile.ts");
    expect(JSON.stringify(settings.hooks.PostToolUse)).toContain("work-log-reconcile.ts");
    expect(JSON.stringify(settings.hooks.Stop)).toContain("work-log-reconcile.ts");
  });

  test("injects a compact repository digest when a session starts", async () => {
    const instance = harness();

    const response = await handleClaudeWorkLogHook({
      session_id: "claude-session-1",
      cwd: "/work/repository",
      hook_event_name: "SessionStart",
    }, instance.dependencies);

    expect(response).toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "Work log for github.com/example/project:\nOther planned work: 2\n",
      },
    });
  });

  test("requests one reconciliation after a successful file mutation", async () => {
    const instance = harness();
    const base = {
      session_id: "claude-session-1",
      cwd: "/work/repository",
    };

    await handleClaudeWorkLogHook({
      ...base,
      hook_event_name: "PostToolUse",
      tool_name: "Write",
    }, instance.dependencies);
    const firstStop = await handleClaudeWorkLogHook({
      ...base,
      hook_event_name: "Stop",
    }, instance.dependencies);
    const secondStop = await handleClaudeWorkLogHook({
      ...base,
      hook_event_name: "Stop",
    }, instance.dependencies);

    expect(firstStop).toEqual({
      decision: "block",
      reason: "Record a Work log checkpoint before finishing.",
    });
    expect(secondStop).toBeUndefined();
  });
});
