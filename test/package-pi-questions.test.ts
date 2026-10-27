import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { installedSdkFile } from "./fixtures/installed-pi-sdk";

const question = { question: "Which storage approach?", options: [
  { label: "SQLite", description: "Simple local storage; one writer." },
  { label: "Postgres", description: "Shared writes; requires a service." },
] };

function ask(scenario: Record<string, unknown> = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-questions-")));
  try {
    const extensions = join(root, "home/.pi/agent/extensions");
    mkdirSync(extensions, { recursive: true });
    writeFileSync(join(root, "scenario.json"), JSON.stringify({ input: question, ...scenario }));
    const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
    const link = manifest.links.find((entry: { destination: string }) => entry.destination === ".pi/agent/extensions/ask-user-question.ts");
    if (link) symlinkSync(fileURLToPath(new URL(`../${link.target}`, import.meta.url)), join(extensions, "ask-user-question.ts"));
    const run = Bun.spawnSync(["node", fileURLToPath(new URL("./fixtures/pi-questions.mjs", import.meta.url)),
      installedSdkFile(), root, join(root, "scenario.json")], { cwd: root, timeout: 15_000,
      env: { HOME: join(root, "home"), PATH: process.env.PATH, PI_CODING_AGENT_DIR: join(root, "home/.pi/agent"), PI_OFFLINE: "1" },
      stdout: "pipe", stderr: "pipe" });
    expect(run.exitCode, run.stderr.toString()).toBe(0);
    return JSON.parse(run.stdout.toString());
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("the shipped Pi question bundle matches its reviewed source", async () => {
  const build = await Bun.build({ entrypoints: [fileURLToPath(new URL("../harnesses/pi/ask-user-question.ts", import.meta.url))],
    target: "node", format: "esm", external: ["@earendil-works/pi-coding-agent", "typebox"] });
  expect(build.success, JSON.stringify(build.logs)).toBe(true);
  expect(await build.outputs[0].text()).toBe(readFileSync(new URL("../harnesses/pi/ask-user-question.bundle.ts", import.meta.url), "utf8"));
});

test("the public schema bounds questions and choices without accepting questionnaire features", () => {
  for (const input of [
    { ...question, question: " " }, { ...question, question: "x".repeat(2001) },
    { ...question, options: [question.options[0]] }, { ...question, options: Array(5).fill(question.options[0]) },
    { ...question, options: [{ label: "Missing trade-off" }, question.options[1]] },
    { ...question, multiSelect: true }, { ...question, notes: "Unrequested feature" },
  ]) {
    const result = ask({ input });
    expect(result.result).toEqual({ validationError: true });
    expect(result.dialogs).toEqual([]);
  }
});

test("the installed Pi question tool shows trade-offs and returns a model-only single choice", () => {
  const result = ask();
  expect(result.found).toBe(true);
  expect(result.exposure).toBe("model-only");
  expect(result.executionMode).toBe("sequential");
  expect(result.dialogs).toHaveLength(1);
  expect(result.dialogs[0].method).toBe("select");
  expect(result.dialogs[0].title).toContain(question.question);
  for (const option of question.options) expect(result.dialogs[0].title).toContain(option.description);
  expect(result.result.structuredContent).toEqual({ status: "answered", question: question.question,
    answer: { kind: "choice", index: 0, label: "SQLite" } });
  expect(JSON.parse(result.result.content[0].text)).toEqual(result.result.structuredContent);
});

test("a terminal question reports pending before its dialog and clears it before returning", () => {
  const result = ask();
  expect(result.statusEvents).toEqual([
    { type: "blocked", active: true, label: "Waiting for your answer" },
    { type: "dialog", method: "select" },
    { type: "blocked", active: false },
  ]);
  expect(result.result.structuredContent.status).toBe("answered");
});

test("dismissing either native dialog returns cancelled without an answer", () => {
  for (const scenario of [{ choice: -1 }, { choice: 2 }]) {
    const result = ask(scenario);
    expect(result.result.structuredContent).toEqual({ status: "cancelled", question: question.question, reason: "dismissed" });
    expect(result.statusEvents.filter((event: { type: string }) => event.type === "blocked")).toEqual([
      { type: "blocked", active: true, label: "Waiting for your answer" }, { type: "blocked", active: false },
    ]);
  }
});

test("headless Pi withdraws the question tool and reports unavailable without opening UI", () => {
  const result = ask({ mode: "print", hasUI: false });
  expect(result.exposure).toBe("hidden");
  expect(result.dialogs).toEqual([]);
  expect(result.statusEvents).toEqual([]);
  expect(result.result.structuredContent).toEqual({ status: "unavailable", question: question.question, reason: "no_ui" });
});

test("abort before or during a native dialog never accepts a late answer", () => {
  for (const scenario of [{ abort: "before" }, { abort: "select" }, { abort: "input", choice: 2, text: "Late answer" }]) {
    const result = ask(scenario);
    expect(result.result.structuredContent).toEqual({ status: "cancelled", question: question.question, reason: "aborted" });
    expect(result.statusEvents.filter((event: { type: string }) => event.type === "blocked")).toEqual(
      scenario.abort === "before" ? [] : [
        { type: "blocked", active: true, label: "Waiting for your answer" }, { type: "blocked", active: false },
      ]);
    if (scenario.abort === "before") expect(result.dialogs).toEqual([]);
  }
});

test("a failing UI returns unavailable without leaking private exception details", () => {
  for (const scenario of [{ failure: "select" }, { failure: "input", choice: 2 }]) {
    const result = ask(scenario);
    expect(result.result.structuredContent).toEqual({ status: "unavailable", question: question.question, reason: "ui_error" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_UI_FAILURE");
    expect(result.statusEvents.at(-1)).toEqual({ type: "blocked", active: false });
  }
});

test("an open question needs no artificial choices and uses native text input", () => {
  const result = ask({ input: { question: "What should this be called?" }, text: "Workspace" });
  expect(result.dialogs.map((dialog: { method: string }) => dialog.method)).toEqual(["input"]);
  expect(result.statusEvents).toEqual([
    { type: "blocked", active: true, label: "Waiting for your answer" },
    { type: "dialog", method: "input" },
    { type: "blocked", active: false },
  ]);
  expect(result.result.structuredContent).toEqual({ status: "answered", question: "What should this be called?",
    answer: { kind: "text", text: "Workspace" } });
});

test("empty custom text is cancellation, not a fabricated answer or a retry", () => {
  for (const text of ["", "  \t\n"]) {
    const result = ask({ choice: 2, text });
    expect(result.result.structuredContent).toEqual({ status: "cancelled", question: question.question, reason: "empty" });
    expect(result.dialogs).toHaveLength(2);
  }
});

test("unrecognized UI responses never select an option or enter the model as an answer", () => {
  for (const selection of ["Unlisted answer", 42]) {
    const result = ask({ mode: "rpc", selection });
    expect(result.result.structuredContent).toEqual({ status: "unavailable", question: question.question, reason: "invalid_response" });
  }
});

test("oversized or non-text custom answers return a bounded unavailable result", () => {
  for (const text of ["x".repeat(4001), 42]) {
    const result = ask({ choice: 2, text });
    expect(result.result.structuredContent).toEqual({ status: "unavailable", question: question.question, reason: "invalid_response" });
    expect(JSON.stringify(result.result).length).toBeLessThan(1000);
  }
});

test("model-provided terminal controls cannot reach the native dialog", () => {
  const input = { question: "Pick \u001b[31mstorage\u009b31m", options: [
    { label: "\u001b]52;c;QQ==\u0007SQLite", description: "Local\u009b31m only" }, question.options[1],
  ] };
  const result = ask({ input });
  const dialog = result.dialogs[0];
  expect(dialog.title + dialog.options.join(" ")).not.toMatch(/[\u001b\u0007\u009b]/);
  expect(result.result.content[0].text).not.toMatch(/[\u001b\u0007\u009b]/);
  expect(JSON.parse(result.result.content[0].text)).toEqual(result.result.structuredContent);
  expect(result.result.structuredContent.status).toBe("answered");
});

test("pending status spans choice and custom input without an intermediate clear", () => {
  const result = ask({ choice: 2, text: "A plain file" });
  expect(result.statusEvents).toEqual([
    { type: "blocked", active: true, label: "Waiting for your answer" },
    { type: "dialog", method: "select" },
    { type: "dialog", method: "input" },
    { type: "blocked", active: false },
  ]);
});

test("terminal questions still work when the independent Herdr observer is absent", () => {
  const result = ask({ observer: false });
  expect(result.result.structuredContent.status).toBe("answered");
  expect(result.statusEvents).toEqual([{ type: "dialog", method: "select" }]);
});

test("Pi RPC supports a custom answer through native select and input dialogs", () => {
  const result = ask({ mode: "rpc", choice: 2, text: "Use a plain file for the prototype." });
  expect(result.dialogs.map((dialog: { method: string }) => dialog.method)).toEqual(["select", "input"]);
  expect(result.dialogs.every((dialog: { hasSignal: boolean }) => dialog.hasSignal)).toBe(true);
  expect(result.statusEvents).toEqual([{ type: "dialog", method: "select" }, { type: "dialog", method: "input" }]);
  expect(result.result.structuredContent).toEqual({ status: "answered", question: question.question,
    answer: { kind: "text", text: "Use a plain file for the prototype." } });
});
