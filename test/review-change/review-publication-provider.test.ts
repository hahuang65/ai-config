import { describe, expect, test } from "bun:test";

import { createGitHubReviewPublisher } from "../../skills/review-change/runtime/review-publication-github.mjs";
import { createGitHubProvider } from "../../skills/review-change/runtime/review-publication-provider.mjs";
import { currentPullRequest, derivePublication, publicationClaims } from "./review-publication-fixtures";

describe("Review publication provider", () => {
  test("uses bounded GitHub argument arrays for scope inspection and one review mutation", async () => {
    const calls: Array<{ args: string[]; input: string }> = [];
    const claims = publicationClaims();
    const execute = async (args: string[], input = "") => {
      calls.push({ args, input });
      if (args.join(" ") === "api user") return JSON.stringify({ node_id: "U_123", login: "reviewer" });
      if (args[0] === "repo") return JSON.stringify({ id: "R_456", nameWithOwner: "acme/payments" });
      if (args[0] === "pr") return JSON.stringify({ id: "PR_789", number: claims.pullRequest.number, state: "OPEN", baseRefOid: "a".repeat(40), headRefOid: "b".repeat(40) });
      if (String(args.at(-1)).includes("/files?")) return JSON.stringify([[{ filename: "src/export/export-runner.ts", patch: "@@ -84,1 +84,1 @@\n-old\n+new" }]]);
      if (args.includes("--method")) return JSON.stringify({ id: 194205, html_url: "https://github.com/acme/payments/pull/842#pullrequestreview-194205" });
      return JSON.stringify([[]]);
    };
    const provider = createGitHubProvider({ execute });

    const inspected = await provider.inspectPullRequest(claims);
    const published = await provider.publishReview(derivePublication(claims));
    const listCall = calls.find((call) => call.args.includes("--paginate"));
    const mutationCall = calls.find((call) => call.args.includes("POST"));

    expect({
      inspected,
      published,
      paginatedAndSlurped: listCall?.args.includes("--slurp"),
      mutationUsesInput: mutationCall?.args.slice(-2),
      payload: {
        ...JSON.parse(mutationCall?.input ?? "{}"),
        body: /<!-- review-change:publication:/.test(JSON.parse(mutationCall?.input ?? "{}").body),
      },
    }).toEqual({
      inspected: currentPullRequest(claims),
      published: { reviewId: 194205, url: "https://github.com/acme/payments/pull/842#pullrequestreview-194205", disposition: "created" },
      paginatedAndSlurped: true,
      mutationUsesInput: ["--input", "-"],
      payload: {
        event: "COMMENT",
        commit_id: claims.scope.headOid,
        body: true,
        comments: [{ path: "src/export/export-runner.ts", line: 84, side: "RIGHT", body: claims.findings[0].body }],
      },
    });
  });

  test("maps malformed successful actor, repository, and pull-request JSON to one response error", async () => {
    const claims = publicationClaims();
    const validResponses = {
      actor: JSON.stringify({ node_id: claims.actor.id, login: claims.actor.login }),
      repository: JSON.stringify(claims.repository),
      pullRequest: JSON.stringify({
        id: claims.pullRequest.id,
        number: claims.pullRequest.number,
        url: claims.pullRequest.url,
        state: "OPEN",
        baseRefOid: claims.scope.baseOid,
        headRefOid: claims.scope.headOid,
      }),
    };
    const operations = [
      { malformed: "actor", invoke: (provider: any) => provider.getActor() },
      { malformed: "repository", invoke: (provider: any) => provider.preparePullRequest(claims.pullRequest.url) },
      { malformed: "pullRequest", invoke: (provider: any) => provider.preparePullRequest(claims.pullRequest.url) },
      { malformed: "actor", invoke: (provider: any) => provider.inspectPullRequest(claims, []) },
      { malformed: "repository", invoke: (provider: any) => provider.inspectPullRequest(claims, []) },
      { malformed: "pullRequest", invoke: (provider: any) => provider.inspectPullRequest(claims, []) },
    ];

    for (const operation of operations) {
      const provider = createGitHubProvider({
        execute: async (args: string[]) => {
          if (args.join(" ") === "api user") return operation.malformed === "actor" ? "not json" : validResponses.actor;
          if (args[0] === "repo") return operation.malformed === "repository" ? "not json" : validResponses.repository;
          if (args[0] === "pr") return operation.malformed === "pullRequest" ? "not json" : validResponses.pullRequest;
          throw new Error(`Unexpected GitHub read: ${args.join(" ")}`);
        },
      });
      await expect(operation.invoke(provider)).rejects.toMatchObject({
        code: "provider_invalid_response",
        status: 502,
        ambiguous: false,
      });
    }
  });

  test("rechecks exact scope after changed-file pagination", async () => {
    const claims = publicationClaims();
    let pullRequestReads = 0;
    let fileReads = 0;
    const provider = createGitHubProvider({
      execute: async (args: string[]) => {
        if (args.join(" ") === "api user") return JSON.stringify({ node_id: claims.actor.id, login: claims.actor.login });
        if (args[0] === "repo") return JSON.stringify(claims.repository);
        if (args[0] === "pr") {
          pullRequestReads += 1;
          return JSON.stringify({
            id: claims.pullRequest.id,
            number: claims.pullRequest.number,
            state: "OPEN",
            baseRefOid: claims.scope.baseOid,
            headRefOid: pullRequestReads === 1 ? claims.scope.headOid : "c".repeat(40),
          });
        }
        if (String(args.at(-1)).includes("/files?")) {
          fileReads += 1;
          return JSON.stringify([[{ filename: claims.findings[0].path, patch: "@@ -84,1 +84,1 @@\n-old\n+new" }]]);
        }
        throw new Error(`Unexpected GitHub read: ${args.join(" ")}`);
      },
    });

    const current = await provider.inspectPullRequest(claims, claims.findings);

    expect({ headOid: current.scope.headOid, pullRequestReads, fileReads }).toEqual({
      headOid: "c".repeat(40),
      pullRequestReads: 2,
      fileReads: 1,
    });
  });

  test("rechecks exact scope after existing-review pagination before mutation", async () => {
    const claims = publicationClaims();
    let changedDuringReviewRead = false;
    let mutations = 0;
    const provider = createGitHubProvider({
      execute: async (args: string[]) => {
        if (String(args.at(-1)).endsWith("/reviews")) {
          changedDuringReviewRead = true;
          return JSON.stringify([[]]);
        }
        if (args.join(" ") === "api user") return JSON.stringify({ node_id: claims.actor.id, login: claims.actor.login });
        if (args[0] === "repo") return JSON.stringify(claims.repository);
        if (args[0] === "pr") return JSON.stringify({
          id: claims.pullRequest.id,
          number: claims.pullRequest.number,
          state: "OPEN",
          baseRefOid: claims.scope.baseOid,
          headRefOid: changedDuringReviewRead ? "c".repeat(40) : claims.scope.headOid,
        });
        if (args.includes("POST")) {
          mutations += 1;
          return JSON.stringify({ id: 194205, html_url: "https://github.com/acme/payments/pull/842#pullrequestreview-194205" });
        }
        throw new Error(`Unexpected GitHub request: ${args.join(" ")}`);
      },
    });

    await expect(provider.publishReview(derivePublication(claims))).rejects.toMatchObject({
      code: "pull_request_scope_changed",
      status: 409,
    });
    expect(mutations).toBe(0);
  });

  test("uses the same strict review URL rules for created and reconciled reviews", async () => {
    const invalidUrls = [
      "https://github.com/acme/other/pull/842#pullrequestreview-194205",
      "https://github.com/acme/payments/pull/843#pullrequestreview-194205",
      "https://github.com/acme/payments/pull/842#pullrequestreview-999",
      "https://github.com:8443/acme/payments/pull/842#pullrequestreview-194205",
      "https://reviewer@github.com/acme/payments/pull/842#pullrequestreview-194205",
      "https://github.com/acme/payments/pull/842?view=1#pullrequestreview-194205",
      "https://github.com/acme/payments/pull/842#discussion",
    ];
    for (const source of ["created", "reconciled"] as const) {
      for (const invalidUrl of invalidUrls) {
        const { provider, mutationCount } = await providerWithReviewUrl(source, invalidUrl);
        await expect(provider.publishReview(derivePublication(publicationClaims()))).rejects.toMatchObject({
          code: source === "created" ? "publication_outcome_unknown" : "provider_invalid_response",
          status: 502,
        });
        expect(mutationCount()).toBe(1);
      }
    }
  });

  test("flattens paginated GitHub reviews before exact reconciliation", async () => {
    const claims = publicationClaims();
    const publication = derivePublication(claims);
    let mutationCount = 0;
    let createdPayload: any;
    const provider = createGitHubProvider({
      execute: async (args: string[], input = "") => {
        if (args.join(" ") === "api user") return JSON.stringify({ node_id: claims.actor.id, login: claims.actor.login });
        if (args[0] === "repo") return JSON.stringify(claims.repository);
        if (args[0] === "pr") return JSON.stringify({
          id: claims.pullRequest.id,
          number: claims.pullRequest.number,
          state: "OPEN",
          baseRefOid: claims.scope.baseOid,
          headRefOid: claims.scope.headOid,
        });
        if (args.includes("POST")) {
          mutationCount += 1;
          createdPayload = JSON.parse(input);
          return JSON.stringify({ id: 194205, html_url: "https://github.com/acme/payments/pull/842#pullrequestreview-194205" });
        }
        if (!createdPayload) return JSON.stringify([[]]);
        if (String(args.at(-1)).endsWith("/comments")) return JSON.stringify([createdPayload.comments]);
        return JSON.stringify([[
          {
            id: 194205,
            html_url: "https://github.com/acme/payments/pull/842#pullrequestreview-194205",
            body: createdPayload.body,
            commit_id: createdPayload.commit_id,
            state: "COMMENTED",
            user: { node_id: publicationClaims().actor.id },
          },
        ]]);
      },
    });

    await provider.publishReview(publication);
    expect({ outcome: await provider.publishReview(publication), mutationCount }).toEqual({
      outcome: {
        reviewId: 194205,
        url: "https://github.com/acme/payments/pull/842#pullrequestreview-194205",
        disposition: "existing",
      },
      mutationCount: 1,
    });
  });

  async function providerWithReviewUrl(source: "created" | "reconciled", invalidUrl: string) {
    const claims = publicationClaims();
    let createdPayload: any;
    let reviewUrl = source === "created" ? invalidUrl : "https://github.com/acme/payments/pull/842#pullrequestreview-194205";
    let mutations = 0;
    const provider = createGitHubProvider({
      execute: async (args: string[], input = "") => {
        if (args.join(" ") === "api user") return JSON.stringify({ node_id: claims.actor.id, login: claims.actor.login });
        if (args[0] === "repo") return JSON.stringify(claims.repository);
        if (args[0] === "pr") return JSON.stringify({
          id: claims.pullRequest.id,
          number: claims.pullRequest.number,
          state: "OPEN",
          baseRefOid: claims.scope.baseOid,
          headRefOid: claims.scope.headOid,
        });
        if (args.includes("POST")) {
          mutations += 1;
          createdPayload = JSON.parse(input);
          return JSON.stringify({ id: 194205, html_url: reviewUrl });
        }
        if (String(args.at(-1)).endsWith("/comments")) return JSON.stringify([createdPayload.comments]);
        if (String(args.at(-1)).endsWith("/reviews")) {
          return JSON.stringify([createdPayload ? [{
            id: 194205,
            html_url: reviewUrl,
            body: createdPayload.body,
            commit_id: createdPayload.commit_id,
            state: "COMMENTED",
            user: { node_id: claims.actor.id },
          }] : []]);
        }
        throw new Error(`Unexpected GitHub request: ${args.join(" ")}`);
      },
    });
    if (source === "reconciled") {
      await provider.publishReview(derivePublication(claims));
      reviewUrl = invalidUrl;
    }
    return { provider, mutationCount: () => mutations };
  }

  test("does not reconcile a copied marker from a different actor", async () => {
    const reviews: any[] = [];
    let mutations = 0;
    const publisher = createGitHubReviewPublisher({
      listReviews: async () => reviews,
      createReview: async (request: any) => {
        mutations += 1;
        const review = {
          reviewId: mutations,
          url: `review-${mutations}`,
          actorId: "U_OTHER",
          commitId: request.commitId,
          state: "COMMENTED",
          body: request.body,
          comments: request.comments,
        };
        reviews.splice(0, reviews.length, review);
        return review;
      },
    });
    const publication = derivePublication(publicationClaims());

    await publisher.reconcileOrPublish(publication);
    await expect(publisher.reconcileOrPublish(publication)).rejects.toMatchObject({
      code: "publication_reconciliation_conflict",
      status: 409,
    });
    expect(mutations).toBe(1);
  });

  test("reconciles an ambiguous provider response before returning", async () => {
    const reviews: any[] = [];
    const publication = derivePublication(publicationClaims());
    const publisher = createGitHubReviewPublisher({
      listReviews: async () => reviews,
      createReview: async (request: any) => {
        reviews.push({
          reviewId: 194205,
          url: "https://github.com/acme/payments/pull/842#pullrequestreview-194205",
          actorId: request.scope.actor.id,
          commitId: request.commitId,
          state: "COMMENTED",
          body: request.body,
          comments: request.comments,
        });
        throw Object.assign(new Error("connection ended"), { ambiguous: true });
      },
    });

    expect(await publisher.reconcileOrPublish(publication)).toEqual({
      disposition: "existing",
      reviewId: 194205,
      url: "https://github.com/acme/payments/pull/842#pullrequestreview-194205",
    });
  });

  test("reconciles a repeated exact publication to one provider review", async () => {
    const reviews: any[] = [];
    let mutations = 0;
    const publisher = createGitHubReviewPublisher({
      listReviews: async () => reviews,
      createReview: async (request: any) => {
        mutations += 1;
        const review = {
          reviewId: 194205,
          url: "https://github.com/acme/payments/pull/842#pullrequestreview-194205",
          actorId: request.scope.actor.id,
          commitId: request.commitId,
          state: "COMMENTED",
          body: request.body,
          comments: request.comments,
        };
        reviews.push(review);
        return review;
      },
    });
    const review = derivePublication(publicationClaims());

    const first = await publisher.reconcileOrPublish(review);
    const second = await publisher.reconcileOrPublish(review);

    expect({
      first,
      second,
      mutations,
      markerCount: (reviews[0].body.match(/<!-- review-change:publication:/g) ?? []).length,
      visibleGeneral: reviews[0].body.replace(/\n\n<!-- review-change:publication:[^>]+ -->$/, ""),
    }).toEqual({
      first: { disposition: "created", reviewId: 194205, url: reviews[0].url },
      second: { disposition: "existing", reviewId: 194205, url: reviews[0].url },
      mutations: 1,
      markerCount: 1,
      visibleGeneral: review.generalComment,
    });
  });
});
