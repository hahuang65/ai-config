import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  executeWeightedLanes,
  isolatedGitEnvironment,
  runLaneProcess,
} from "../scripts/test-suite-runner.mjs";
import { reportLaneFailures } from "../scripts/test-suite-report.mjs";

const lanes = Object.freeze([
  Object.freeze({ name: "heavy-a", expectedSeconds: 3, weight: 2 }),
  Object.freeze({ name: "heavy-b", expectedSeconds: 2, weight: 2 }),
  Object.freeze({ name: "light", expectedSeconds: 1, weight: 1 }),
]);

test("removes inherited Git controls from isolated Git lanes", () => {
  expect(isolatedGitEnvironment({
    GIT_DIR: "/external/repo",
    GIT_TEMPLATE_DIR: "/external/templates",
    GIT_WORK_TREE: "/external/tree",
    PATH: "/bin",
  }))
    .toMatchObject({ GIT_CONFIG_COUNT: "0", GIT_CONFIG_GLOBAL: "/dev/null", PATH: "/bin" });
  expect(isolatedGitEnvironment({ GIT_DIR: "/external/repo" })).not.toHaveProperty("GIT_DIR");
  expect(isolatedGitEnvironment({ GIT_WORK_TREE: "/external/tree" })).not.toHaveProperty("GIT_WORK_TREE");
  expect(isolatedGitEnvironment({ GIT_EXEC_PATH: "/external/helpers" })).not.toHaveProperty("GIT_EXEC_PATH");
  expect(isolatedGitEnvironment({ GIT_TEMPLATE_DIR: "/external/templates" })).not.toHaveProperty("GIT_TEMPLATE_DIR");
});

test("starts the longest lanes that fit the available execution weight", async () => {
  const started: string[] = [];
  let releaseLanes = () => {};
  const held = new Promise<void>((resolve) => { releaseLanes = resolve; });
  const execution = executeWeightedLanes(lanes, 3, async (lane) => {
    started.push(lane.name);
    await held;
    return { ...lane, exitCode: 0 };
  });

  await Promise.resolve();
  expect(started).toEqual(["heavy-a", "light"]);
  releaseLanes();
  await execution;
  expect(started).toEqual(["heavy-a", "light", "heavy-b"]);
});

test("rejects a lane that can never fit the execution budget", () => {
  expect(() => executeWeightedLanes(lanes, 1, async (lane) => ({ ...lane, exitCode: 0 })))
    .toThrow("Lane has invalid execution weight: heavy-a");
});

test("fails the suite when one weighted lane fails", async () => {
  const outcome = await executeWeightedLanes(lanes, 3, async (lane) => ({
    ...lane,
    exitCode: lane.name === "light" ? 1 : 0,
  }));

  expect(outcome.ok).toBe(false);
});

test("records a rejected lane without hanging the scheduler", async () => {
  const outcome = await executeWeightedLanes(lanes, 3, async (lane) => {
    if (lane.name === "heavy-a") throw new Error("spawn failed");
    return { ...lane, exitCode: 0 };
  });

  expect(outcome.ok).toBe(false);
  expect(outcome.results.find(({ name }) => name === "heavy-a")?.stderr).toContain("spawn failed");
});

test("stops launching pending lanes after cancellation", async () => {
  const controller = new AbortController();
  const started: string[] = [];
  let releaseLane = () => {};
  const held = new Promise<void>((resolve) => { releaseLane = resolve; });
  const execution = executeWeightedLanes(lanes, 2, async (lane) => {
    started.push(lane.name);
    await held;
    return { ...lane, exitCode: 0 };
  }, undefined, controller.signal);

  await Promise.resolve();
  controller.abort();
  releaseLane();
  const outcome = await execution;

  expect(started).toEqual(["heavy-a"]);
  expect(outcome).toMatchObject({ aborted: true, ok: false });
});

test("turns a completion callback error into a lane failure", async () => {
  const outcome = await executeWeightedLanes(
    [lanes[2]],
    1,
    async (lane) => ({ ...lane, exitCode: 0 }),
    () => { throw new Error("display failed"); },
  );

  expect(outcome.ok).toBe(false);
  expect(outcome.results[0].stderr).toContain("display failed");
});

