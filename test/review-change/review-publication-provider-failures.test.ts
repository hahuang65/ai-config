import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { createGitHubReviewPublisher } from "../../skills/review-change/runtime/review-publication-github.mjs";
import { createGitHubProvider } from "../../skills/review-change/runtime/review-publication-provider.mjs";
import { derivePublication, publicationClaims } from "./review-publication-fixtures";

test("preserves definite create-review HTTP rejections without reconciliation or blind retry", async () => {
  const cases = [
    { stderr: "gh: authentication failed (HTTP 401)", code: "provider_authentication_failed", status: 401 },
    { stderr: "gh: Resource not accessible by integration (HTTP 403)", code: "provider_permission_denied", status: 403 },
    { stderr: "gh: API rate limit exceeded (HTTP 403)", code: "provider_rate_limited", status: 429 },
    { stderr: "gh: Validation Failed: invalid line (HTTP 422)", code: "invalid_inline_location", status: 409 },
    { stderr: "gh: explicit provider rejection (HTTP 400)", code: "provider_failed", status: 502 },
  ];
  for (const fixture of cases) {
    const scenario = createStageScenario(() => failedChild(fixture.stderr));

    await expect(scenario.publish()).rejects.toMatchObject({
      ambiguous: false,
      code: fixture.code,
      status: fixture.status,
    });
    expect({ fixture: fixture.code, lists: scenario.listCount(), mutations: scenario.mutationCount() }).toEqual({
      fixture: fixture.code,
      lists: 1,
      mutations: 1,
    });
  }
});

test("reconciles create-review HTTP 500 through 504 without retrying the mutation", async () => {
  for (const status of [500, 502, 503, 504]) {
    for (const outcome of ["exact", "conflict", "unknown"] as const) {
      const scenario = createHttpFailureScenario(status, outcome);
      const publication = scenario.publish();

      if (outcome === "exact") {
        await expect(publication).resolves.toMatchObject({ disposition: "existing", reviewId: 194205 });
      } else {
        await expect(publication).rejects.toMatchObject({
          code: outcome === "conflict" ? "publication_reconciliation_conflict" : "publication_outcome_unknown",
        });
      }
      expect({ status, outcome, lists: scenario.listCount(), mutations: scenario.mutationCount() }).toEqual({
        status,
        outcome,
        lists: 2,
        mutations: 1,
      });
    }
  }
});

test("reconciles transport loss after create-review starts without retrying the mutation", async () => {
  let mutationMarked = false;
  const scenario = createStageScenario(() => {
    const child = childProcessFixture();
    queueMicrotask(() => {
      expect(mutationMarked).toBeTrue();
      child.emit("error", new Error("post-spawn transport failure"));
    });
    return child;
  });

  await expect(scenario.publish({
    markMutationStarted: () => { mutationMarked = true; },
  })).rejects.toMatchObject({ code: "publication_outcome_unknown" });
  expect({ lists: scenario.listCount(), mutations: scenario.mutationCount(), mutationMarked }).toEqual({
    lists: 2,
    mutations: 1,
    mutationMarked: true,
  });
});

test("bounds post-abort reconciliation with a fresh deadline", async () => {
  let listCalls = 0;
  let requestSignal: AbortSignal | undefined;
  let reconciliationSignal: AbortSignal | undefined;
  const publisher = createGitHubReviewPublisher({
    listReviews: async (_scope: unknown, context: any) => {
      listCalls += 1;
      if (listCalls === 1) return [];
      reconciliationSignal = context.signal;
      return new Promise(() => {});
    },
    createReview: async (_request: unknown, context: any) => {
      requestSignal = context.signal;
      throw Object.assign(new Error("ambiguous mutation"), { ambiguous: true });
    },
  }, { reconciliationTimeoutMs: 5 });

  await expect(publisher.reconcileOrPublish(derivePublication(publicationClaims()), {
    signal: AbortSignal.abort(),
  })).rejects.toMatchObject({ code: "publication_outcome_unknown" });
  expect({
    listCalls,
    freshSignal: reconciliationSignal !== requestSignal,
    reconciliationAborted: reconciliationSignal?.aborted,
  }).toEqual({ listCalls: 2, freshSignal: true, reconciliationAborted: true });
});

