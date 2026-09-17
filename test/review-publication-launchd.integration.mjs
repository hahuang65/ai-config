#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile as executeFile } from "node:child_process";
import { chmod, mkdir, readFile, readdir, stat, utimes, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { SERVICE_SHUTDOWN_TIMEOUT_SECONDS } from "../skills/review-change/runtime/review-publication-lifetime.mjs";
import {
  createFrozenPublicationScope,
  createPublicationToken,
} from "../skills/review-change/runtime/review-publication-protocol.mjs";
import { loadPublicationKey } from "../skills/review-change/runtime/review-publication-state.mjs";

const execFile = promisify(executeFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const launchctl = "/bin/launchctl";
const commandTimeoutMs = 5_000;
const checkTimeoutMs = 30_000;
const productionPort = 4392;
const root = requiredAbsoluteEnvironment("REVIEW_PUBLICATION_LAUNCHD_ROOT");
const label = requiredLabelEnvironment();
const domain = `gui/${process.getuid()}`;
const serviceTarget = `${domain}/${label}`;
const configurationFile = requiredAbsoluteEnvironment("REVIEW_PUBLICATION_LAUNCHD_CONFIG");
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(new Error("launchd integration check timed out")), checkTimeoutMs);

try {
  assert.equal(process.platform, "darwin", "The live launchd check requires macOS");
  await runIntegrationCheck(controller.signal);
} finally {
  clearTimeout(deadline);
}

async function runIntegrationCheck(signal) {
  const home = path.join(root, "home");
  const traceFile = path.join(root, "worker-lifecycle.jsonl");
  const requestFile = path.join(root, "old-confirmation-request.txt");
  const plistFile = path.join(root, `${label}.plist`);
  const worker = path.join(repositoryRoot, "test", "fixtures", "review-publication-launchd-worker.mjs");
  await mkdir(home, { mode: 0o700 });
  await writeJson(configurationFile, { expectedHost: "pending", home, traceFile });

  const port = await reserveUniquePort();
  assert.notEqual(port, productionPort, "The integration socket must not use the production port");
  const expectedHost = `127.0.0.1:${port}`;
  await writeJson(configurationFile, { expectedHost, home, traceFile });
  const request = await createOldSignedRequest(home, requestFile);
  const requestState = await stat(requestFile);
  const definition = await renderTemporaryDefinition({ configurationFile, label, port, worker });
  await writeFile(plistFile, definition, { encoding: "utf8", mode: 0o600 });
  await chmod(plistFile, 0o600);

  assert.equal(await countWorkers(configurationFile), 0);
  const firstRegistration = Date.now();
  assert.ok(requestState.mtimeMs < firstRegistration, "The signed request must predate service registration");
  await launchctlCommand(["bootstrap", domain, plistFile]);
  const firstDormantState = await assertDormant(configurationFile);
  const firstResponse = await sendConfirmation(expectedHost, request, signal);
  const firstCycle = await waitForWorkerCycle(traceFile, configurationFile, 1, signal);
  await assertStateHasNoReportRecords(home);

  await launchctlCommand(["bootout", serviceTarget]);
  await waitForUnloaded(configurationFile, signal);
  const reloadTime = Date.now();
  assert.ok(requestState.mtimeMs < reloadTime, "The signed request must predate service reload");
  await launchctlCommand(["bootstrap", domain, plistFile]);
  const reloadedDormantState = await assertDormant(configurationFile);
  const secondResponse = await sendConfirmation(expectedHost, await readFile(requestFile, "utf8"), signal);
  const secondCycle = await waitForWorkerCycle(traceFile, configurationFile, 2, signal);
  await assertStateHasNoReportRecords(home);
  await assertNoHarnessState(home);

  printEvidence({
    expectedHost,
    firstCycle,
    firstDormantState,
    firstRegistration,
    firstResponse,
    label,
    reloadTime,
    reloadedDormantState,
    requestMtime: requestState.mtime,
    secondCycle,
    secondResponse,
  });
}

async function createOldSignedRequest(home, requestFile) {
  const key = await loadPublicationKey({ home });
  const identity = {
    host: "github.com",
    signingKeyId: "review-publication-v1",
    commentTemplateVersion: 1,
    repository: { id: "R_launchd_fixture", nameWithOwner: "fixture/repository" },
    pullRequest: { id: "PR_launchd_fixture", number: 64, url: "https://github.com/fixture/repository/pull/64" },
    scope: { baseOid: "a".repeat(40), headOid: "b".repeat(40) },
  };
  const frozenScope = createFrozenPublicationScope(identity, { key });
  const publicationToken = createPublicationToken({
    ...identity,
    findings: [{
      id: "RPC-064",
      title: "Temporary launchd integration evidence",
      body: "This signed fixture can request confirmation without provider mutation.",
      path: "test/review-publication-launchd.integration.mjs",
      line: 1,
      side: "RIGHT",
    }],
  }, { actor: { id: "U_launchd_fixture", login: "fixture-reviewer" }, frozenScope, key });
  const request = new URLSearchParams({ publication_token: publicationToken, selected_finding_id: "RPC-064" }).toString();
  await writeFile(requestFile, request, { encoding: "utf8", mode: 0o600 });
  const oldTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000);
  await utimes(requestFile, oldTime, oldTime);
  return request;
}

