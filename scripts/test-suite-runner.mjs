#!/usr/bin/env node
import { spawn } from "node:child_process";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LANE_TIMEOUT_MS = 180_000;
const BROWSER_TEST = "test/review-artifact/browser.test.ts";
const activeChildren = new Set();

export async function executeLanes(lanes, runLane, onComplete = () => {}) {
  const pending = lanes.map(async (lane) => {
    const result = await runLane(lane);
    onComplete(result);
    return result;
  });
  const results = await Promise.all(pending);
  return Object.freeze({
    ok: results.every(({ exitCode }) => exitCode === 0),
    results: Object.freeze(results),
  });
}

export async function executePhases(phases, runLane, onComplete = () => {}) {
  const results = [];
  for (const phase of phases) {
    const phaseOutcome = await executeLanes(phase, runLane, onComplete);
    results.push(...phaseOutcome.results);
  }
  return Object.freeze({
    ok: results.every(({ exitCode }) => exitCode === 0),
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

async function buildPhases(repoDir, metaRepo) {
  const browserPath = path.join(repoDir, BROWSER_TEST);
  const testFiles = await Promise.all([
    collectTestFiles(path.join(repoDir, "shared")),
    collectTestFiles(path.join(repoDir, "test")),
  ]);
  const guardRest = testFiles.flat().filter((testFile) => testFile !== browserPath);
  const concurrentLanes = Object.freeze([
    lane("content", repoDir, "bash", ["scripts/test-pipeline.sh", "content"]),
    lane("install", repoDir, "bash", ["scripts/test-pipeline.sh", "install"]),
    lane("guard/rest", repoDir, "bun", ["test", ...guardRest]),
    lane("meta/planted", metaRepo, "bash", ["scripts/test-pipeline-self-test.sh", "--planted-only"]),
  ]);
  const browserLane = lane("guard/browser", repoDir, "bun", ["test", browserPath]);
  return Object.freeze([concurrentLanes, Object.freeze([browserLane])]);
}

function lane(name, cwd, command, args) {
  return Object.freeze({ name, cwd, command, args: Object.freeze(args) });
}

function runLaneProcess(laneDefinition) {
  const startedAt = performance.now();
  return new Promise((resolve) => {
    const child = spawn(laneDefinition.command, laneDefinition.args, {
      cwd: laneDefinition.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: LANE_TIMEOUT_MS,
    });
    activeChildren.add(child);
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => stderr.push(Buffer.from(`${error.message}\n`)));
    child.on("close", (exitCode, signal) => {
      activeChildren.delete(child);
      resolve(Object.freeze({
        ...laneDefinition,
        durationSeconds: (performance.now() - startedAt) / 1_000,
        exitCode: exitCode ?? 1,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }));
    });
  });
}

async function createMetaSnapshot(repoDir) {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "ai-config-test-suite-"));
  const metaRepo = path.join(temporaryRoot, "repo");
  await cp(repoDir, metaRepo, {
    recursive: true,
    filter: (source) => !isExcludedSnapshotPath(repoDir, source),
  });
  return Object.freeze({ metaRepo, temporaryRoot });
}

function isExcludedSnapshotPath(repoDir, source) {
  const relativePath = path.relative(repoDir, source);
  return relativePath === ".git" || relativePath === ".rumdl_cache";
}

function printStart(phases) {
  console.log("\n  ▌ ai-config — safe test phases\n");
  phases.forEach((phase, index) => {
    const names = phase.map(({ name }) => name).join(", ");
    console.log(`  ${index + 1}. ${names}`);
  });
  console.log("");
}

function printCompletion(result) {
  const marker = result.exitCode === 0 ? "✓" : "✗";
  console.log(`  ${marker} ${result.name.padEnd(18)} ${result.durationSeconds.toFixed(2)} s`);
}

function printFailures(results) {
  const failures = results.filter(({ exitCode }) => exitCode !== 0);
  for (const failure of failures) {
    console.error(`\n  ── ${failure.name} failed ──\n`);
    if (failure.stdout) process.stderr.write(failure.stdout);
    if (failure.stderr) process.stderr.write(failure.stderr);
  }
}

async function runSuite(repoDir) {
  const snapshot = await createMetaSnapshot(repoDir);
  try {
    const phases = await buildPhases(repoDir, snapshot.metaRepo);
    printStart(phases);
    const outcome = await executePhases(phases, runLaneProcess, printCompletion);
    printFailures(outcome.results);
    console.log(outcome.ok ? "\n  ✓ all test lanes passed\n" : "\n  ✗ one or more test lanes failed\n");
    return outcome.ok ? 0 : 1;
  } finally {
    await rm(snapshot.temporaryRoot, { recursive: true, force: true });
  }
}

function stopChildren(signal) {
  for (const child of activeChildren) child.kill(signal);
}

async function main() {
  const repoDir = fileURLToPath(new URL("..", import.meta.url));
  process.once("SIGINT", () => stopChildren("SIGINT"));
  process.once("SIGTERM", () => stopChildren("SIGTERM"));
  process.exitCode = await runSuite(repoDir);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`test suite runner failed: ${error.message}`);
    stopChildren("SIGTERM");
    process.exitCode = 1;
  });
}
