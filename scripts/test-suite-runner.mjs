#!/usr/bin/env node
import { constants } from "node:fs";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHILD_TERMINATION_GRACE_MS,
  LANE_TIMEOUT_MS,
  isolatedGitEnvironment,
  runLaneProcess,
  stopChildren,
} from "./test-suite-process.mjs";
import {
  MAX_BROWSER_SUITES,
  classifyBunTestFiles,
} from "./test-suite-classification.mjs";
import { reportLaneFailures } from "./test-suite-report.mjs";

export { isolatedGitEnvironment, runLaneProcess } from "./test-suite-process.mjs";

export const MAX_EXECUTION_WEIGHT = 14;
export const BUN_TEST_EXECUTION_WEIGHTS = Object.freeze({ browser: 8, rest: 5 });
const INSTALL_GROUPS = Object.freeze([
  Object.freeze({ name: "isolation", selector: "isolation", expectedSeconds: 1.7, weight: 2 }),
  Object.freeze({ name: "behavior", selector: "install-behavior", expectedSeconds: 2.7, weight: 2 }),
  Object.freeze({ name: "modules", selector: "install-module-lifecycle", expectedSeconds: 0.7, weight: 2 }),
]);
const META_GROUPS = Object.freeze([
  Object.freeze({ name: "frontmatter", expectedSeconds: 2.4, cases: Object.freeze([
    "skill-missing-name", "agent-missing-tools", "agent-unknown-tool", "rule-missing-description",
  ]) }),
  Object.freeze({ name: "references", expectedSeconds: 3, cases: Object.freeze([
    "broken-reference", "command-skill-overlap", "agent-missing-rule", "skill-missing-file", "duplicate-adr",
  ]) }),
  Object.freeze({ name: "contracts", expectedSeconds: 2, cases: Object.freeze([
    "stale-stub", "forbidden-phrase", "retired-rule-frontmatter", "stale-pi-bundle", "bad-manifest",
    "cli-ergonomics-routing", "cli-ergonomics-outcomes", "cli-ergonomics-readme-inventory",
    "cli-ergonomics-readme-attribution",
  ]) }),
  Object.freeze({ name: "workflow", expectedSeconds: 2.8, cases: Object.freeze([
    "coach-discipline", "build-phase-loading", "missing-context-files", "missing-ubiquitous-language",
  ]) }),
]);
export function executeWeightedLanes(lanes, maximumWeight, runLane, onComplete = () => {}, signal) {
  validateLaneWeights(lanes, maximumWeight);
  const pending = [...lanes].sort((left, right) => right.expectedSeconds - left.expectedSeconds);
  const results = [];
  let activeWeight = 0;
  let cancelled = signal?.aborted ?? false;
  return new Promise((resolve) => {
    const finishIfComplete = () => {
      if (activeWeight > 0 || (!cancelled && pending.length > 0)) return false;
      signal?.removeEventListener("abort", cancel);
      resolve(suiteOutcome(results, cancelled));
      return true;
    };
    const settle = (laneDefinition, initialResult) => {
      activeWeight -= laneDefinition.weight;
      let result = initialResult;
      try {
        onComplete(result);
      } catch (error) {
        result = laneFailure(laneDefinition, error);
      }
      results.push(result);
      if (!finishIfComplete()) launch();
    };
    const launch = () => {
      if (cancelled || finishIfComplete()) return;
      while (pending.length > 0) {
        const index = pending.findIndex(({ weight }) => weight <= maximumWeight - activeWeight);
        if (index < 0) break;
        const [laneDefinition] = pending.splice(index, 1);
        activeWeight += laneDefinition.weight;
        void Promise.resolve()
          .then(() => runLane(laneDefinition))
          .then(
            (result) => settle(laneDefinition, result),
            (error) => settle(laneDefinition, laneFailure(laneDefinition, error)),
          );
      }
    };
    function cancel() {
      cancelled = true;
      finishIfComplete();
    }
    signal?.addEventListener("abort", cancel, { once: true });
    launch();
  });
}

