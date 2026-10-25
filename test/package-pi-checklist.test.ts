import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { installedAiFile, installedSdkFile } from "./fixtures/installed-pi-sdk";

function checklist(actions: unknown[], options: Record<string, unknown> = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-checklist-")));
  try {
    const extensions = join(root, "home/.pi/agent/extensions");
    mkdirSync(extensions, { recursive: true });
    writeFileSync(join(root, "scenario.json"), JSON.stringify({ actions, ...options }));
    const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
    const link = manifest.links.find((entry: { destination: string }) => entry.destination === ".pi/agent/extensions/todo.ts");
    if (link) symlinkSync(fileURLToPath(new URL(`../${link.target}`, import.meta.url)), join(extensions, "todo.ts"));
    const sdk = installedSdkFile();
    const run = Bun.spawnSync(["node", fileURLToPath(new URL("./fixtures/pi-checklist.mjs", import.meta.url)),
      sdk, installedAiFile(sdk), root, join(root, "scenario.json")], { cwd: root, timeout: 20_000,
      env: { HOME: join(root, "home"), PATH: process.env.PATH, PI_CODING_AGENT_DIR: join(root, "home/.pi/agent"), PI_OFFLINE: "1" },
      stdout: "pipe", stderr: "pipe" });
    expect(run.exitCode, run.stderr.toString()).toBe(0);
    return JSON.parse(run.stdout.toString());
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("the shipped checklist bundle matches the reviewed source", async () => {
  const build = await Bun.build({ entrypoints: [fileURLToPath(new URL("../harnesses/pi/todo.ts", import.meta.url))],
    target: "node", format: "esm", external: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "typebox"] });
  expect(build.success, JSON.stringify(build.logs)).toBe(true);
  expect(await build.outputs[0].text()).toBe(readFileSync(new URL("../harnesses/pi/todo.bundle.ts", import.meta.url), "utf8"));
});

test("the public schema bounds the list and text without adding owners or dependency graphs", () => {
  for (const input of [
    { action: "write", title: " ", items: [] },
    { action: "write", title: "x".repeat(161), items: [] },
    { action: "write", title: "Goal", items: Array(25).fill({ id: "same", text: "Step", status: "pending" }) },
    { action: "write", title: "Goal", items: [{ id: "a", text: "x".repeat(241), status: "pending" }] },
    { action: "write", title: "Goal", items: [{ id: "a", text: "Step", status: "pending", owner: "someone" }] },
    { action: "delete", id: "a" },
  ]) {
    const result = checklist([input]);
    expect(result.results).toEqual([{ validationError: true }]);
    expect(result.customEntries).toEqual([]);
  }
});

const current = { title: "Add the feature", items: [
  { id: "inspect", text: "Inspect current behavior", status: "completed" },
  { id: "implement", text: "Implement one tested behavior", status: "in_progress" },
  { id: "verify", text: "Run checks and review", status: "pending" },
] };

test("a checklist write saves one complete branch snapshot and read returns it", () => {
  const result = checklist([{ action: "write", ...current }, { action: "read" }]);
  const expected = { version: 1, ...current };
  expect(result.results.map((r: any) => r.structuredContent)).toEqual([
    { status: "ok", checklist: expected }, { status: "ok", checklist: expected },
  ]);
  expect(result.customEntries.map((entry: any) => ({ type: entry.customType, data: entry.data })))
    .toEqual([{ type: "ai-config.session-checklist", data: expected }]);
});

test("invalid checklist invariants reject the whole replacement without changing the prior snapshot", () => {
  for (const items of [
    current.items.map(item => ({ ...item, id: "duplicate" })),
    current.items.map(item => ({ ...item, status: "in_progress" })),
  ]) {
    const result = checklist([{ action: "write", ...current }, { action: "write", title: "Invalid", items }, { action: "read" }]);
    expect(result.results[1].isError).toBe(true);
    expect(result.results[1].structuredContent.status).toBe("error");
    expect(result.results[2].structuredContent.checklist).toEqual({ version: 1, ...current });
    expect(result.customEntries).toHaveLength(1);
  }
});

test("the native checklist panel stays compact and width-safe, then hides when cleared", () => {
  const items = Array.from({ length: 12 }, (_, index) => ({ id: String(index), text: "验证当前行为 and its checks",
    status: index === 0 ? "in_progress" : "pending" }));
  const result = checklist([{ action: "write", title: "Current feature", items },
    { action: "write", title: "Current feature", items: [] }], { width: 24 });
  const visible = result.widgets.filter((widget: any) => widget.rows?.length);
  expect(visible).toHaveLength(1);
  expect(visible[0].factory).toBe(true);
  expect(visible[0].rows.length).toBeLessThanOrEqual(6);
  expect(visible[0].widths.every((width: number) => width <= 24)).toBe(true);
  expect(visible[0].rows.join("\n")).toContain("more");
  expect(result.widgets.at(-1).rows).toBe(null);
});

test("the native /todos command shows the full checklist without changing saved progress", () => {
  const items = Array.from({ length: 12 }, (_, index) => ({ id: String(index), text: `Step ${index}`,
    status: index < 10 ? "completed" : "pending" }));
  const result = checklist([{ action: "write", title: "Full checklist", items }, { command: "todos" }]);
  expect(result.notifications).toHaveLength(1);
  for (const item of items) expect(result.notifications[0].text).toContain(item.text);
  expect(result.customEntries).toHaveLength(1);
});

test("native reload restores both checklist data and the editor panel from the current branch", () => {
  const result = checklist([{ action: "write", ...current }, { reload: true }, { action: "read" }]);
  expect(result.results.at(-1).structuredContent.checklist).toEqual({ version: 1, ...current });
  expect(result.widgets.at(-1)?.rows?.join("\n")).toContain(current.title);
  expect(result.customEntries).toHaveLength(1);
});

test("native tree navigation restores the selected branch, not abandoned progress", () => {
  const result = checklist([{ action: "write", ...current }, { checkpoint: "original" },
    { action: "write", title: "Abandoned branch", items: [] }, { tree: "original" }, { action: "read" }]);
  expect(result.results.at(-1).structuredContent.checklist).toEqual({ version: 1, ...current });
  expect(result.widgets.at(-1).rows.join("\n")).toContain(current.title);
  expect(result.customEntries).toHaveLength(1);
});

test("native compaction preserves checklist snapshots outside summarized model context", () => {
  const result = checklist([{ action: "write", ...current }, { compact: true }, { action: "read" }]);
  expect(result.compactions).toBe(1);
  expect(result.results.at(-1).structuredContent.checklist).toEqual({ version: 1, ...current });
  expect(result.widgets.at(-1).rows.join("\n")).toContain(current.title);
  expect(result.customEntries).toHaveLength(1);
});

test("reopening a persisted native session restores checklist data and its panel", () => {
  const result = checklist([{ action: "write", ...current }, { resume: true }, { action: "read" }], { persistent: true });
  expect(result.results.at(-1).structuredContent.checklist).toEqual({ version: 1, ...current });
  expect(result.widgets.at(-1).rows.join("\n")).toContain(current.title);
  expect(result.customEntries).toHaveLength(1);
});

test("an aborted replacement leaves the saved checklist and panel unchanged", () => {
  const result = checklist([{ action: "write", ...current },
    { aborted: true, call: { action: "write", title: "Do not save", items: [] } }, { action: "read" }]);
  expect(result.results[1].structuredContent.status).toBe("cancelled");
  expect(result.results[2].structuredContent.checklist).toEqual({ version: 1, ...current });
  expect(result.customEntries).toHaveLength(1);
  expect(result.widgets.at(-1).rows.join("\n")).toContain(current.title);
});

test("RPC receives plain widget lines and headless sessions still read and write progress", () => {
  for (const options of [{ mode: "rpc" }, { mode: "print", headless: true }]) {
    const result = checklist([{ action: "write", ...current }, { action: "read" }], options);
    expect(result.results.at(-1).structuredContent.checklist).toEqual({ version: 1, ...current });
    expect(result.widgets.every((widget: any) => !widget.factory)).toBe(true);
    if (options.headless) expect(result.widgets).toEqual([]);
    else expect(result.widgets.at(-1).rows.join("\n")).toContain(current.title);
  }
});

test("the active step stays visible when it appears after more pending rows than fit", () => {
  const items = Array.from({ length: 12 }, (_, index) => ({ id: String(index), text: index === 11 ? "Active step" : `Pending ${index}`,
    status: index === 11 ? "in_progress" : "pending" }));
  const result = checklist([{ action: "write", title: "Current feature", items }]);
  expect(result.widgets.at(-1).rows.join("\n")).toContain("Active step");
});

test("incomplete writes and write fields on read are rejected without changing state", () => {
  for (const input of [{ action: "write", title: "Missing items" }, { action: "read", title: "Ignored?", items: [] }]) {
    const result = checklist([{ action: "write", ...current }, input, { action: "read" }]);
    expect(result.results[1].isError).toBe(true);
    expect(result.results.at(-1).structuredContent.checklist).toEqual({ version: 1, ...current });
    expect(result.customEntries).toHaveLength(1);
  }
});

test("terminal controls and every Unicode bidi-control character cannot reach panel or result text", () => {
  const bidi = "\u061c\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069";
  const title = `Goal\u001b]52;c;QQ==\u0007${bidi}`;
  const items = [{ id: "safe", text: `Step\u001b[31m\u009b31m${bidi}`, status: "pending" }];
  const result = checklist([{ action: "write", title, items }, { command: "todos" }]);
  const unsafe = /[\u001b\u0007\u009b\p{Bidi_Control}]/u;
  expect(result.widgets.at(-1).rows.join(" ")).not.toMatch(unsafe);
  expect(result.notifications.at(-1).text).not.toMatch(unsafe);
  expect(result.results[0].content[0].text).not.toMatch(unsafe);
  expect(JSON.parse(result.results[0].content[0].text)).toEqual(result.results[0].structuredContent);
});

test("corrupt latest state is reported instead of replaying older progress, and explicit replacement recovers", () => {
  const result = checklist([{ action: "write", ...current },
    { custom: { type: "ai-config.session-checklist", data: { version: 99, title: "Wrong format", items: [] } } },
    { reload: true }, { action: "read" }, { action: "write", ...current }, { action: "read" }]);
  expect(result.results[1].isError).toBe(true);
  expect(result.results[1].structuredContent.status).toBe("error");
  expect(result.results.at(-1).structuredContent.checklist).toEqual({ version: 1, ...current });
  expect(result.errors).toEqual([]);
});

test("unrelated todo state is not adopted and a failing widget cannot turn a saved update into an error", () => {
  const result = checklist([{ custom: { type: "rpiv-todo-state", data: { tasks: ["Do not import"] } } },
    { action: "read" }, { action: "write", ...current }, { action: "read" }], { failWidget: true });
  expect(result.results[0].structuredContent.checklist.items).toEqual([]);
  expect(result.results[1].structuredContent.status).toBe("ok");
  expect(result.results[2].structuredContent.checklist).toEqual({ version: 1, ...current });
  expect(JSON.stringify(result)).not.toContain("PRIVATE_WIDGET_ERROR");
});

test("native tool-call captions do not render unvalidated model text", () => {
  const result = checklist([{ action: "write", title: "Unsafe\u001b]52;c;QQ==\u0007\u202e", items: [] }], { inspectCall: true });
  expect(result.captions.flat().join(" ")).not.toMatch(/[\u001b\u0007\u202e]/u);
});

test("a rejected native append does not report success or expose its private exception", () => {
  const result = checklist([{ action: "write", ...current }, { failAppend: true },
    { action: "write", title: "Not saved", items: [] }, { restoreAppend: true }, { action: "read" }]);
  expect(result.results[1].isError).toBe(true);
  expect(result.results[2].structuredContent.checklist).toEqual({ version: 1, ...current });
  expect(result.customEntries).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain("PRIVATE_APPEND_FAILURE");
});

test("notification failures cannot diagnose healthy progress as corrupt or leak private UI errors", () => {
  for (const failNotify of ["once", "always"]) {
    const result = checklist([{ action: "write", ...current }, { command: "todos" }, { action: "read" }], { failNotify });
    expect(result.notifications.map((notice: any) => notice.level)).toEqual(["info"]);
    expect(result.errors).toEqual([]);
    expect(result.results.at(-1).structuredContent.checklist).toEqual({ version: 1, ...current });
    expect(result.customEntries).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_NOTIFY_FAILURE");
  }
});

test("invalid-state notifications are also contained when the UI binding always throws", () => {
  const result = checklist([{ action: "write", ...current },
    { custom: { type: "ai-config.session-checklist", data: { version: 99 } } },
    { command: "todos" }, { action: "read" }], { failNotify: "always" });
  expect(result.notifications).toHaveLength(1);
  expect(result.notifications[0].level).toBe("error");
  expect(result.notifications[0].text).toContain("invalid. Replace it explicitly");
  expect(result.errors).toEqual([]);
  expect(result.customEntries).toHaveLength(2);
  expect(result.results.at(-1).isError).toBe(true);
  expect(JSON.stringify(result)).not.toContain("PRIVATE_NOTIFY_FAILURE");
});

test("an operational read failure recommends retrying, not replacing healthy saved progress", () => {
  const result = checklist([{ action: "write", ...current }, { failRead: true },
    { command: "todos" }, { restoreRead: true }, { action: "read" }]);
  expect(result.notifications).toHaveLength(1);
  expect(result.notifications[0].text).toContain("Try reading it again");
  expect(result.notifications[0].text).not.toContain("Replace");
  expect(result.results.at(-1).structuredContent.checklist).toEqual({ version: 1, ...current });
  expect(result.errors).toEqual([]);
  expect(result.customEntries).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain("PRIVATE_READ_FAILURE");
});

test("a deferred repaint failure stays inside the widget and does not change saved progress", () => {
  const result = checklist([{ action: "write", ...current }, { render: true, failTheme: true },
    { action: "read" }, { render: true }], { deferRender: true });
  expect(result.results[0].structuredContent.status).toBe("ok");
  expect(result.renderErrors).toEqual([]);
  expect(result.deferredRenders[0]).toEqual([]);
  expect(result.results[1].structuredContent.checklist).toEqual({ version: 1, ...current });
  expect(result.deferredRenders[1].join("\n")).toContain(current.title);
  expect(result.customEntries).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain("PRIVATE_DEFERRED_RENDER_FAILURE");
});

test("the installed checklist tool reads an empty current branch without writing session state", () => {
  const result = checklist([{ action: "read" }]);
  expect(result.found).toBe(true);
  expect(result.exposure).toBe("model-only");
  expect(result.executionMode).toBe("sequential");
  expect(result.results[0].structuredContent).toEqual({ status: "ok", checklist: { version: 1, title: "Current task", items: [] } });
  expect(result.customEntries).toEqual([]);
  expect(result.errors).toEqual([]);
});
