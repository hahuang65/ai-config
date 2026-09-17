import { afterEach, expect, test } from "bun:test";
import crypto from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { openReportArtifact } from "../../skills/review-change/runtime/report-viewer.mjs";
import {
  createFrozenPublicationScope,
  verifyPublicationToken,
} from "../../skills/review-change/runtime/review-publication-protocol.mjs";
import { createReviewPublicationServer } from "../../skills/review-change/runtime/review-publication-server.mjs";
import { loadPublicationKey } from "../../skills/review-change/runtime/review-publication-state.mjs";
import {
  currentPullRequest,
  publicationClaims,
  signTestPublicationClaims,
} from "./review-publication-fixtures";

const publicationCli = fileURLToPath(new URL("../../skills/review-change/bin/review-publication.mjs", import.meta.url));
const servers: Array<{ close(): Promise<void> }> = [];
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

test("concurrent first signing-key loads observe one complete key", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-publication-key-race-"));
  temporaryRoots.push(root);

  const keys = await Promise.all(Array.from({ length: 32 }, () => loadPublicationKey({ home: root })));
  const stateEntries = await readdir(path.join(root, ".review-publication"));

  expect({
    complete: keys.every((key) => key.length === 32),
    oneKey: keys.every((key) => key.equals(keys[0])),
    stateEntries,
  }).toEqual({ complete: true, oneKey: true, stateEntries: ["signing-key"] });
});

test("recovers an interrupted stale signing-key initialization without replacing a valid winner", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-publication-key-recovery-"));
  temporaryRoots.push(root);
  const state = path.join(root, ".review-publication");
  await mkdir(state, { mode: 0o700 });
  const incompleteKey = path.join(state, "signing-key");
  await writeFile(incompleteKey, Buffer.alloc(7), { mode: 0o600 });
  const staleTime = new Date(Date.now() - 300_000);
  await utimes(incompleteKey, staleTime, staleTime);

  const recovered = await loadPublicationKey({ home: root });
  const staleTemporary = path.join(state, ".signing-key.interrupted.tmp");
  await writeFile(staleTemporary, Buffer.alloc(3), { mode: 0o600 });
  await utimes(staleTemporary, staleTime, staleTime);
  const winner = await loadPublicationKey({ home: root });

  expect({
    recoveredComplete: recovered.length,
    winnerPreserved: winner.equals(recovered),
    stateEntries: await readdir(state),
  }).toEqual({ recoveredComplete: 32, winnerPreserved: true, stateEntries: ["signing-key"] });
});

test("normalizes safe multi-paragraph Finding comments and escapes their HTML", async () => {
  const key = Buffer.alloc(32, 14);
  const claims = publicationClaims();
  claims.findings[0].body = "First paragraph.\r\n\r\nSecond\tparagraph with <strong>markup</strong>.";
  const publicationToken = signTestPublicationClaims(claims, { key });
  const signedClaims = verifyPublicationToken(publicationToken, { key });
  const server = await createReviewPublicationServer({
    key,
    inspectPullRequest: async () => currentPullRequest(signedClaims),
    publishReview: async () => { throw new Error("unexpected publication"); },
  });
  servers.push(server);

  const response = await fetch(`${server.url}/api/v1/review-publication-confirmations`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ publication_token: publicationToken, selected_finding_id: "RC-001" }),
  });
  const confirmation = await response.text();

  expect({
    status: response.status,
    normalizedBody: signedClaims.findings[0].body,
    escapedBody: confirmation.includes("Second\tparagraph with &lt;strong&gt;markup&lt;/strong&gt;."),
    executableMarkup: confirmation.includes("<strong>markup</strong>"),
    unsafeControlsRejected: ["\u0008", "\u007f", "\u0085"].every((control) => rejectsComment(control, key)),
  }).toEqual({
    status: 200,
    normalizedBody: "First paragraph.\n\nSecond\tparagraph with <strong>markup</strong>.",
    escapedBody: true,
    executableMarkup: false,
    unsafeControlsRejected: true,
  });
});

test("signing and verification reject duplicate Finding IDs while preserving unique signed order", () => {
  const key = Buffer.alloc(32, 15);
  const orderedClaims = publicationClaims();
  orderedClaims.findings.push({
    ...orderedClaims.findings[0],
    id: "RC-002",
    title: "Preserve the failure reason",
    line: 41,
  });
  const verified = verifyPublicationToken(signTestPublicationClaims(orderedClaims, { key }), { key });
  const duplicateClaims = {
    ...orderedClaims,
    findings: orderedClaims.findings.map((finding) => ({ ...finding, id: "RC-001" })),
  };
  const duplicatePayload = Buffer.from(JSON.stringify({
    version: 1,
    audience: "review-publication",
    ...duplicateClaims,
  })).toString("base64url");
  const duplicateToken = `${duplicatePayload}.${crypto.createHmac("sha256", key).update(duplicatePayload).digest("base64url")}`;

  expect({
    signedOrder: verified.findings.map((finding) => finding.id),
    signingRejectsDuplicates: captureProtocolCode(() => signTestPublicationClaims(duplicateClaims, { key })),
    verificationRejectsDuplicates: captureProtocolCode(() => verifyPublicationToken(duplicateToken, { key })),
  }).toEqual({
    signedOrder: ["RC-001", "RC-002"],
    signingRejectsDuplicates: "invalid_publication_claims",
    verificationRejectsDuplicates: "invalid_publication_claims",
  });
});