test("bounds failed lane output and persists its complete redacted log", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "suite-failure-report-"));
  const diagnostics: string[] = [];
  const credential = "example-credential";
  const longOutput = [
    `GITHUB_\u001b[31mTOKEN=${credential}`,
    `PROD_AP\tI_KEY=${credential}`,
    `apiKey=${credential}`,
    `--GITHUB_TOKEN\t${credential} --dry-run`,
    `{\"access_token\t\":\"${credential}\"}`,
    `Authoriza\ttion: Basic ${credential}`,
    `Authorization: Bearer\r\n ${credential}`,
    "--token\nbuild failed",
    "Authorization:\nbuild failed",
    "diagnostic line\n".repeat(1_000),
  ].join("\n");
  try {
    const report = await reportLaneFailures([{
      durationSeconds: 1.25,
      exitCode: 1,
      name: "guard/example",
      stderr: longOutput,
      stdout: "setup output\n",
    }], {
      temporaryRoot,
      writeDiagnostic: (text) => diagnostics.push(text),
    });

    const diagnostic = diagnostics.join("");
    const fullLog = await readFile(report.fullLogPath, "utf8");
    const permissions = (await stat(report.fullLogPath)).mode & 0o777;
    expect({
      diagnosticHasFullPath: diagnostic.includes(report.fullLogPath),
      diagnosticIsBounded: diagnostic.length < 10_000,
      diagnosticShowsOmission: diagnostic.includes("characters omitted"),
      fullLogHasTail: fullLog.endsWith("diagnostic line\n"),
      fullLogPreservesFollowingRecord: fullLog.includes("--token\nbuild failed")
        && fullLog.includes("Authorization:\nbuild failed"),
      diagnosticHasControl: diagnostic.includes("\u001b"),
      fullLogHasControl: fullLog.includes("\u001b"),
      fullLogIsRedacted: fullLog.includes("GITHUB_TOKEN=[REDACTED]")
        && fullLog.includes("PROD_AP\tI_KEY=[REDACTED]")
        && fullLog.includes("apiKey=[REDACTED]")
        && fullLog.includes("--GITHUB_TOKEN\t[REDACTED] --dry-run")
        && fullLog.includes('{"access_token\t":"[REDACTED]"}')
        && fullLog.includes("Authoriza\ttion: [REDACTED]")
        && fullLog.includes("Authorization: [REDACTED]"),
      fullLogLeaksCredential: fullLog.includes(credential),
      permissions,
    }).toEqual({
      diagnosticHasFullPath: true,
      diagnosticIsBounded: true,
      diagnosticShowsOmission: true,
      fullLogHasTail: true,
      fullLogPreservesFollowingRecord: true,
      diagnosticHasControl: false,
      fullLogHasControl: false,
      fullLogIsRedacted: true,
      fullLogLeaksCredential: false,
      permissions: 0o600,
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("bounds full-log persistence errors", async () => {
  const diagnostics: string[] = [];
  const report = await reportLaneFailures([{
    durationSeconds: 1,
    exitCode: 1,
    name: "guard/example",
    stderr: "failure",
    stdout: "",
  }], {
    makeTemporaryDirectory: async () => {
      throw new Error(`persistence failed ${"x".repeat(20_000)}`);
    },
    writeDiagnostic: (text) => diagnostics.push(text),
  });

  const diagnostic = diagnostics.join("");
  expect({
    diagnosticIsBounded: diagnostic.length < 9_000,
    disclosesOmission: diagnostic.includes("characters omitted"),
    fullLogPath: report.fullLogPath,
    reportsUnavailable: diagnostic.includes("Full failure log unavailable"),
  }).toEqual({
    diagnosticIsBounded: true,
    disclosesOmission: true,
    fullLogPath: null,
    reportsUnavailable: true,
  });
});

test("does not launch a lane after its suite is cancelled", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "suite-cancelled-lane-"));
  const marker = path.join(temporaryRoot, "started");
  const controller = new AbortController();
  controller.abort();
  try {
    await expect(runLaneProcess({
      args: ["-c", "touch \"$1\"", "lane", marker],
      command: "bash",
      cwd: path.join(import.meta.dir, ".."),
      name: "test/cancelled-lane",
      temporaryDirectory: path.join(temporaryRoot, "lane"),
    }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    await expect(readFile(marker)).rejects.toThrow();
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("terminates descendants after their lane leader exits", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "suite-lane-leader-"));
  const marker = path.join(temporaryRoot, "leader.pid");
  const controller = new AbortController();
  try {
    const execution = runLaneProcess(exitedLeaderLane(marker), controller.signal);
    await waitForLeaderExit(marker);
    controller.abort();
    const result = await execution;
    expect(result.exitCode).toBe(0);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}, 5_000);

test("fails a successful lane that leaves a detached descendant", async () => {
  const result = await runLaneProcess({
    args: ["-c", "(sleep 30) >/dev/null 2>&1 & exit 0"],
    command: "bash",
    cwd: path.join(import.meta.dir, ".."),
    name: "test/residual-process",
    terminationGraceMs: 100,
    timeoutMs: 5_000,
  });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("left process group");
}, 5_000);

test("fails a timed-out lane whose leader exited successfully", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "suite-lane-timeout-"));
  const marker = path.join(temporaryRoot, "leader.pid");
  try {
    const result = await runLaneProcess(exitedLeaderLane(marker, 100));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Lane timed out");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}, 5_000);

test("removes its snapshot root when cancelled during setup", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "suite-cancellation-"));
  const runner = spawn(process.execPath, [path.join(import.meta.dir, "..", "scripts", "test-suite-runner.mjs")], {
    cwd: path.join(import.meta.dir, ".."),
    env: { ...process.env, TMPDIR: temporaryRoot },
    stdio: "ignore",
  });
  try {
    const createdRoot = await waitForSnapshotRoot(temporaryRoot);
    runner.kill("SIGTERM");
    await waitForClose(runner);

    expect(createdRoot).toStartWith("ai-config-test-suite-");
    expect(await readdir(temporaryRoot)).toEqual([]);
  } finally {
    if (runner.exitCode === null) runner.kill("SIGKILL");
    await waitForClose(runner);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}, 15_000);

function exitedLeaderLane(marker: string, timeoutMs = 5_000) {
  return {
    args: ["-c", "echo $$ > \"$1\"; (trap '' TERM; sleep 30) & exit 0", "lane", marker],
    command: "bash",
    cwd: path.join(import.meta.dir, ".."),
    name: "test/exited-leader",
    terminationGraceMs: 100,
    timeoutMs,
  };
}

async function waitForLeaderExit(marker: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const processId = Number((await readFile(marker, "utf8")).trim());
      try {
        process.kill(processId, 0);
      } catch (error: any) {
        if (error.code === "ESRCH") return;
        throw error;
      }
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
    await Bun.sleep(10);
  }
  throw new Error("Lane leader did not exit");
}

async function waitForSnapshotRoot(temporaryRoot: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const created = (await readdir(temporaryRoot)).find((entry) => entry.startsWith("ai-config-test-suite-"));
    if (created) return created;
    await Bun.sleep(10);
  }
  throw new Error("Test suite runner did not create a snapshot root");
}

function waitForClose(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => child.once("close", () => resolve()));
}