function validateLaneWeights(lanes, maximumWeight) {
  if (!Number.isFinite(maximumWeight) || maximumWeight <= 0) {
    throw new Error("Maximum execution weight must be positive");
  }
  const invalid = lanes.find(({ weight }) => !Number.isFinite(weight) || weight <= 0 || weight > maximumWeight);
  if (invalid) throw new Error(`Lane has invalid execution weight: ${invalid.name}`);
}

function laneFailure(laneDefinition, error) {
  return Object.freeze({
    ...laneDefinition,
    durationSeconds: 0,
    exitCode: 1,
    signal: null,
    stdout: "",
    stderr: `${error instanceof Error ? error.message : String(error)}\n`,
  });
}

function suiteOutcome(results, aborted = false) {
  return Object.freeze({
    aborted,
    ok: !aborted && results.every(({ exitCode }) => exitCode === 0),
    results: Object.freeze(results),
  });
}

async function collectTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTestFiles(entryPath);
    return entry.name.endsWith(".test.ts") ? [entryPath] : [];
  }));
  return nestedFiles.flat().sort();
}

async function buildLanes(repoDir, snapshots) {
  const testFiles = await Promise.all([
    collectTestFiles(path.join(repoDir, "shared")),
    collectTestFiles(path.join(repoDir, "test")),
  ]);
  const bunTests = classifyBunTestFiles(testFiles.flat());
  const coreLanes = [
    lane("content/foundation", repoDir, "bash", ["scripts/test-pipeline.sh", "content", "content-foundation"],
      { expectedSeconds: 2.2, weight: 2 }),
    lane("content/build", repoDir, "bash", ["scripts/test-pipeline.sh", "content", "content-build"],
      { expectedSeconds: 1.1, weight: 2 }),
    lane("content/review", repoDir, "bash", ["scripts/test-pipeline.sh", "content", "content-review"],
      { expectedSeconds: 1, weight: 2 }),
    lane("content/references", repoDir, "bash", ["scripts/test-pipeline.sh", "content", "content-references"],
      { expectedSeconds: 3.3, weight: 2 }),
    lane("content/contracts", repoDir, "bash", ["scripts/test-pipeline.sh", "content", "content-contracts"],
      { expectedSeconds: 0.7, weight: 2 }),
    lane("install/manifests", repoDir, "bash", ["scripts/test-pipeline.sh", "install", "harness-modules"],
      { expectedSeconds: 0.2, weight: 1 }),
    lane("bun/rest", repoDir, "bun", ["test", "--parallel=4", "--max-concurrency=2", ...bunTests.rest],
      { expectedSeconds: 9, isolatedGit: true, weight: BUN_TEST_EXECUTION_WEIGHTS.rest }),
    lane("bun/browser", repoDir, "bun", [
      "test", `--parallel=${MAX_BROWSER_SUITES}`, "--max-concurrency=2", ...bunTests.browser,
    ], { expectedSeconds: 19, terminationGraceMs: 5_000, weight: BUN_TEST_EXECUTION_WEIGHTS.browser }),
  ];
  const installLanes = snapshots.installRepos.map(({ expectedSeconds, name, repo, selector, weight }) => lane(
    `install/${name}`,
    repo,
    "bash",
    ["scripts/test-pipeline.sh", "install", selector],
    { expectedSeconds, isolatedGit: true, weight },
  ));
  const metaLanes = snapshots.metaRepos.map(({ cases, expectedSeconds, name, repo }) => lane(
    `meta/${name}`,
    repo,
    "bash",
    ["scripts/test-pipeline-self-test.sh", "--cases", ...cases],
    { expectedSeconds, weight: 2 },
  ));
  const lanes = [...coreLanes, ...installLanes, ...metaLanes];
  return Object.freeze(lanes.map((definition) => Object.freeze({
    ...definition,
    temporaryDirectory: path.join(snapshots.temporaryRoot, "lanes", definition.name.replaceAll("/", "-")),
  })));
}