test("keeps the signed form fragment outside the report viewer HTML count", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-publication-sign-"));
  temporaryRoots.push(root);
  const bin = path.join(root, "bin");
  await mkdir(bin);
  const fakeGh = path.join(bin, "gh");
  await writeFile(fakeGh, fakeGitHubCli("acme/payments"));
  await chmod(fakeGh, 0o755);
  const claimsFile = path.join(root, "claims.json");
  const fragmentFile = path.join(root, "publication-form.review-fragment");
  const reportFile = path.join(root, "review-findings.html");
  await writeFile(reportFile, "<!doctype html><title>Review Findings</title>");
  const signingKey = await loadPublicationKey({ home: root });
  const { actor: _actor, reportId: _reportId, findings, ...identity } = publicationClaims();
  await writeFile(claimsFile, JSON.stringify({
    ...identity,
    findings,
    frozenScope: createFrozenPublicationScope(identity, {
      key: signingKey,
      randomBytes: () => Buffer.alloc(16, 6),
    }),
  }));
  const processRef = runPublication(root, fakeGh, ["--sign", claimsFile, fragmentFile]);
  const [exitCode, renderedPath, stderr] = await Promise.all([
    processRef.exited,
    new Response(processRef.stdout).text(),
    new Response(processRef.stderr).text(),
  ]);
  const fragment = await Bun.file(fragmentFile).exists() ? await readFile(fragmentFile, "utf8") : "";
  const token = /name="publication_token" value="([^"]+)"/.exec(fragment)?.[1] ?? "";
  const htmlReports = await Array.fromAsync(new Bun.Glob("*.html").scan({ cwd: root }));
  const openedReport = await openReport(root);

  expect({
    exitCode,
    stderr,
    claimsRemoved: !(await Bun.file(claimsFile).exists()),
    signedClaims: verifyPublicationToken(token, { key: signingKey }),
    renderedByHelper: renderedPath.trim() === fragmentFile && fragment.includes("review-publication-selection"),
    htmlReports,
    openedReport,
  }).toEqual({
    exitCode: 0,
    stderr: "",
    claimsRemoved: true,
    signedClaims: { ...publicationClaims(), reportId: "06060606060606060606060606060606" },
    renderedByHelper: true,
    htmlReports: ["review-findings.html"],
    openedReport: reportFile,
  });
});

test("does not offer general scope preparation through the installed helper", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-publication-prepare-"));
  temporaryRoots.push(root);
  const fakeGh = path.join(root, "gh");
  await writeFile(fakeGh, fakeGitHubCli());
  await chmod(fakeGh, 0o755);
  const preparationFile = path.join(root, "publication.review-scope.json");
  const processRef = runPublication(root, fakeGh, [
    "--prepare",
    "https://github.com/acme/payments/pull/842/files",
    preparationFile,
  ]);
  const [exitCode, stderr] = await Promise.all([
    processRef.exited,
    new Response(processRef.stderr).text(),
  ]);

  expect({
    exitCode,
    usageOmitsPreparation: !stderr.includes("--prepare"),
    preparationCreated: await Bun.file(preparationFile).exists(),
  }).toEqual({
    exitCode: 2,
    usageOmitsPreparation: true,
    preparationCreated: false,
  });
});

function captureProtocolCode(operation: () => unknown) {
  try {
    operation();
    return "accepted";
  } catch (error: any) {
    return error.code;
  }
}

function rejectsComment(control: string, key: Buffer) {
  const unsafe = publicationClaims();
  unsafe.findings[0].body = `Unsafe${control}comment`;
  try {
    signTestPublicationClaims(unsafe, { key });
    return false;
  } catch {
    return true;
  }
}

function runPublication(root: string, fakeGh: string, args: string[]) {
  return Bun.spawn(["node", publicationCli, ...args], {
    env: {
      ...process.env,
      HOME: root,
      PATH: `${path.dirname(fakeGh)}:${process.env.PATH}`,
      REVIEW_PUBLICATION_GH: fakeGh,
      REVIEW_CHANGE_REPORT_ROOT: root,
      TMPDIR: root,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

function openReport(root: string) {
  return openReportArtifact(root, {
    platform: "linux",
    spawnProcess: () => {
      const viewer = new EventEmitter() as EventEmitter & { unref(): void };
      viewer.unref = () => {};
      queueMicrotask(() => viewer.emit("spawn"));
      return viewer;
    },
  });
}

function fakeGitHubCli(nameWithOwner = "Acme/Payments") {
  return `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "api" && args[1] === "user") console.log(JSON.stringify({ node_id: "U_123", login: "reviewer" }));
else if (args[0] === "repo") console.log(JSON.stringify({ id: "R_456", nameWithOwner: "${nameWithOwner}" }));
else if (args[0] === "pr") console.log(JSON.stringify({ id: "PR_789", number: 842, url: "https://github.com/${nameWithOwner}/pull/842", baseRefOid: "${"a".repeat(40)}", headRefOid: "${"b".repeat(40)}" }));
else process.exit(2);
`;
}