test("reconciles create-review timeout, output truncation, and malformed success without blind retry", async () => {
  const fixtures = [
    {
      name: "timeout",
      options: { timeoutMs: 5, terminationGraceMs: 5 },
      child: () => childProcessFixture(),
    },
    {
      name: "output limit",
      options: { outputLimit: 1_024, terminationGraceMs: 5 },
      child: () => {
        const child = childProcessFixture();
        queueMicrotask(() => child.stdout.write("x".repeat(2_048)));
        return child;
      },
    },
    {
      name: "malformed success",
      options: {},
      child: () => successfulChild("not json"),
    },
  ];
  for (const fixture of fixtures) {
    const scenario = createStageScenario(fixture.child, fixture.options);

    await expect(scenario.publish()).rejects.toMatchObject({ code: "publication_outcome_unknown" });
    expect({ fixture: fixture.name, lists: scenario.listCount(), mutations: scenario.mutationCount() }).toEqual({
      fixture: fixture.name,
      lists: 2,
      mutations: 1,
    });
  }
});

function createHttpFailureScenario(status: number, outcome: "exact" | "conflict" | "unknown") {
  const claims = publicationClaims();
  let lists = 0;
  let mutations = 0;
  let createdPayload: any;
  const provider = createGitHubProvider({
    ghPath: process.execPath,
    spawnProcess: (_executable, args) => {
      if (args.includes("POST")) {
        mutations += 1;
        const child = childProcessFixture();
        const input: Buffer[] = [];
        child.stdin.on("data", (chunk) => input.push(chunk));
        child.stdin.on("finish", () => {
          createdPayload = JSON.parse(Buffer.concat(input).toString("utf8"));
          child.stderr.write(`gh: server failure (HTTP ${status})`);
          child.emit("close", 1);
        });
        return child;
      }
      const endpoint = String(args.at(-1));
      if (endpoint.endsWith("/reviews")) {
        lists += 1;
        if (lists === 1 || outcome === "unknown") return successfulChild(JSON.stringify([[]]));
        const body = outcome === "conflict" ? `${createdPayload.body}\nconflict` : createdPayload.body;
        return successfulChild(JSON.stringify([[
          {
            id: 194205,
            html_url: "https://github.com/acme/payments/pull/842#pullrequestreview-194205",
            body,
            commit_id: createdPayload.commit_id,
            state: "COMMENTED",
            user: { node_id: claims.actor.id },
          },
        ]]));
      }
      if (endpoint.endsWith("/comments")) return successfulChild(JSON.stringify([createdPayload.comments]));
      return successfulChild(providerResponse(args, claims));
    },
  });
  return {
    listCount: () => lists,
    mutationCount: () => mutations,
    publish: () => provider.publishReview(derivePublication(claims)),
  };
}

function createStageScenario(
  mutationChild: () => ReturnType<typeof childProcessFixture>,
  options: Record<string, number> = {},
) {
  const claims = publicationClaims();
  let lists = 0;
  let mutations = 0;
  const provider = createGitHubProvider({
    ghPath: process.execPath,
    ...options,
    spawnProcess: (_executable, args) => {
      if (args.includes("POST")) {
        mutations += 1;
        return mutationChild();
      }
      if (String(args.at(-1)).endsWith("/reviews")) lists += 1;
      return successfulChild(providerResponse(args, claims));
    },
  });
  return {
    listCount: () => lists,
    mutationCount: () => mutations,
    publish: (context?: object) => provider.publishReview(derivePublication(claims), context),
  };
}

function providerResponse(args: string[], claims: ReturnType<typeof publicationClaims>) {
  const endpoint = String(args.at(-1));
  if (endpoint.endsWith("/reviews")) return JSON.stringify([[]]);
  if (args.join(" ") === "api user") {
    return JSON.stringify({ node_id: claims.actor.id, login: claims.actor.login });
  }
  if (args[0] === "repo") return JSON.stringify(claims.repository);
  if (args[0] === "pr") {
    return JSON.stringify({
      id: claims.pullRequest.id,
      number: claims.pullRequest.number,
      state: "OPEN",
      baseRefOid: claims.scope.baseOid,
      headRefOid: claims.scope.headOid,
    });
  }
  throw new Error(`Unexpected provider request: ${args.join(" ")}`);
}

function failedChild(stderr: string) {
  const child = childProcessFixture();
  queueMicrotask(() => {
    child.stderr.write(stderr);
    child.emit("close", 1);
  });
  return child;
}

function successfulChild(output: string) {
  const child = childProcessFixture();
  queueMicrotask(() => {
    child.stdout.write(output);
    child.emit("close", 0);
  });
  return child;
}

function childProcessFixture() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill(signal: string): boolean;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  return child;
}
