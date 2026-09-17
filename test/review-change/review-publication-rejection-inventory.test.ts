import { afterEach, describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";

import { createGitHubReviewPublisher } from "../../skills/review-change/runtime/review-publication-github.mjs";
import { handleInetdRequest } from "../../skills/review-change/runtime/review-publication-inetd.mjs";
import {
  POST_CREATE_OUTCOME_BRANCHES,
  PRE_CREATE_REJECTION_BRANCHES,
} from "../../skills/review-change/runtime/review-publication-outcomes.mjs";
import { createGitHubProvider } from "../../skills/review-change/runtime/review-publication-provider.mjs";
import { createConfirmationToken } from "../../skills/review-change/runtime/review-publication-protocol.mjs";
import { createReviewPublicationServer } from "../../skills/review-change/runtime/review-publication-server.mjs";
import { derivePublication, publicationClaims } from "./review-publication-fixtures";

const servers: Array<{ close(): Promise<void> }> = [];
afterEach(async () => Promise.all(servers.splice(0).map((server) => server.close())));

describe("pre-create rejection inventory", () => {
  test("classifies every named branch and keeps an unknown post-create outcome separate", () => {
    expect(PRE_CREATE_REJECTION_BRANCHES).toEqual({
      http: [
        "duplicate_http_header", "incomplete_http_request", "invalid_content_length", "invalid_http_framing",
        "invalid_http_header", "invalid_http_request", "invalid_http_request_line", "invalid_publication_endpoint",
        "request_body_too_large", "request_headers_too_large", "request_timeout", "request_too_large",
        "unsupported_transfer_encoding",
      ],
      server: [
        "confirmation_expired", "forbidden_host", "github_actor_changed", "invalid_confirmation_token",
        "inline_location_unverifiable", "invalid_finding_selection", "invalid_inline_location", "invalid_publication", "invalid_publication_claims",
        "invalid_publication_request", "invalid_publication_token", "not_found", "os_confirmation_denied",
        "os_confirmation_dismissed", "os_confirmation_failed", "os_confirmation_invalid_response",
        "os_confirmation_timeout", "os_confirmation_unavailable", "pull_request_scope_changed", "publisher_busy",
        "request_too_large", "unsupported_media_type", "unsupported_publication_protocol",
      ],
      provider: [
        "github_actor_changed", "inline_location_unverifiable", "invalid_inline_location", "provider_authentication_failed", "provider_failed",
        "provider_invalid_response", "provider_output_limit", "provider_permission_denied", "provider_rate_limited",
        "provider_timeout", "provider_unavailable", "publication_reconciliation_conflict",
        "pull_request_scope_changed", "request_timeout",
      ],
    });
    expect(POST_CREATE_OUTCOME_BRANCHES).toEqual(["publication_outcome_unknown"]);
  });

  test("rejects every malformed inherited HTTP shape before dispatch and create-review", async () => {
    const requests = [
      "GET /api/v1/review-publications HTTP/1.1\r\nContent-Length: 0\r\n\r\n",
      "POST /api/v1/review-publications HTTP/1.1\r\nBad Header: x\r\nContent-Length: 0\r\n\r\n",
      "POST /api/v1/review-publications HTTP/1.1\r\nX-Test: a\r\nX-Test: b\r\nContent-Length: 0\r\n\r\n",
      "POST /api/v1/review-publications HTTP/1.1\r\nTransfer-Encoding: chunked\r\nContent-Length: 0\r\n\r\n",
      "POST /api/v1/review-publications HTTP/1.1\r\nContent-Length: nope\r\n\r\n",
      "POST /api/v1/review-publications HTTP/1.1\r\nContent-Length: 0\r\n\r\nextra",
      "POST /api/v1/review-publications HTTP/1.1\r\nContent-Length: 2\r\n\r\na",
    ];
    let dispatches = 0;
    let creates = 0;
    for (const request of requests) {
      const input = new PassThrough();
      const output = new PassThrough();
      input.end(request);
      await handleInetdRequest({
        input,
        output,
        dispatch: async () => {
          dispatches += 1;
          creates += 1;
          throw new Error("Malformed HTTP reached create-review");
        },
      });
    }
    expect({ rows: requests.length, dispatches, creates }).toEqual({ rows: 7, dispatches: 0, creates: 0 });
  });

  test("keeps every server rejection before the shared create-review counter", async () => {
    const claims = publicationClaims();
    const key = Buffer.alloc(32, 6);
    const token = createConfirmationToken({ claims, selectedFindingIds: ["RC-001"] }, { key });
    let creates = 0;
    const rows = PRE_CREATE_REJECTION_BRANCHES.server;
    for (const code of rows) {
      const status = code === "confirmation_expired" || code.includes("token") ? 401 : 422;
      const server = await createReviewPublicationServer({
        key,
        inspectPullRequest: async () => {
          throw Object.assign(new Error(code), { code, status });
        },
        confirmPublication: async () => {},
        publishReview: async () => {
          creates += 1;
          throw new Error("Server rejection reached create-review");
        },
      });
      servers.push(server);
      const response = await fetch(`${server.url}/api/v1/review-publications`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ confirmation_token: token }),
      });
      expect((await response.text()).includes(`data-publication-error="${code}"`)).toBeTrue();
    }
    expect({ rows: rows.length, creates }).toEqual({ rows: 23, creates: 0 });
  });

  test("keeps every provider rejection before the shared create-review counter", async () => {
    let creates = 0;
    for (const code of PRE_CREATE_REJECTION_BRANCHES.provider) {
      const publisher = createGitHubReviewPublisher({
        listReviews: async () => {
          if (code === "publication_reconciliation_conflict") {
            return { complete: false, reviews: [] };
          }
          throw Object.assign(new Error(code), { code, status: 502 });
        },
        createReview: async () => {
          creates += 1;
          throw new Error("Provider rejection reached create-review");
        },
      });
      await expect(publisher.reconcileOrPublish(derivePublication(publicationClaims())))
        .rejects.toMatchObject({ code });
    }
    expect({ rows: PRE_CREATE_REJECTION_BRANCHES.provider.length, creates }).toEqual({ rows: 14, creates: 0 });
  });
});

