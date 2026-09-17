import { describe, expect, test } from "bun:test";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { handleInetdRequest } from "../../skills/review-change/runtime/review-publication-inetd.mjs";
import {
  createFrozenPublicationScope,
  createPublicationToken,
  verifyPublicationToken,
} from "../../skills/review-change/runtime/review-publication-protocol.mjs";
import { createGitHubProvider } from "../../skills/review-change/runtime/review-publication-provider.mjs";
import { withPublisherLock } from "../../skills/review-change/runtime/review-publication-state.mjs";

const key = Buffer.alloc(32, 8);

describe("Review publication trust boundary", () => {
  test("the trusted boundary creates the report identity and rejects changed scope claims", () => {
    const frozenScope = createFrozenPublicationScope(publicationScope(), { key, randomBytes: () => Buffer.alloc(16, 5) });
    const claims = { ...publicationScope(), findings: [finding()] };
    const token = createPublicationToken(claims, {
      key,
      actor: { id: "U_123", login: "reviewer" },
      frozenScope,
    });

    expect(verifyPublicationToken(token, { key }).reportId).toBe("05050505050505050505050505050505");
    for (const changedClaims of [
      {
        ...claims,
        repository: { id: "R_other", nameWithOwner: "other/payments" },
        pullRequest: { ...claims.pullRequest, url: "https://github.com/other/payments/pull/842" },
      },
      { ...claims, pullRequest: { id: "PR_other", number: 843, url: "https://github.com/acme/payments/pull/843" } },
      { ...claims, scope: { ...claims.scope, baseOid: "c".repeat(40) } },
      { ...claims, scope: { ...claims.scope, headOid: "c".repeat(40) } },
    ]) {
      expect(() => createPublicationToken(changedClaims, {
        key,
        actor: { id: "U_123", login: "reviewer" },
        frozenScope,
      })).toThrow("publication scope does not match");
    }
  });

  test("does not expose a production signer for unfrozen model-authored claims", () => {
    expect(() => createPublicationToken(publicationClaims(), { key })).toThrow(
      "frozen publication scope is required",
    );
  });

  test("requires the initial GitHub host, signing key, and comment format versions", () => {
    const claims = { ...publicationClaims(), signingKeyId: "wrong-key" };
    const frozenScope = createFrozenPublicationScope(publicationScope(), { key });

    expect(() => createPublicationToken(claims, {
      key,
      actor: claims.actor,
      frozenScope,
    })).toThrow("invalid publication claims");
  });
});

describe("Review publication provider validation", () => {
  test("does not download patches when no Finding is selected", async () => {
    const calls: string[] = [];
    const provider = createGitHubProvider({ execute: providerExecutor(calls) });

    await provider.inspectPullRequest(publicationClaims(), []);

    expect(calls.some((call) => call.includes("/files?"))).toBeFalse();
  });

  test("downloads patches only after exact actor and scope validation", async () => {
    const calls: string[] = [];
    const provider = createGitHubProvider({ execute: providerExecutor(calls, { headOid: "c".repeat(40) }) });

    await provider.inspectPullRequest(publicationClaims(), [finding()]);

    expect(calls.some((call) => call.includes("/files?"))).toBeFalse();
  });

  test("fails closed on malformed paginated review and comment shapes", async () => {
    const malformedReviewPages = [JSON.stringify({ id: 1 }), JSON.stringify([[{ id: "bad" }]])];
    for (const malformed of malformedReviewPages) {
      let mutations = 0;
      const provider = createGitHubProvider({
        execute: async (args: string[]) => {
          if (args.includes("POST")) mutations += 1;
          if (String(args.at(-1)).endsWith("/reviews")) return malformed;
          return JSON.stringify([[]]);
        },
      });

      await expect(provider.publishReview(derivePublication())).rejects.toMatchObject({ code: "provider_invalid_response" });
      expect(mutations).toBe(0);
    }

    let mutations = 0;
    const claims = publicationClaims();
    const provider = createGitHubProvider({
      execute: async (args: string[]) => {
        if (args.includes("POST")) mutations += 1;
        if (String(args.at(-1)).endsWith("/comments")) return JSON.stringify([[{ path: 7 }]]);
        return JSON.stringify([[
          {
            id: 4,
            html_url: "https://github.com/acme/payments/pull/842#pullrequestreview-4",
            body: `<!-- review-change:publication:v1 report=${claims.reportId} digest=bad -->`,
            commit_id: claims.scope.headOid,
            state: "COMMENTED",
            user: { node_id: claims.actor.id },
          },
        ]]);
      },
    });

    await expect(provider.publishReview(derivePublication())).rejects.toMatchObject({ code: "provider_invalid_response" });
    expect(mutations).toBe(0);
  });
});

