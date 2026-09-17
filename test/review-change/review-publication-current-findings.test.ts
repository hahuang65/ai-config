import { describe, expect, test } from "bun:test";

import { createGitHubReviewPublisher } from "../../skills/review-change/runtime/review-publication-github.mjs";
import { renderErrorPage } from "../../skills/review-change/runtime/review-publication-html.mjs";
import { createGitHubProvider } from "../../skills/review-change/runtime/review-publication-provider.mjs";
import { currentPullRequest, derivePublication, publicationClaims } from "./review-publication-fixtures";

describe("Review publication diff locations", () => {
  test("accepts right-side content beginning with repeated plus signs and preserves later line numbers", async () => {
    const claims = publicationClaims();
    claims.findings = [
      { ...claims.findings[0], id: "RPC-033-A", line: 84 },
      { ...claims.findings[0], id: "RPC-033-B", line: 86 },
    ];
    const provider = providerForPatch(claims, [
      "+++ b/src/export/export-runner.ts",
      "@@ -84,1 +84,3 @@",
      "+++added source text",
      " unchanged source text",
      "+later source text",
    ].join("\n"));

    expect(await provider.inspectPullRequest(claims)).toEqual(currentPullRequest(claims));
  });

  test("accepts left-side content beginning with repeated minus signs and preserves later line numbers", async () => {
    const claims = publicationClaims();
    claims.findings = [
      { ...claims.findings[0], id: "RPC-033-A", line: 84, side: "LEFT" },
      { ...claims.findings[0], id: "RPC-033-B", line: 86, side: "LEFT" },
    ];
    const provider = providerForPatch(claims, [
      "--- a/src/export/export-runner.ts",
      "@@ -84,3 +84,1 @@",
      "---removed source text",
      " unchanged source text",
      "-later source text",
    ].join("\n"));

    expect(await provider.inspectPullRequest(claims)).toEqual(currentPullRequest(claims));
  });
});

describe("Review publication reconciliation", () => {
  test("accepts only COMMENTED reviews for a requested COMMENT review", async () => {
    const publication = derivePublication(publicationClaims());
    const expectedRequest = await captureReviewRequest(publication);

    for (const [state, accepted] of [["COMMENTED", true], ["APPROVED", false], ["CHANGES_REQUESTED", false]] as const) {
      let mutations = 0;
      const provider = createGitHubProvider({
        execute: async (args: string[]) => {
          const endpoint = String(args.at(-1));
          if (args.includes("POST")) {
            mutations += 1;
            throw new Error("A copied marker must not create another review");
          }
          if (endpoint.endsWith("/comments")) return JSON.stringify([expectedRequest.comments]);
          if (endpoint.endsWith("/reviews")) return JSON.stringify([[providerReview(expectedRequest, 194205, state)]]);
          if (args.join(" ") === "api user") return JSON.stringify({ node_id: publication.scope.actor.id, login: publication.scope.actor.login });
          if (args[0] === "repo") return JSON.stringify(publication.scope.repository);
          if (args[0] === "pr") return JSON.stringify({
            id: publication.scope.pullRequest.id,
            number: publication.scope.pullRequest.number,
            state: "OPEN",
            baseRefOid: publication.scope.scope.baseOid,
            headRefOid: publication.scope.scope.headOid,
          });
          throw new Error(`Unexpected provider request: ${args.join(" ")}`);
        },
      });

      if (accepted) {
        await expect(provider.publishReview(publication)).resolves.toMatchObject({ disposition: "existing" });
      } else {
        await expect(provider.publishReview(publication)).rejects.toMatchObject({
          code: "publication_reconciliation_conflict",
          status: 409,
        });
      }
      expect(mutations).toBe(0);
    }
  });

  test("rejects an unknown GitHub review state before reading comment details", async () => {
    const publication = derivePublication(publicationClaims());
    const expectedRequest = await captureReviewRequest(publication);
    let commentReads = 0;
    const provider = createGitHubProvider({
      execute: async (args: string[]) => {
        const endpoint = String(args.at(-1));
        if (endpoint.endsWith("/comments")) {
          commentReads += 1;
          return JSON.stringify([[]]);
        }
        if (endpoint.endsWith("/reviews")) return JSON.stringify([[providerReview(expectedRequest, 194205, "UNKNOWN")]]);
        throw new Error(`Unexpected provider request: ${args.join(" ")}`);
      },
    });

    await expect(provider.publishReview(publication)).rejects.toMatchObject({ code: "provider_invalid_response" });
    expect(commentReads).toBe(0);
  });

  test("returns a multiple-marker conflict without starting comment-detail processes", async () => {
    const publication = derivePublication(publicationClaims());
    const expectedRequest = await captureReviewRequest(publication);
    let commentReads = 0;
    let mutations = 0;
    const provider = createGitHubProvider({
      execute: async (args: string[]) => {
        const endpoint = String(args.at(-1));
        if (args.includes("POST")) mutations += 1;
        if (endpoint.endsWith("/comments")) {
          commentReads += 1;
          return JSON.stringify([expectedRequest.comments]);
        }
        if (endpoint.endsWith("/reviews")) return JSON.stringify([[
          providerReview(expectedRequest, 194205, "COMMENTED"),
          providerReview(expectedRequest, 194206, "COMMENTED"),
        ]]);
        throw new Error(`Unexpected provider request: ${args.join(" ")}`);
      },
    });

    await expect(provider.publishReview(publication)).rejects.toMatchObject({
      code: "publication_reconciliation_conflict",
      status: 409,
    });
    expect({ commentReads, mutations }).toEqual({ commentReads: 0, mutations: 0 });
  });
});

