import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createReviewPublicationServer } from "../../skills/review-change/runtime/review-publication-server.mjs";
import { withPublisherLock } from "../../skills/review-change/runtime/review-publication-state.mjs";
import {
  currentPullRequest,
  publicationClaims,
  signTestPublicationClaims,
} from "./review-publication-fixtures";

const servers: Array<{ close(): Promise<void> }> = [];
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

test("the largest signed report completes confirmation and final publication within both body limits", async () => {
  const key = Buffer.alloc(32, 1);
  const claims = largestSignableBoundaryClaims(key);
  let mutations = 0;
  const server = await createReviewPublicationServer({
    key,
    inspectPullRequest: async () => currentPullRequest(claims),
    confirmPublication: async () => {},
    publishReview: async () => {
      mutations += 1;
      return { reviewId: 194205, url: "https://github.com/acme/app/pull/1#pullrequestreview-194205" };
    },
  });
  servers.push(server);

  const confirmation = await confirm(server.url, claims, key);
  const confirmationBody = await confirmation.text();
  const finalForm = new URLSearchParams({ confirmation_token: confirmationToken(confirmationBody) });
  const publication = await fetch(`${server.url}/api/v1/review-publications`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: finalForm,
  });

  expect({
    confirmationStatus: confirmation.status,
    publicationStatus: publication.status,
    confirmationFits: confirmationRequestBytes(claims) <= 256 * 1024,
    publicationFits: Buffer.byteLength(finalForm.toString()) <= 256 * 1024,
    mutations,
  }).toEqual({
    confirmationStatus: 200,
    publicationStatus: 201,
    confirmationFits: true,
    publicationFits: true,
    mutations: 1,
  });
});

test("rejects the first report beyond the complete confirmation and publication boundary", () => {
  const key = Buffer.alloc(32, 1);
  const accepted = largestSignableBoundaryClaims(key);
  const rejected = boundaryPublicationClaims(accepted.findings.at(-1)!.body.length + 1);

  expect(() => signTestPublicationClaims(rejected, { key })).toThrow(expect.objectContaining({
    code: "invalid_publication_claims",
    status: 422,
  }));
});

test("rechecks changed scope after a waiting publication acquires its report lock", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "review-publication-waiting-lock-"));
  temporaryRoots.push(home);
  const claims = publicationClaims();
  const key = Buffer.alloc(32, 5);
  let scopeChanged = false;
  let mutations = 0;
  const lockPublication = (identity: any, task: () => Promise<unknown>) => (
    withPublisherLock(identity, task, { home })
  );
  const server = await createReviewPublicationServer({
    key,
    withPublicationLock: lockPublication,
    inspectPullRequest: async () => ({
      ...currentPullRequest(claims),
      scope: scopeChanged ? { ...claims.scope, headOid: "c".repeat(40) } : claims.scope,
    }),
    publishReview: async () => {
      mutations += 1;
      return { reviewId: 194205, url: "https://github.com/acme/payments/pull/842#pullrequestreview-194205" };
    },
  });
  servers.push(server);
  const confirmation = await confirm(server.url, claims, key);
  const confirmationBody = await confirmation.text();
  const release = deferred();
  const blocker = withPublisherLock(claims, async () => {
    release.acquired.resolve();
    await release.wait.promise;
  }, { home });
  await release.acquired.promise;

  const waitingPublication = publish(server.url, confirmationToken(confirmationBody));
  await Bun.sleep(40);
  scopeChanged = true;
  release.wait.resolve();
  await blocker;
  const response = await waitingPublication;

  expect({ status: response.status, mutations }).toEqual({ status: 409, mutations: 0 });
});

function largestSignableBoundaryClaims(key: Buffer) {
  let acceptedLength = 1;
  let lower = 1;
  let upper = 10_000;
  while (lower <= upper) {
    const candidateLength = Math.floor((lower + upper) / 2);
    try {
      signTestPublicationClaims(boundaryPublicationClaims(candidateLength), { key });
      acceptedLength = candidateLength;
      lower = candidateLength + 1;
    } catch {
      upper = candidateLength - 1;
    }
  }
  return boundaryPublicationClaims(acceptedLength);
}

function boundaryPublicationClaims(finalBodyLength: number) {
  const claims = publicationClaims();
  claims.findings = Array.from({ length: 20 }, (_value, index) => ({
    id: `RC-${String(index).padStart(3, "0")}`,
    title: "Finding",
    body: "x".repeat(index === 19 ? finalBodyLength : 10_000),
    path: "src/file.ts",
    line: index + 1,
    side: "RIGHT",
  }));
  claims.reportId = "bd".repeat(16);
  claims.actor = { id: "U_1", login: "reviewer" };
  claims.repository = { id: "R_1", nameWithOwner: "acme/app" };
  claims.pullRequest = { id: "PR_1", number: 1, url: "https://github.com/acme/app/pull/1" };
  return claims;
}

function confirmationRequestBytes(claims: ReturnType<typeof publicationClaims>) {
  const token = signTestPublicationClaims(claims, { key: Buffer.alloc(32, 1) });
  const form = new URLSearchParams({ publication_token: token });
  for (const finding of claims.findings) form.append("selected_finding_id", finding.id);
  return Buffer.byteLength(form.toString());
}

async function confirm(url: string, claims: ReturnType<typeof publicationClaims>, key: Buffer) {
  const form = new URLSearchParams({ publication_token: signTestPublicationClaims(claims, { key }) });
  claims.findings.forEach((finding) => form.append("selected_finding_id", finding.id));
  return fetch(`${url}/api/v1/review-publication-confirmations`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
}

function publish(url: string, token: string) {
  return fetch(`${url}/api/v1/review-publications`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ confirmation_token: token }),
  });
}

function confirmationToken(body: string) {
  return /name="confirmation_token" value="([^"]+)"/.exec(body)?.[1] ?? "";
}

function deferred() {
  let acquiredResolve!: () => void;
  let waitResolve!: () => void;
  return {
    acquired: {
      promise: new Promise<void>((resolve) => { acquiredResolve = resolve; }),
      resolve: () => acquiredResolve(),
    },
    wait: {
      promise: new Promise<void>((resolve) => { waitResolve = resolve; }),
      resolve: () => waitResolve(),
    },
  };
}