function lane(name, cwd, command, args, scheduling = {}) {
  return Object.freeze({
    name,
    cwd,
    command,
    args: Object.freeze(args),
    expectedSeconds: scheduling.expectedSeconds ?? 1,
    weight: scheduling.weight ?? 1,
    env: scheduling.env ? Object.freeze({ ...scheduling.env }) : undefined,
    isolatedGit: scheduling.isolatedGit ?? false,
    terminationGraceMs: scheduling.terminationGraceMs ?? CHILD_TERMINATION_GRACE_MS,
    timeoutMs: scheduling.timeoutMs ?? LANE_TIMEOUT_MS,
  });
}

async function createSuiteSnapshots(repoDir, signal) {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "ai-config-test-suite-"));
  try {
    signal?.throwIfAborted();
    const metaRepos = await allOrThrow(META_GROUPS.map(async (group) => {
      const repo = path.join(temporaryRoot, `meta-${group.name}`);
      await copySnapshot(repoDir, repo, signal);
      return Object.freeze({ ...group, repo });
    }));
    const installRepos = await allOrThrow(INSTALL_GROUPS.map(async (group) => {
      const repo = path.join(temporaryRoot, `install-${group.name}`);
      await copySnapshot(repoDir, repo, signal);
      const setupLane = lane(`setup/${group.name}`, repo, "git", ["init", "-q"], { isolatedGit: true });
      const initialized = await runLaneProcess(setupLane, signal);
      if (initialized.exitCode !== 0) throw new Error(`Could not initialize install snapshot: ${group.name}`);
      signal?.throwIfAborted();
      return Object.freeze({ ...group, repo });
    }));
    return Object.freeze({
      installRepos: Object.freeze(installRepos),
      metaRepos: Object.freeze(metaRepos),
      temporaryRoot,
    });
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

async function allOrThrow(promises) {
  const results = await Promise.allSettled(promises);
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
  return results.map((result) => result.value);
}

async function copySnapshot(repoDir, destination, signal) {
  signal?.throwIfAborted();
  await cp(repoDir, destination, {
    recursive: true,
    mode: constants.COPYFILE_FICLONE,
    filter: (source) => !isExcludedSnapshotPath(repoDir, source),
  });
  signal?.throwIfAborted();
}

function isExcludedSnapshotPath(repoDir, source) {
  const relativePath = path.relative(repoDir, source);
  return relativePath === ".git" || relativePath === ".rumdl_cache";
}

function printStart(lanes) {
  console.log("\n  ▌ ai-config — resource-aware concurrent test lanes\n");
  console.log(`  • ${lanes.length} weighted lanes with execution weight capped at ${MAX_EXECUTION_WEIGHT}\n`);
}

function printCompletion(result) {
  const marker = result.exitCode === 0 ? "✓" : "✗";
  console.log(`  ${marker} ${result.name.padEnd(18)} ${result.durationSeconds.toFixed(2)} s`);
}

async function printFailures(results) {
  const failures = results.filter(({ exitCode }) => exitCode !== 0);
  await reportLaneFailures(failures);
}

async function runSuite(repoDir, signal) {
  const snapshot = await createSuiteSnapshots(repoDir, signal);
  try {
    const lanes = await buildLanes(repoDir, snapshot);
    signal?.throwIfAborted();
    printStart(lanes);
    const runLane = (laneDefinition) => runLaneProcess(laneDefinition, signal);
    const outcome = await executeWeightedLanes(
      lanes,
      MAX_EXECUTION_WEIGHT,
      runLane,
      printCompletion,
      signal,
    );
    await printFailures(outcome.results);
    console.log(outcome.ok ? "\n  ✓ all test lanes passed\n" : "\n  ✗ one or more test lanes failed\n");
    return outcome.ok ? 0 : 1;
  } finally {
    await rm(snapshot.temporaryRoot, { recursive: true, force: true });
  }
}

async function main() {
  const repoDir = fileURLToPath(new URL("..", import.meta.url));
  const controller = new AbortController();
  const cancel = () => {
    controller.abort();
    stopChildren("SIGTERM");
  };
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  process.exitCode = await runSuite(repoDir, controller.signal);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`test suite runner failed: ${error.message}`);
    stopChildren("SIGTERM");
    process.exitCode = 1;
  });
}