async function renderTemporaryDefinition({ configurationFile: config, label: serviceLabel, port, worker }) {
  const template = await readFile(path.join(repositoryRoot, "review-publication", "dev.review-publication.plist"), "utf8");
  const replacements = new Map([
    ["dev.review-publication", serviceLabel],
    ["__NODE_EXECUTABLE__", process.execPath],
    ["__WORKER__", worker],
    ["__SERVICE_SHUTDOWN_TIMEOUT_SECONDS__", String(SERVICE_SHUTDOWN_TIMEOUT_SECONDS)],
  ]);
  let definition = template;
  for (const [source, destination] of replacements) definition = definition.replaceAll(source, escapeXml(destination));
  definition = definition
    .replace("<string>--inetd</string>", `<string>--fixture-config</string>\n    <string>${escapeXml(config)}</string>`)
    .replace("<string>4392</string>", `<string>${port}</string>`);
  assert.ok(!definition.includes("<string>dev.review-publication</string>"));
  assert.ok(definition.includes(`<string>${escapeXml(serviceLabel)}</string>`));
  assert.ok(!definition.includes("<string>4392</string>"));
  assert.doesNotMatch(definition, /__[A-Za-z0-9_]+__/, "The temporary definition must render every placeholder");
  return definition;
}

async function sendConfirmation(expectedHost, body, signal) {
  const response = await fetch(`http://${expectedHost}/api/v1/review-publication-confirmations`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal,
  });
  const page = await response.text();
  assert.equal(response.status, 200);
  assert.match(page, /Post this review to GitHub[?]/);
  assert.match(page, /Temporary launchd integration evidence/);
  return { bodyAccepted: true, status: response.status };
}

async function assertDormant(configuration) {
  const workers = await countWorkers(configuration);
  assert.equal(workers, 0, "No fixture worker may exist before a request");
  const { stdout } = await launchctlCommand(["print", serviceTarget]);
  const activeCount = Number(/active count = (\d+)/.exec(stdout)?.[1] ?? -1);
  assert.equal(activeCount, 0, "The registered service must remain dormant before a request");
  return { activeCount, workers };
}

async function waitForWorkerCycle(traceFile, configuration, cycleNumber, signal) {
  const expectedEvents = cycleNumber * 2;
  const events = await waitUntil(async () => {
    const lifecycle = await readLifecycle(traceFile);
    return lifecycle.length === expectedEvents && await countWorkers(configuration) === 0 ? lifecycle : null;
  }, signal);
  const [started, finished] = events.slice(expectedEvents - 2);
  assert.deepEqual([started.event, finished.event], ["start", "finish"]);
  assert.equal(started.pid, finished.pid);
  const durationMs = finished.time - started.time;
  assert.ok(durationMs >= 0 && durationMs <= 5_000, "The activated worker must finish within its request bound");
  return { durationMs, pid: started.pid, totalFinishes: cycleNumber, totalStarts: cycleNumber };
}

