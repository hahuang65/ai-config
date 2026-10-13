import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import footer from "../harnesses/pi/status-footer.bundle.ts";
import { buildStatusFooter } from "../tools/build-status-footer.mjs";

test("Pi footer bundle matches the reviewed source and installed Pi width helpers", async () => {
  const bundle = fileURLToPath(new URL("../harnesses/pi/status-footer.bundle.ts", import.meta.url));
  expect(await buildStatusFooter()).toBe(readFileSync(bundle, "utf8"));
});

test("Pi keeps its two-row location and usage footer without agentmemory", () => {
  let start: ((event: unknown, context: unknown) => void) | undefined;
  let makeFooter: ((tui: unknown, theme: unknown, data: unknown) => { render(width: number): string[] }) | undefined;
  footer({ on: (event: string, listener: typeof start) => {
    if (event === "session_start") start = listener;
  } } as never);
  const home = process.env.HOME!;
  start?.({}, {
    mode: "tui", cwd: `${home}/project`, model: { id: "fixture-model", provider: "fixture", reasoning: true },
    thinkingLevel: "high", getContextUsage: () => ({ percent: 12.5, contextWindow: 128_000 }),
    sessionManager: { getCwd: () => `${home}/project`, getSessionName: () => "Task",
      getBranch: () => [{ type: "message", message: { role: "assistant", usage: {
        input: 1_500, output: 300, cacheRead: 800, cacheWrite: 100, cost: { total: 0.25 },
      } } }],
    },
    ui: { setFooter: (value: typeof makeFooter) => { makeFooter = value; } },
  });
  const component = makeFooter!({ requestRender() {} }, { fg: (_color: string, value: string) => value }, {
    getGitBranch: () => "topic", onBranchChange: () => () => {},
  });
  const rows = component.render(120);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toContain("~/project (topic) • Task");
  expect(rows[1]).toContain("↑1.5k ↓300 📚800 💾100 🎯33.3% $0.250 12.5%/128k (auto)");
  expect(rows[1]).toContain("fixture-model • high");
  expect(rows.join(" ")).not.toContain("agentmemory");
});
