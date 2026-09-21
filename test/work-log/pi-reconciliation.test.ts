import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { registerWorkLogReconciliation } from "../../harnesses/pi/extensions/work-log-reconcile.ts";

describe("pi Work log reconciliation", () => {
  test("installs the bundled reconciliation extension", () => {
    const manifest = readFileSync(
      new URL("../../harnesses/pi/manifest.sh", import.meta.url),
      "utf8",
    );

    expect(manifest).toContain("work-log-reconcile.bundle.ts");
  });

  test("queues one follow-up after a successful edit", async () => {
    const handlers = new Map<string, (...args: any[]) => any>();
    const messages: any[] = [];
    let observed = false;
    const pi = {
      on: (event: string, handler: (...args: any[]) => any) => handlers.set(event, handler),
      sendMessage: (message: any, options: any) => messages.push({ message, options }),
    };
    registerWorkLogReconciliation(pi as any, {
      digest: async () => "Work log for github.com/example/project:\nOther planned work: 2\n",
      observe: async () => {
        observed = true;
      },
      reconcile: async () => observed ? "Record a Work log checkpoint before finishing." : undefined,
    });

    await handlers.get("session_start")?.({}, {});
    await handlers.get("tool_result")?.({ toolName: "edit", isError: false, input: {} }, {});
    await handlers.get("agent_settled")?.({}, {});

    expect(messages).toEqual([
      {
        message: {
          customType: "work-log-digest",
          content: "Work log for github.com/example/project:\nOther planned work: 2\n",
          display: true,
        },
        options: { deliverAs: "nextTurn" },
      },
      {
        message: {
          customType: "work-log-reconciliation",
          content: "Record a Work log checkpoint before finishing.",
          display: true,
        },
        options: { deliverAs: "followUp", triggerTurn: true },
      },
    ]);
  });
});
