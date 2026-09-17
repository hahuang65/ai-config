import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createReviewPublicationServer } from "../../skills/review-change/runtime/review-publication-server.mjs";
import { createConfirmationToken } from "../../skills/review-change/runtime/review-publication-protocol.mjs";
import { withPublisherLock } from "../../skills/review-change/runtime/review-publication-state.mjs";
import { publicationClaims } from "./review-publication-fixtures";

const temporaryRoots: string[] = [];
afterEach(async () => Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true }))));

for (const fixture of [
  {
    name: "timeout",
    releaseLease: async () => new Promise<void>(() => {}),
    rawError: "Review publisher lock cleanup timed out",
  },
  {
    name: "filesystem failure",
    releaseLease: async () => { throw new Error("EACCES /private/secret/publisher.lock"); },
    rawError: "/private/secret/publisher.lock",
  },
]) {
  test(`a post-success lock cleanup ${fixture.name} preserves the known publication result`, async () => {
    const home = await temporaryHome();
    let mutations = 0;
    const response = await publishWithLock(home, {
      releaseLease: fixture.releaseLease,
      publishReview: async (claims: ReturnType<typeof publicationClaims>) => {
        mutations += 1;
        return providerReview(claims, "created");
      },
    });

    expect({
      status: response.status,
      posted: response.body.includes("Review posted."),
      cleanupTrouble: response.body.includes("Local publication cleanup did not finish"),
      falseNoPostClaim: response.body.includes("No comments were posted"),
      leaksRawError: response.body.includes(fixture.rawError),
      mutations,
      noStore: response.cacheControl,
    }).toEqual({
      status: 201,
      posted: true,
      cleanupTrouble: true,
      falseNoPostClaim: false,
      leaksRawError: false,
      mutations: 1,
      noStore: "no-store",
    });
  });
}

test("a stale lease after post-success cleanup failure allows a later exact reconciliation", async () => {
  const home = await temporaryHome();
  const claims = publicationClaims();
  let mutations = 0;
  const first = await publishWithLock(home, {
    staleThresholdMs: 1,
    releaseLease: async () => { throw new Error("simulated release failure"); },
    publishReview: async () => {
      mutations += 1;
      return providerReview(claims, "created");
    },
  });
  await Bun.sleep(5);
  const second = await publishWithLock(home, {
    staleThresholdMs: 1,
    now: () => Date.now() + 10_000,
    publishReview: async () => providerReview(claims, "existing"),
  });

  expect({
    firstStatus: first.status,
    secondStatus: second.status,
    secondPosted: second.body.includes("Review posted."),
    mutations,
  }).toEqual({ firstStatus: 201, secondStatus: 200, secondPosted: true, mutations: 1 });
});

test("cleanup failure before a known success preserves the original no-publication error", async () => {
  const home = await temporaryHome();
  const original = Object.assign(new Error("provider unavailable before mutation"), {
    code: "provider_unavailable",
    status: 502,
  });
  let cleanupTrouble = false;

  await expect(withPublisherLock(publicationClaims(), async () => {
    throw original;
  }, {
    home,
    releaseLease: async () => { throw new Error("cleanup failed"); },
    onCleanupFailure: () => { cleanupTrouble = true; },
  })).rejects.toBe(original);
  expect(cleanupTrouble).toBe(true);
});

async function publishWithLock(home: string, options: {
  publishReview: (claims: ReturnType<typeof publicationClaims>) => Promise<Record<string, unknown>>;
  releaseLease?: (...arguments_: any[]) => Promise<void>;
  staleThresholdMs?: number;
  now?: () => number;
}) {
  const key = Buffer.alloc(32, 14);
  const claims = publicationClaims();
  const confirmationToken = createConfirmationToken({
    claims,
    selectedFindingIds: claims.findings.map((finding) => finding.id),
  }, { key });
  const server = await createReviewPublicationServer({
    key,
    inspectPullRequest: async () => ({
      actor: claims.actor,
      repository: claims.repository,
      pullRequest: { ...claims.pullRequest, state: "OPEN" },
      scope: claims.scope,
    }),
    confirmPublication: async () => {},
    publishReview: async () => options.publishReview(claims),
    withPublicationLock: (identity: unknown, task: () => Promise<unknown>, context: any) => (
      withPublisherLock(identity, task, {
        home,
        cleanupTimeoutMs: 2,
        pollIntervalMs: 1,
        staleThresholdMs: options.staleThresholdMs,
        now: options.now,
        releaseLease: options.releaseLease,
        onCleanupFailure: context.markCleanupTrouble,
      })
    ),
    expectedHost: "127.0.0.1:4392",
  });
  try {
    const response = await fetch(`${server.url}/api/v1/review-publications`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", host: "127.0.0.1:4392" },
      body: new URLSearchParams({ confirmation_token: confirmationToken }),
    });
    return {
      status: response.status,
      cacheControl: response.headers.get("cache-control"),
      body: await response.text(),
    };
  } finally {
    await server.close();
  }
}

function providerReview(claims: ReturnType<typeof publicationClaims>, disposition: "created" | "existing") {
  return {
    disposition,
    reviewId: 81,
    url: `${claims.pullRequest.url}#pullrequestreview-81`,
  };
}

async function temporaryHome() {
  const home = await mkdtemp(path.join(tmpdir(), "review-publication-cleanup-"));
  temporaryRoots.push(home);
  return home;
}