describe("exact reconciliation conflicts", () => {
  test("fails closed for changed selection, multiple marker matches, and mismatched comments", async () => {
    const claims = publicationClaims();
    const original = derivePublication(claims);
    const changed = { ...original, generalComment: "Review completed. No Findings were selected for publication.", comments: [] };
    const cases = [
      { name: "changed selection under one report identity", candidate: changed, copies: 1, mutate: () => {} },
      { name: "multiple marker matches", candidate: original, copies: 2, mutate: () => {} },
      {
        name: "well-formed mismatched comment coordinates",
        candidate: original,
        copies: 1,
        mutate: (review: any) => { review.comments = review.comments.map((comment: any) => ({ ...comment, line: comment.line + 1 })); },
      },
    ];
    let creates = 0;
    for (const fixture of cases) {
      const captured = await capturedReview(fixture.candidate);
      const reviews = Array.from({ length: fixture.copies }, (_value, index) => ({ ...structuredClone(captured), reviewId: index + 1 }));
      reviews.forEach(fixture.mutate);
      const publisher = createGitHubReviewPublisher({
        listReviews: async () => ({ complete: true, reviews }),
        createReview: async () => { creates += 1; throw new Error("Conflict reached create-review"); },
      });
      await expect(publisher.reconcileOrPublish(original)).rejects.toMatchObject({
        code: "publication_reconciliation_conflict",
        status: 409,
      });
    }
    expect({ rows: cases.length, creates }).toEqual({ rows: 3, creates: 0 });
  });

  test("maps incomplete reconciliation pagination to conflict without provider mutation", async () => {
    const claims = publicationClaims();
    let creates = 0;
    const provider = createGitHubProvider({
      execute: async (args: string[]) => {
        if (args.includes("POST")) {
          creates += 1;
          throw new Error("Incomplete pagination reached create-review");
        }
        if (String(args.at(-1)).endsWith("/reviews")) {
          return { body: JSON.stringify([[]]), paginationComplete: false };
        }
        if (args.join(" ") === "api user") return JSON.stringify({ node_id: claims.actor.id, login: claims.actor.login });
        if (args[0] === "repo") return JSON.stringify(claims.repository);
        if (args[0] === "pr") return JSON.stringify({
          id: claims.pullRequest.id,
          number: claims.pullRequest.number,
          state: "OPEN",
          baseRefOid: claims.scope.baseOid,
          headRefOid: claims.scope.headOid,
        });
        throw new Error(`Unexpected provider request: ${args.join(" ")}`);
      },
    });

    await expect(provider.publishReview(derivePublication(claims))).rejects.toMatchObject({
      code: "publication_reconciliation_conflict",
      status: 409,
    });
    expect(creates).toBe(0);
  });
});

async function capturedReview(publication: ReturnType<typeof derivePublication>) {
  let captured: any;
  const publisher = createGitHubReviewPublisher({
    listReviews: async () => [],
    createReview: async (request: any) => {
      captured = {
        actorId: request.scope.actor.id,
        body: request.body,
        comments: request.comments,
        commitId: request.commitId,
        reviewId: 1,
        state: "COMMENTED",
        url: "https://github.com/acme/payments/pull/842#pullrequestreview-1",
      };
      return captured;
    },
  });
  await publisher.reconcileOrPublish(publication);
  return captured;
}
