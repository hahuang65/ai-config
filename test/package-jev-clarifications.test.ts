import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { installedSdkFile } from "./fixtures/installed-pi-sdk";

function scenario(actions: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "jev-clarifications-")));
  try {
    const extensions = join(root, "home/.pi/agent/extensions");
    mkdirSync(extensions, { recursive: true });
    const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
    for (const name of ["guard-policies", "ask-user-question"]) {
      const link = manifest.links.find((entry: any) => entry.destination === `.pi/agent/extensions/${name}.ts`);
      symlinkSync(fileURLToPath(new URL(`../${link.target}`, import.meta.url)), join(extensions, `${name}.ts`));
    }
    const input = join(root, "scenario.json");
    writeFileSync(input, JSON.stringify({ actions, ...extra }));
    const run = Bun.spawnSync(["node", fileURLToPath(new URL("./fixtures/jev-clarifications.mjs", import.meta.url)), installedSdkFile(), root, input], {
      cwd: root, timeout: 15000, env: { HOME: join(root, "home"), PATH: process.env.PATH,
        PI_CODING_AGENT_DIR: join(root, "home/.pi/agent"), PI_OFFLINE: "1", AI_JEV_SCOPE: extra.disabled ? "0" : "1" }, stdout: "pipe", stderr: "pipe",
    });
    expect(run.exitCode, run.stderr.toString()).toBe(0);
    return JSON.parse(run.stdout.toString());
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("native clarification resolves a scope objection on retry without becoming action authorization", () => {
  const result = scenario([{ check: true }, { text: "Edit source.ts only." }, { check: true }, { hardDeny: true }]);
  expect(result.verdicts[0]?.block).toBe(true);
  expect(result.answers[0].structuredContent.status).toBe("answered");
  expect(result.verdicts[1]).toBeNull();
  expect(result.verdicts[2]?.block).toBe(true);
  expect(result.calls).toHaveLength(2);
  expect(result.calls[1].state.user_requests).toEqual(["Diagnose source.ts without changing files."]);
  expect(result.calls[1].state.clarifications[0]).toMatchObject({ question: "Should I inspect or edit source.ts?", answer: "Edit source.ts only.", after_request: 0 });
});

test("a narrowing native answer invalidates a prior low-drift cache entry", () => {
  const result = scenario([{ check: true }, { check: true }, { text: "Only inspect." }, { check: true }], { initialLow: true });
  expect(result.verdicts.slice(0, 2)).toEqual([null, null]);
  expect(result.verdicts[2]?.block).toBe(true);
  expect(result.calls).toHaveLength(2);
  expect(result.calls[1].state.clarifications[0].answer).toBe("Only inspect.");
});

test("native answer records survive session reopen and remain current-branch evidence", () => {
  const result = scenario([{ check: true }, { text: "Edit source.ts only." }, { resume: true }, { check: true }, { branch: true }, { check: true }]);
  expect(result.verdicts[0]?.block).toBe(true);
  expect(result.verdicts[1]).toBeNull();
  expect(result.verdicts[2]?.block).toBe(true);
  expect(result.calls).toHaveLength(3);
  expect(result.calls[2].state).not.toHaveProperty("clarifications");
});

test.each(["toolResult", "assistant"])("%s text or details cannot impersonate a native answer", role => {
  const result = scenario([{ check: true }, { forge: role }, { forgeCustomMessage: true }, { check: true }]);
  expect(result.verdicts.every((value: any) => value?.block)).toBe(true);
  expect(result.calls).toHaveLength(1);
  expect(result.calls[0].state).not.toHaveProperty("clarifications");
});

test.each([{ text: undefined }, { text: "Late answer", abort: true }, { fail: true }])("unsuccessful native UI %# never changes scope", answer => {
  const result = scenario([{ check: true }, answer, { check: true }]);
  expect(result.answers[0].structuredContent.status).not.toBe("answered");
  expect(result.receipts).toEqual([]);
  expect(result.verdicts.every((value: any) => value?.block)).toBe(true);
  expect(result.calls).toHaveLength(1);
});

test("native choices retain their displayed trade-off and their order relative to later user messages", () => {
  const input = { question: "Which scope?", options: [
    { label: "Edit source.ts only.", description: "Make the requested source change; no commit." },
    { label: "Only inspect.", description: "Leave source unchanged." },
  ] };
  const result = scenario([{ input, choice: 0 }, { check: true }, { user: "Only inspect from now on." }, { text: "Only inspect." }, { check: true }]);
  expect(result.verdicts[0]).toBeNull();
  expect(result.verdicts[1]?.block).toBe(true);
  expect(result.calls[1].state.clarifications).toEqual([
    { question: input.question, answer: input.options[0].label, choice_description: input.options[0].description, after_request: 0 },
    { question: "Should I inspect or edit source.ts?", answer: "Only inspect.", after_request: 1 },
  ]);
});

test("orphaned native records cannot reuse a cached low-drift judgment", () => {
  const result = scenario([{ check: true }, { text: "Only inspect." }, { branch: true }, { check: true }, { restoreReceipt: true }, { check: true }], { initialLow: true });
  expect(result.verdicts.slice(0, 2)).toEqual([null, null]);
  expect(result.verdicts[2]?.block).toBe(true);
  expect(result.calls).toHaveLength(1);
});

test("clarification capture is default-off alongside semantic scope checking", () => {
  const result = scenario([{ text: "Edit source.ts only." }, { check: true }], { disabled: true });
  expect(result.answers[0].structuredContent.status).toBe("answered");
  expect(result.receipts).toEqual([]);
  expect(result.calls).toEqual([]);
});

test("only the last eight native answers enter the bounded classifier state", () => {
  const result = scenario([...Array.from({ length: 10 }, () => ({ text: "Edit source.ts only." })), { check: true }]);
  expect(result.verdicts[0]).toBeNull();
  expect(result.calls[0].state.clarifications).toHaveLength(8);
});

test("native answers count against the existing scope input budget", () => {
  const result = scenario([{ check: true }, { text: "x".repeat(4000) }, { check: true }], { initial: "Inspect " + "x".repeat(9000) });
  expect(result.verdicts[1]?.block).toBe(true);
  expect(result.calls).toHaveLength(1);
});

test("malformed host records require clarification instead of silently restoring a cached low score", () => {
  const result = scenario([{ check: true }, { custom: { type: "ai-config.native-scope-clarification", data: { version: 9000 } } }, { check: true }], { initialLow: true });
  expect(result.verdicts[0]).toBeNull();
  expect(result.verdicts[1]?.block).toBe(true);
  expect(result.calls).toHaveLength(1);
});