async function waitForUnloaded(configuration, signal) {
  await waitUntil(async () => {
    const service = await launchctlCommand(["print", serviceTarget], true);
    return service.status !== 0 && await countWorkers(configuration) === 0 ? true : null;
  }, signal);
}

async function assertStateHasNoReportRecords(home) {
  const entries = await readdir(path.join(home, ".review-publication"));
  assert.deepEqual(entries.sort(), ["signing-key"]);
}

async function assertNoHarnessState(home) {
  const entries = await readdir(home);
  assert.ok(!entries.includes(".claude") && !entries.includes(".pi"));
}

async function countWorkers(configuration) {
  const { stdout } = await command("/bin/ps", ["-axo", "command="]);
  return stdout.split("\n").filter((line) => line.includes(configuration) && line.includes("review-publication-launchd-worker.mjs")).length;
}

async function readLifecycle(traceFile) {
  try {
    const source = await readFile(traceFile, "utf8");
    return source.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function waitUntil(operation, signal) {
  while (true) {
    signal.throwIfAborted();
    const value = await operation();
    if (value) return value;
    await waitForPoll(signal);
  }
}

function waitForPoll(signal) {
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(signal.reason);
    const timer = setTimeout(() => finish(), 25);
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function reserveUniquePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  assert.ok(address && typeof address !== "string");
  return address.port;
}

async function launchctlCommand(args, allowFailure = false) {
  return command(launchctl, args, allowFailure);
}

async function command(executable, args, allowFailure = false) {
  try {
    const result = await execFile(executable, args, { maxBuffer: 1024 * 1024, timeout: commandTimeoutMs });
    return { ...result, status: 0 };
  } catch (error) {
    if (!allowFailure) throw error;
    return { status: Number(error.code) || 1, stderr: error.stderr ?? "", stdout: error.stdout ?? "" };
  }
}

async function writeJson(destination, value) {
  await writeFile(destination, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
}

function requiredAbsoluteEnvironment(name) {
  const value = process.env[name] ?? "";
  if (!path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return value;
}

function requiredLabelEnvironment() {
  const value = process.env.REVIEW_PUBLICATION_LAUNCHD_LABEL ?? "";
  if (!/^dev[.]review-publication[.]integration[.][A-Za-z0-9.-]+$/.test(value)) {
    throw new Error("The temporary launchd label is invalid");
  }
  return value;
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function printEvidence(evidence) {
  console.log("launchd integration evidence:");
  console.log(`  label: ${evidence.label}`);
  console.log(`  socket: ${evidence.expectedHost} (production port ${productionPort} untouched)`);
  console.log(`  old request: ${evidence.requestMtime.toISOString()} (before registrations ${new Date(evidence.firstRegistration).toISOString()} and ${new Date(evidence.reloadTime).toISOString()})`);
  console.log(`  first dormant state: active=${evidence.firstDormantState.activeCount}, workers=${evidence.firstDormantState.workers}`);
  console.log(`  first request: HTTP ${evidence.firstResponse.status}, worker=${evidence.firstCycle.pid}, starts=1, finishes=1, duration=${evidence.firstCycle.durationMs}ms`);
  console.log(`  reloaded dormant state: active=${evidence.reloadedDormantState.activeCount}, workers=${evidence.reloadedDormantState.workers}`);
  console.log(`  old request after reload: HTTP ${evidence.secondResponse.status}, worker=${evidence.secondCycle.pid}, starts=1, finishes=1, duration=${evidence.secondCycle.durationMs}ms`);
  console.log("  retained state: signing-key only; temporary home contains no harness directories");
}
