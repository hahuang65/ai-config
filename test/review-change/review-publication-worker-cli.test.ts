import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createConfirmationToken } from "../../skills/review-change/runtime/review-publication-protocol.mjs";
import { validateInheritedPublicationSocket } from "../../skills/review-change/runtime/review-publication-socket.mjs";
import { loadPublicationKey } from "../../skills/review-change/runtime/review-publication-state.mjs";
import { loadReviewPublicationWorkerConfiguration } from "../../skills/review-change/runtime/review-publication-worker-config.mjs";
import { publicationClaims } from "./review-publication-fixtures";

const publicationCli = fileURLToPath(new URL("../../skills/review-change/bin/review-publication.mjs", import.meta.url));
const temporaryRoots: string[] = [];
afterEach(async () => Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true }))));

test("the production worker rejects caller-selected platform and confirmation executables", async () => {
  const fixture = await workerFixture();
  const processRef = runWorker(fixture, [
    "--inetd",
    runtimePlatform(),
    fixture.approvingConfirmation,
  ]);
  const [status, stderr] = await Promise.all([
    processRef.exited,
    new Response(processRef.stderr).text(),
    new Response(processRef.stdout).text(),
  ]);

  expect({
    status,
    usageHasOnlyFixedWorkerMode: stderr.includes("--inetd | --sign")
      && !stderr.includes("confirmation-executable")
      && !stderr.includes("macos|linux"),
    confirmationCalls: await calls(fixture.confirmationLog),
    providerCalls: await calls(fixture.providerLog),
  }).toEqual({
    status: 2,
    usageHasOnlyFixedWorkerMode: true,
    confirmationCalls: [],
    providerCalls: [],
  });
});

test("production worker rejects a pipe instead of an inherited accepted socket before processing", async () => {
  const fixture = await workerFixture();
  await writeFile(
    path.join(fixture.home, ".review-publication", "worker-config.json"),
    `${JSON.stringify({
      managedBy: "Managed by ai-config: review-publication",
      version: 1,
      confirmationExecutable: fixture.denyingConfirmation,
      githubExecutable: fixture.provider,
    })}\n`,
    { mode: 0o600 },
  );
  const installedConfiguration = await loadReviewPublicationWorkerConfiguration({ home: fixture.home });
  const processRef = runWorker(fixture, ["--inetd"], {
    AI_CONFIG_CONFIRMATION_BIN: fixture.approvingConfirmation,
    REVIEW_PUBLICATION_CONFIRMATION_EXECUTABLE: fixture.approvingConfirmation,
    REVIEW_PUBLICATION_GH: fixture.maliciousProvider,
  });
  const [status, response, stderr] = await Promise.all([
    processRef.exited,
    new Response(processRef.stdout).text(),
    new Response(processRef.stderr).text(),
  ]);
  const providerCalls = await calls(fixture.providerLog);

  expect({
    status,
    correctiveFailure: stderr.trim(),
    response,
    installedConfiguration,
    configuredConfirmationCalls: await calls(fixture.confirmationLog),
    substituteConfirmationCalls: await calls(fixture.approvalLog),
    usedConfiguredProvider: providerCalls.length > 0,
    substituteProviderCalls: await calls(fixture.maliciousProviderLog),
    providerMutations: providerCalls.filter((call) => call.includes('"POST"')),
  }).toEqual({
    status: 1,
    correctiveFailure: "Review publication requires one inherited accepted socket on standard input and output. Repair the user service installation, then try again.",
    response: "",
    installedConfiguration: {
      confirmationExecutable: fixture.denyingConfirmation,
      githubExecutable: fixture.provider,
      platform: runtimePlatform(),
    },
    configuredConfirmationCalls: [],
    substituteConfirmationCalls: [],
    usedConfiguredProvider: false,
    substituteProviderCalls: [],
    providerMutations: [],
  });
});

