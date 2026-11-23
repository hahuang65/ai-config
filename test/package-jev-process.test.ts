import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runJevBridge } from "../harnesses/jev-process";
import { condition, JEV_MODEL } from "../harnesses/jev-client";

const request = { state: { task: "Synthetic evidence" }, questions: { drift: condition("Does this action exceed scope?") } };
const answer = { status: "ok", model: JEV_MODEL, probabilities: { drift: 0.01 }, inputTokens: 80, outputTokens: 0, elapsedMs: 0 };

async function withWorker(source: (marker: string) => string, run: (url: string, marker: string) => Promise<void>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "jev-worker-"))), marker = join(root, "started");
  const worker = join(root, "worker.mjs");
  writeFileSync(worker, source(marker));
  try { await run(pathToFileURL(worker).href, marker); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("worker-specific source exclusions merge with inherited roots without global mutation", () =>
  withWorker(marker => `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, process.env.AI_REVIEW_EXCLUDED_SOURCES); for await (const chunk of process.stdin) {} console.log(${JSON.stringify(JSON.stringify(answer))});`, async (url, marker) => {
    const previous = process.env.AI_REVIEW_EXCLUDED_SOURCES;
    const inherited = join(dirname(marker), "inherited"), workspace = join(dirname(marker), "workspace");
    const raw = JSON.stringify([inherited]);
    try {
      process.env.AI_REVIEW_EXCLUDED_SOURCES = raw;
      expect((await runJevBridge(url, request, undefined, [workspace])).status).toBe("ok");
      expect(JSON.parse(readFileSync(marker, "utf8"))).toEqual([inherited, workspace]);
      expect(process.env.AI_REVIEW_EXCLUDED_SOURCES).toBe(raw);
    } finally { if (previous === undefined) delete process.env.AI_REVIEW_EXCLUDED_SOURCES; else process.env.AI_REVIEW_EXCLUDED_SOURCES = previous; }
  }));

test.each([["closed", "ignore", true], ["inherited", "inherit", true],
  ["early-exit closed", "ignore", false], ["early-exit inherited", "inherit", false]] as const)
  ("owned descendants stop after worker exit with %s streams", (_label, stdio, complete) =>
  withWorker(marker => {
    const helper = `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker + '.ready')}, 'ready'); setTimeout(() => writeFileSync(${JSON.stringify(marker + '.late')}, 'late'), 1250);`;
    return `import { spawn } from 'node:child_process'; import { existsSync } from 'node:fs';
spawn(process.execPath, ['-e', ${JSON.stringify(helper)}], { stdio: ${JSON.stringify(stdio)} });
while (!existsSync(${JSON.stringify(marker + '.ready')})) await new Promise(resolve => setTimeout(resolve, 5));
${complete ? `console.log(${JSON.stringify(JSON.stringify(answer))});` : ""} process.exit(0);`;
  }, async (url, marker) => {
    const result = await runJevBridge(url, request);
    await Bun.sleep(1500);
    expect(result.status).toBe(complete ? "ok" : "unavailable");
    expect(existsSync(marker + ".late")).toBe(false);
  }));

test("owner death closes the supervisor lease and stops its active worker", () =>
  withWorker(marker => `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'ready'); setTimeout(() => writeFileSync(${JSON.stringify(marker + '.late')}, 'late'), 1250);`, async (url, marker) => {
    const parent = join(dirname(fileURLToPath(url)), "parent.mjs");
    const transport = pathToFileURL(resolve("harnesses/jev-process.ts")).href;
    writeFileSync(parent, `import { runJevBridge } from ${JSON.stringify(transport)}; await runJevBridge(${JSON.stringify(url)}, ${JSON.stringify(request)});`);
    const child = Bun.spawn([process.execPath, "--no-env-file", "--config=/dev/null", parent], { cwd: tmpdir(), stdout: "ignore", stderr: "pipe" });
    try {
      const deadline = Date.now() + 1000;
      while (!existsSync(marker) && Date.now() < deadline) await Bun.sleep(5);
      expect(existsSync(marker)).toBe(true);
      child.kill("SIGKILL");
      await child.exited;
      await Bun.sleep(1500);
      expect(existsSync(marker + ".late")).toBe(false);
    } finally { child.kill("SIGKILL"); await child.exited; }
  }));

test.each([null, { ...answer, model: "different-model" }, { ...answer, probabilities: { drift: -1 } },
  { ...answer, probabilities: { drift: 0.01, other: 0.01 } }])("invalid worker judgment %# remains unavailable", value =>
  withWorker(() => `for await (const chunk of process.stdin) {}\nconsole.log(${JSON.stringify(JSON.stringify(value))});`, async url => {
    const result = await runJevBridge(url, request);
    expect(result.status).toBe("unavailable");
    expect(result.probabilities).toEqual({});
  }));

test("worker output is bounded before it can become a judgment", () =>
  withWorker(() => "for await (const chunk of process.stdin) {}\nprocess.stdout.write('x'.repeat(65537));", async url => {
    expect((await runJevBridge(url, request)).status).toBe("unavailable");
  }));

test("pre-aborted and oversized requests never start a worker", () =>
  withWorker(marker => `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'started');`, async (url, marker) => {
    expect((await runJevBridge(url, request, AbortSignal.abort())).status).toBe("unavailable");
    expect((await runJevBridge(url, { ...request, state: { text: "x".repeat(32769) } })).status).toBe("unavailable");
    expect(existsSync(marker)).toBe(false);
  }));

test("parent cancellation stops an active worker rather than waiting for its own deadline", () =>
  withWorker(marker => `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'started');\nsetTimeout(() => {}, 6500);`, async (url, marker) => {
    const controller = new AbortController();
    const running = runJevBridge(url, request, controller.signal);
    const deadline = Date.now() + 1000;
    while (!existsSync(marker) && Date.now() < deadline) await Bun.sleep(5);
    expect(existsSync(marker)).toBe(true);
    const cancelled = performance.now();
    controller.abort();
    expect((await running).status).toBe("unavailable");
    expect(performance.now() - cancelled).toBeLessThan(1000);
  }));
