import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installedAiFile, installedSdkFile } from "./fixtures/installed-pi-sdk";

function worklog(scenario = "busy") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-worklog-")));
  try {
    const extensions = join(root, "home/.pi/agent/extensions");
    const source = join(root, "source/harnesses/pi");
    const binary = join(root, "source/tools/worklog/target/release");
    for (const path of [extensions, source, binary]) mkdirSync(path, { recursive: true });
    copyFileSync(resolve("tools/worklog/target/release/wl"), join(binary, "wl"));
    const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
    const link = manifest.links.find((entry: { destination: string }) => entry.destination === ".pi/agent/extensions/worklog.ts");
    if (link) {
      copyFileSync(resolve(link.target), join(source, "worklog.bundle.ts"));
      symlinkSync(join(source, "worklog.bundle.ts"), join(extensions, "worklog.ts"));
    }
    const sdk = installedSdkFile();
    const run = Bun.spawnSync(["node", resolve("test/fixtures/pi-worklog.mjs"), sdk, installedAiFile(sdk), root, scenario], {
      cwd: root, timeout: 20_000, env: { HOME: join(root, "home"), PATH: process.env.PATH,
        PI_CODING_AGENT_DIR: join(root, "home/.pi/agent"), WL_ROOT: join(root, "worklog"), PI_OFFLINE: "1" },
      stdout: "pipe", stderr: "pipe",
    });
    expect(run.exitCode, run.stderr.toString()).toBe(0);
    return JSON.parse(run.stdout.toString());
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("the shipped Worklog bundle matches its source", async () => {
  const build = await Bun.build({ entrypoints: [resolve("harnesses/pi/worklog.ts")], target: "node", format: "esm",
    external: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"] });
  expect(build.success, JSON.stringify(build.logs)).toBe(true);
  expect(await build.outputs[0].text()).toBe(readFileSync("harnesses/pi/worklog.bundle.ts", "utf8"));
});

test("Worklog capture failures and invalid titles do not create reminders or expose private errors", () => {
  expect(worklog("failures")).toEqual({ rejected: 4, requests: 0 });
}, 25_000);

test("empty Worklog queries and headless commands leave storage and conversation untouched", () => {
  expect(worklog("empty")).toEqual({ empty: true, requests: 0 });
  expect(worklog("headless")).toEqual({ headlessRejected: true, requests: 0 });
}, 25_000);

for (const scenario of ["rpc", "notify-failure"]) {
  test(`Worklog capture remains out-of-band with ${scenario}`, () => {
    expect(worklog(scenario)).toEqual({ captured: true, requests: 1, starts: 1, completions: 1, settled: 1 });
  }, 25_000);
}

test("empty /worklog lists incomplete tasks across projects without a model turn or per-task commentary", () => {
  expect(worklog("list")).toEqual({ listed: true, requests: 0 });
}, 25_000);

test("/worklog routes an existing-task request after current work instead of capturing another reminder", () => {
  expect(worklog("operation")).toEqual({ routed: true, classifications: 1, requests: 2 });
}, 25_000);

test("uncertain, low-confidence, malformed, failed, and unavailable classifications never capture a reminder", () => {
  for (const scenario of ["uncertain", "low-confidence", "malformed", "classifier-error", "classifier-missing"]) {
    expect(worklog(scenario)).toEqual({ routed: true, classifications: scenario === "classifier-missing" ? 0 : 1, requests: 2 });
  }
}, 25_000);

test("idle Worklog operations start a normal skill request instead of writing directly", () => {
  expect(worklog("idle-operation")).toEqual({ routed: true, classifications: 1, requests: 1 });
}, 25_000);

test("a classifier deadline delegates safely even when a late result says reminder", () => {
  expect(worklog("classifier-timeout")).toEqual({ routed: true, classifications: 1, requests: 2 });
}, 25_000);

test("reloading during classification cancels the old command without a write or model turn", () => {
  expect(worklog("reload")).toEqual({ cancelled: true, requests: 0 });
}, 25_000);

test("installed /worklog captures a reminder during a native busy run without steering or another completion", () => {
  expect(worklog()).toEqual({ captured: true, requests: 1, starts: 1, completions: 1, settled: 1 });
}, 25_000);