test("accepts only one matching inherited socket descriptor pair", () => {
  const socketState = { dev: 7, ino: 11, isSocket: () => true };
  expect(() => validateInheritedPublicationSocket({ descriptorState: () => socketState as any })).not.toThrow();
  for (const states of [
    [{ dev: 7, ino: 11, isSocket: () => false }, socketState],
    [socketState, { dev: 7, ino: 12, isSocket: () => true }],
  ]) {
    expect(() => validateInheritedPublicationSocket({
      descriptorState: (descriptor) => states[descriptor] as any,
    })).toThrow("requires one inherited accepted socket");
  }
});

async function workerFixture() {
  const home = await mkdtemp(path.join(tmpdir(), "review-publication-worker-"));
  temporaryRoots.push(home);
  const bin = path.join(home, "bin");
  await mkdir(bin, { mode: 0o700 });
  const confirmationLog = path.join(home, "confirmation-calls");
  const approvalLog = path.join(home, "approval-calls");
  const providerLog = path.join(home, "provider-calls");
  const maliciousProviderLog = path.join(home, "malicious-provider-calls");
  const denyingConfirmation = await executable(bin, "deny-confirmation", confirmationScript(confirmationLog, false));
  const approvingConfirmation = await executable(bin, "approve-confirmation", confirmationScript(approvalLog, true));
  const provider = await executable(bin, "gh", providerScript(providerLog));
  const maliciousProvider = await executable(bin, "malicious-gh", providerScript(maliciousProviderLog));
  const key = await loadPublicationKey({ home });
  const token = createConfirmationToken({ claims: publicationClaims(), selectedFindingIds: ["RC-001"] }, { key });
  const body = new URLSearchParams({ confirmation_token: token }).toString();
  const request = [
    "POST /api/v1/review-publications HTTP/1.1",
    "Host: 127.0.0.1:4392",
    "Content-Type: application/x-www-form-urlencoded",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "",
    body,
  ].join("\r\n");
  return {
    home,
    request,
    confirmationLog,
    approvalLog,
    providerLog,
    maliciousProviderLog,
    denyingConfirmation,
    approvingConfirmation,
    provider,
    maliciousProvider,
  };
}

function runWorker(
  fixture: Awaited<ReturnType<typeof workerFixture>>,
  args: string[],
  environment: Record<string, string> = {},
) {
  return Bun.spawn([process.execPath, publicationCli, ...args], {
    env: { ...process.env, HOME: fixture.home, ...environment },
    stdin: Buffer.from(fixture.request),
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function executable(directory: string, name: string, source: string) {
  const destination = path.join(directory, name);
  await writeFile(destination, source);
  await chmod(destination, 0o700);
  return destination;
}

function confirmationScript(log: string, approve: boolean) {
  const response = approve
    ? process.platform === "darwin" ? "console.log('button returned:Post review')" : ""
    : process.platform === "darwin" ? "console.error('User canceled (-128)'); process.exit(1)" : "process.exit(1)";
  return `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(log)}, 'called\\n');\n${response}\n`;
}

function providerScript(log: string) {
  const claims = publicationClaims();
  return `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
const endpoint = String(args.at(-1));
if (args.join(" ") === "api user") console.log(${JSON.stringify(JSON.stringify({ node_id: claims.actor.id, login: claims.actor.login }))});
else if (args[0] === "repo") console.log(${JSON.stringify(JSON.stringify(claims.repository))});
else if (args[0] === "pr") console.log(${JSON.stringify(JSON.stringify({ id: claims.pullRequest.id, number: claims.pullRequest.number, state: "OPEN", baseRefOid: claims.scope.baseOid, headRefOid: claims.scope.headOid }))});
else if (endpoint.includes("/files?")) console.log(${JSON.stringify(JSON.stringify([[{ filename: claims.findings[0].path, patch: "@@ -84,1 +84,1 @@\\n-old\\n+new" }]]))});
else if (args.includes("POST")) console.log(${JSON.stringify(JSON.stringify({ id: 1, html_url: "https://github.com/acme/payments/pull/842#pullrequestreview-1" }))});
else if (endpoint.endsWith("/reviews")) console.log("[[]]");
else process.exit(2);
`;
}

async function calls(log: string) {
  try {
    return (await readFile(log, "utf8")).trim().split("\n").filter(Boolean);
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function runtimePlatform() {
  return process.platform === "darwin" ? "macos" : "linux";
}
