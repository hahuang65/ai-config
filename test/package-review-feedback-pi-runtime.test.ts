import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installedAiFile, installedSdkFile } from "./fixtures/installed-pi-sdk";

test.each(["successful", "failed"])("the native Pi adapter attaches receipts from %s shell calls and answers idle and busy feedback", async (shellOutcome) => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "review-feedback-adapter-")));
  const cwd = join(home, "project");
  mkdirSync(cwd);
  const sdkFile = installedSdkFile();
  const run = Bun.spawn(["node", resolve("test/fixtures/review-feedback-runtime.mjs"), sdkFile, installedAiFile(sdkFile), cwd,
    resolve("harnesses/pi/review-feedback.bundle.ts"), resolve("tools/artifact-review/target/release/review-artifact"), shellOutcome], {
    cwd, env: { PATH: process.env.PATH, HOME: home, PI_CODING_AGENT_DIR: join(home, ".pi/agent"),
      AR_ROOT: join(home, "reviews"), PI_OFFLINE: "1", TERM: "dumb", LANG: "en_US.UTF-8" }, stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => run.kill("SIGKILL"), 30_000);
  try {
    const [output, errors, status] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
    expect(status, errors).toBe(0);
    expect(JSON.parse(output)).toEqual({ attached: true, idleAnswered: true, busyQueued: true, replies: 2 });
  } finally {
    clearTimeout(timer);
    run.kill("SIGTERM");
    await run.exited;
    rmSync(home, { recursive: true, force: true });
  }
}, 35_000);

test("native Pi resume invalidates an orphaned claim before restoring saved feedback", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "review-feedback-recovery-")));
  const cwd = join(home, "project"); mkdirSync(cwd);
  const sdkFile = installedSdkFile();
  const run = Bun.spawn(["node", resolve("test/fixtures/review-feedback-recovery.mjs"), sdkFile, installedAiFile(sdkFile), cwd,
    resolve("harnesses/pi/review-feedback.bundle.ts"), resolve("tools/artifact-review/target/release/review-artifact")], {
    cwd, env: { PATH: process.env.PATH, HOME: home, PI_CODING_AGENT_DIR: join(home, ".pi/agent"),
      AR_ROOT: join(home, "reviews"), PI_OFFLINE: "1", TERM: "dumb", LANG: "en_US.UTF-8" }, stdout: "pipe", stderr: "pipe",
  });
  const guard = setTimeout(() => run.kill("SIGKILL"), 30_000);
  try {
    const [output, errors, status] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
    expect(status, errors).toBe(0);
    expect(JSON.parse(output)).toEqual({ recovered: true, staleRejected: true });
  } finally { clearTimeout(guard); run.kill("SIGTERM"); await run.exited; rmSync(home, { recursive: true, force: true }); }
}, 35_000);

test("native Pi feedback wakes an idle session and follows busy work without concurrent responses", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "review-feedback-pi-")));
  const cwd = join(home, "project");
  mkdirSync(cwd);
  const sdkFile = installedSdkFile();
  const run = Bun.spawn(["node", resolve("test/fixtures/review-feedback-pi.mjs"), sdkFile, installedAiFile(sdkFile), cwd], {
    cwd, env: { PATH: process.env.PATH, HOME: home, PI_CODING_AGENT_DIR: join(home, ".pi/agent"),
      PI_OFFLINE: "1", TERM: "dumb", LANG: "en_US.UTF-8" }, stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => run.kill("SIGKILL"), 25_000);
  try {
    const [output, errors, status] = await Promise.all([
      new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited,
    ]);
    expect(status, errors).toBe(0);
    expect(JSON.parse(output)).toEqual({ idleWake: true, busyQueued: true, sequentialResponses: true });
  } finally {
    clearTimeout(timer);
    run.kill("SIGTERM");
    await run.exited;
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);