describe("Review publication provider error pages", () => {
  const phaseAwareOutcomes = [
    ["provider_unavailable", "GitHub CLI is unavailable.", "Install or repair GitHub CLI"],
    ["provider_output_limit", "GitHub returned too much data.", "Check GitHub status"],
    ["provider_timeout", "GitHub did not respond in time.", "Check your connection and GitHub status"],
    ["provider_failed", "GitHub could not complete the request.", "Check your connection and GitHub status"],
  ] as const;

  for (const phase of ["confirmation", "publication"] as const) {
    for (const [code, heading, correction] of phaseAwareOutcomes) {
      test(`shows the definite ${phase} outcome for ${code}`, () => {
        const page = renderErrorPage(code, { phase });

        expect({
          heading: page.includes(`<h1 tabindex="-1" data-initial-focus>${heading}</h1>`),
          noPublication: page.includes("No comments were posted"),
          correction: page.includes(correction),
          phase: page.includes(phase === "confirmation" ? "confirmation could not finish" : "final publication stopped before GitHub could accept the review"),
          reconciliation: /marker reconciliation/i.test(page),
        }).toEqual({ heading: true, noPublication: true, correction: true, phase: true, reconciliation: false });
      });
    }
  }

  test("shows reconciliation instructions only for an outcome that became unknown after mutation started", () => {
    const page = renderErrorPage("publication_outcome_unknown", { phase: "publication" });

    expect({
      mayBePosted: page.includes("may have been posted"),
      noPublicationClaim: page.includes("No comments were posted"),
      reconciliation: /marker reconciliation/i.test(page),
      retry: page.includes("Submit this same confirmed review again"),
    }).toEqual({ mayBePosted: true, noPublicationClaim: false, reconciliation: true, retry: true });
  });

  test("explains how to request a new confirmation when the previous confirmation expires", () => {
    const page = renderErrorPage("confirmation_expired", { phase: "publication" });

    expect({
      heading: page.includes("Confirmation expired."),
      noPublication: page.includes("Nothing was posted"),
      duration: page.includes("fifteen-minute confirmation expired"),
      nextStep: page.includes("Return to the still-open report and request a new confirmation."),
      rerunInstruction: page.includes("Review change"),
    }).toEqual({ heading: true, noPublication: true, duration: true, nextStep: true, rerunInstruction: false });
  });

  const otherOutcomes = [
    ["provider_authentication_failed", "GitHub sign-in failed.", "Sign in with GitHub CLI, then try again."],
    ["provider_permission_denied", "GitHub refused the review.", "Ask for pull-request review permission, then try again."],
    ["provider_rate_limited", "GitHub is temporarily limiting requests.", "Wait for the GitHub limit to reset, then try again."],
    ["provider_invalid_response", "GitHub returned an unreadable response.", "Check GitHub status, then run Review change again."],
    ["invalid_inline_location", "A Finding no longer matches the pull request.", "Run Review change again. The Finding will not be moved."],
    ["publication_reconciliation_conflict", "This report conflicts with an existing review.", "Inspect the pull request, then run Review change again if another review is needed."],
  ] as const;

  for (const [code, heading, action] of otherOutcomes) {
    test(`shows the safe visible outcome for ${code}`, () => {
      const page = renderErrorPage(code);

      expect({
        headingCount: (page.match(/<h[1-6]\b/g) ?? []).length,
        heading: page.includes(`<h1 tabindex="-1" data-initial-focus>${heading}</h1>`),
        action: page.includes(`<strong>${action}</strong>`),
        successClaim: page.includes("Review posted.") || page.includes('data-review-publication-state="posted"'),
      }).toEqual({ headingCount: 1, heading: true, action: true, successClaim: false });
    });
  }
});

function providerForPatch(claims: ReturnType<typeof publicationClaims>, patch: string) {
  return createGitHubProvider({
    execute: async (args: string[]) => {
      if (args.join(" ") === "api user") return JSON.stringify({ node_id: claims.actor.id, login: claims.actor.login });
      if (args[0] === "repo") return JSON.stringify(claims.repository);
      if (args[0] === "pr") return JSON.stringify({
        id: claims.pullRequest.id,
        number: claims.pullRequest.number,
        state: "OPEN",
        baseRefOid: claims.scope.baseOid,
        headRefOid: claims.scope.headOid,
      });
      if (String(args.at(-1)).includes("/files?")) {
        return JSON.stringify([[{ filename: claims.findings[0].path, patch }]]);
      }
      throw new Error(`Unexpected provider request: ${args.join(" ")}`);
    },
  });
}

async function captureReviewRequest(publication: ReturnType<typeof derivePublication>) {
  let captured: any;
  const publisher = createGitHubReviewPublisher({
    listReviews: async () => [],
    createReview: async (request: any) => {
      captured = request;
      return { reviewId: 1, url: "review-1" };
    },
  });
  await publisher.reconcileOrPublish(publication);
  return captured;
}

function providerReview(request: any, id: number, state: string) {
  return {
    id,
    html_url: `https://github.com/acme/payments/pull/842#pullrequestreview-${id}`,
    body: request.body,
    commit_id: request.commitId,
    state,
    user: { node_id: request.scope.actor.id },
  };
}