test("publication locks serialize one report identity without blocking another", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "publication-locks-"));
  let active = 0;
  let maximum = 0;
  const run = (claims: ReturnType<typeof publicationClaims>) => withPublisherLock(claims, async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await Bun.sleep(20);
    active -= 1;
  }, { home });
  try {
    await Promise.all([
      run(publicationClaims()),
      run({ ...publicationClaims(), reportId: "other-report" }),
    ]);
    expect(maximum).toBe(2);
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("a publication refreshes its lease beyond the stale threshold while another waits", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "publication-lease-"));
  const firstStarted = deferred();
  const releaseFirst = deferred();
  const secondStarted = deferred();
  const releaseSecond = deferred();
  let active = 0;
  let maximum = 0;
  const options = {
    home,
    staleThresholdMs: 30,
    refreshIntervalMs: 5,
    pollIntervalMs: 2,
    waitTimeoutMs: 500,
  };
  const run = (started: ReturnType<typeof deferred>, wait: Promise<void>) => withPublisherLock(publicationClaims(), async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    started.resolve();
    await wait;
    active -= 1;
  }, options);
  try {
    const first = run(firstStarted, releaseFirst.promise);
    await firstStarted.promise;
    const leasePath = path.join(
      home,
      ".review-publication",
      await Array.fromAsync(new Bun.Glob("publisher-*.lock/*.lease").scan({ cwd: path.join(home, ".review-publication") })).then(([entry]) => entry),
    );
    const initialLeaseTime = (await lstat(leasePath)).mtimeMs;
    const second = run(secondStarted, releaseSecond.promise);
    await Bun.sleep(70);
    const refreshedLeaseTime = (await lstat(leasePath)).mtimeMs;
    const secondWasWaiting = await Promise.race([
      secondStarted.promise.then(() => false),
      Bun.sleep(10).then(() => true),
    ]);
    releaseFirst.resolve();
    await first;
    await secondStarted.promise;
    const lockEntriesWhileSecondOwnsIt = await Array.fromAsync(
      new Bun.Glob("publisher-*.lock/*.lease").scan({ cwd: path.join(home, ".review-publication") }),
    );
    releaseSecond.resolve();
    await second;

    expect({
      maximum,
      refreshedLeaseTimeAdvanced: refreshedLeaseTime > initialLeaseTime,
      secondWasWaiting,
      lockEntriesWhileSecondOwnsIt: lockEntriesWhileSecondOwnsIt.length,
    }).toEqual({
      maximum: 1,
      refreshedLeaseTimeAdvanced: true,
      secondWasWaiting: true,
      lockEntriesWhileSecondOwnsIt: 1,
    });
  } finally {
    releaseFirst.resolve();
    releaseSecond.resolve();
    await rm(home, { force: true, recursive: true });
  }
});

test("the inetd parser rejects an oversized same-chunk header with safe HTML", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (chunk) => chunks.push(chunk));
  input.end(`POST / HTTP/1.1\r\nX-Fill: ${"x".repeat(16 * 1024)}\r\n\r\n`);

  await handleInetdRequest({
    input,
    output,
    dispatch: async () => { throw new Error("dispatch must not run"); },
  });

  const response = Buffer.concat(chunks).toString("utf8");
  expect(response).toContain("HTTP/1.1 413 Payload Too Large");
  expect(response).toContain('data-publication-error="request_headers_too_large"');
  expect(response).not.toContain("X-Fill");
});

test("the inetd request deadline ends stalled headers and bodies with a safe response", async () => {
  for (const partialRequest of [
    "POST /api/v1/review-publications HTTP/1.1\r\nHost: 127.0.0.1:4392\r\n",
    "POST /api/v1/review-publications HTTP/1.1\r\nHost: 127.0.0.1:4392\r\nContent-Length: 10\r\n\r\nabc",
  ]) {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (chunk) => chunks.push(chunk));
    input.write(partialRequest);

    await handleInetdRequest({
      input,
      output,
      requestTimeoutMs: 5,
      dispatch: async () => { throw new Error("dispatch must not run"); },
    });

    const response = Buffer.concat(chunks).toString("utf8");
    expect({
      status: response.includes("HTTP/1.1 504 Gateway Timeout"),
      code: response.includes('data-publication-error="request_timeout"'),
      plainLanguage: response.includes("The publication request took too long."),
      inputEnded: input.destroyed,
    }).toEqual({ status: true, code: true, plainLanguage: true, inputEnded: true });
  }
});

function publicationScope() {
  return {
    host: "github.com",
    signingKeyId: "review-publication-v1",
    commentTemplateVersion: 1,
    repository: { id: "R_456", nameWithOwner: "acme/payments" },
    pullRequest: { id: "PR_789", number: 842, url: "https://github.com/acme/payments/pull/842" },
    scope: { baseOid: "a".repeat(40), headOid: "b".repeat(40) },
  };
}

function publicationClaims() {
  return {
    ...publicationScope(),
    reportId: "report-842",
    actor: { id: "U_123", login: "reviewer" },
    findings: [finding()],
  };
}

function finding() {
  return {
    id: "RC-001",
    title: "Duplicate exports can be created",
    body: "Prevent a second export before retrying.",
    path: "src/export.ts",
    line: 8,
    side: "RIGHT",
  };
}

function providerExecutor(calls: string[], overrides: { headOid?: string } = {}) {
  return async (args: string[]) => {
    calls.push(args.join(" "));
    if (args.join(" ") === "api user") return JSON.stringify({ node_id: "U_123", login: "reviewer" });
    if (args[0] === "repo") return JSON.stringify({ id: "R_456", nameWithOwner: "acme/payments" });
    if (args[0] === "pr") return JSON.stringify({
      id: "PR_789",
      number: 842,
      state: "OPEN",
      baseRefOid: "a".repeat(40),
      headRefOid: overrides.headOid ?? "b".repeat(40),
    });
    if (String(args.at(-1)).includes("/files?")) {
      return JSON.stringify([[{ filename: "src/export.ts", patch: "@@ -8,1 +8,1 @@\n-old\n+new" }]]);
    }
    throw new Error(`Unexpected call: ${args.join(" ")}`);
  };
}

function deferred() {
  let resolvePromise!: () => void;
  return {
    promise: new Promise<void>((resolve) => { resolvePromise = resolve; }),
    resolve: () => resolvePromise(),
  };
}

function derivePublication() {
  const claims = publicationClaims();
  return {
    event: "COMMENT",
    commitId: claims.scope.headOid,
    generalComment: "Review found 1 issue worth addressing:\n\n- Duplicate exports can be created",
    comments: claims.findings.map(({ id, path, line, side, body }) => ({ findingId: id, path, line, side, body })),
    scope: claims,
  };
}
