import crypto from "node:crypto";

import { POST_ABORT_RECONCILIATION_TIMEOUT_MS } from "./review-publication-lifetime.mjs";

export function createGitHubReviewPublisher(provider, {
  reconciliationTimeoutMs = POST_ABORT_RECONCILIATION_TIMEOUT_MS,
} = {}) {
  return {
    async reconcileOrPublish(publication, context) {
      const marker = publicationMarker(publication);
      const body = `${publication.generalComment}\n\n${marker}`;
      const expected = {
        actorId: publication.scope.actor.id,
        commitId: publication.commitId,
        state: expectedReviewState(publication.event),
        body,
        comments: publication.comments,
      };
      const existing = await reconcileReviews(await provider.listReviews(publication.scope, context), expected);
      await provider.validateScope?.(publication.scope, context);
      if (existing) return providerOutcome("existing", existing);
      try {
        const created = await provider.createReview({
          event: publication.event,
          commitId: publication.commitId,
          body,
          comments: publication.comments,
          scope: publication.scope,
        }, context);
        return providerOutcome("created", created);
      } catch (error) {
        if (!error?.ambiguous) throw error;
        try {
          return await reconcileAmbiguousPublication({
            context,
            expected,
            provider,
            publication,
            reconciliationTimeoutMs,
          });
        } catch (reconciliationError) {
          if (reconciliationError?.code === "publication_reconciliation_conflict") throw reconciliationError;
          throw unknownPublicationOutcome();
        }
      }
    },
  };
}

async function reconcileAmbiguousPublication({
  context,
  expected,
  provider,
  publication,
  reconciliationTimeoutMs,
}) {
  const controller = new AbortController();
  const reconciliationContext = {
    ...context,
    signal: controller.signal,
    mutation: false,
    markMutationStarted: undefined,
  };
  let rejectDeadline;
  const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
  const timer = setTimeout(() => {
    controller.abort();
    rejectDeadline(unknownPublicationOutcome());
  }, reconciliationTimeoutMs);
  timer.unref?.();
  try {
    const reconciliation = (async () => {
      const reconciled = await reconcileReviews(
        await provider.listReviews(publication.scope, reconciliationContext),
        expected,
      );
      if (!reconciled) throw unknownPublicationOutcome();
      await provider.validateScope?.(publication.scope, reconciliationContext);
      return providerOutcome("existing", reconciled);
    })();
    return await Promise.race([reconciliation, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function unknownPublicationOutcome() {
  return Object.assign(new Error("GitHub could not prove whether the review was created"), {
    code: "publication_outcome_unknown",
    status: 502,
  });
}

function publicationMarker(publication) {
  const canonical = JSON.stringify({
    actor: publication.scope.actor,
    comments: publication.comments,
    commitId: publication.commitId,
    event: publication.event,
    generalComment: publication.generalComment,
    pullRequest: publication.scope.pullRequest,
    reportId: publication.scope.reportId,
    repository: publication.scope.repository,
    scope: publication.scope.scope,
  });
  const digest = crypto.createHash("sha256").update(canonical).digest("hex");
  return `<!-- review-change:publication:v1 report=${publication.scope.reportId} digest=${digest} -->`;
}

async function reconcileReviews(result, expected) {
  const { reviews, complete } = Array.isArray(result)
    ? { reviews: result, complete: true }
    : result;
  if (!complete) throw reconciliationConflict("GitHub pagination did not prove a complete review list");
  if (reviews.length === 0) return null;
  const expectedComments = expected.comments.map(providerCommentShape);
  const matches = reviews.filter((review) => review.actorId === expected.actorId
    && review.commitId === expected.commitId
    && review.state === expected.state
    && review.body === expected.body
    && JSON.stringify(review.comments.map(providerCommentShape)) === JSON.stringify(expectedComments));
  if (reviews.length !== 1 || matches.length !== 1) throw reconciliationConflict();
  return matches[0];
}

function reconciliationConflict(message = "The report has a conflicting GitHub review") {
  return Object.assign(new Error(message), {
    code: "publication_reconciliation_conflict",
    status: 409,
  });
}

function expectedReviewState(event) {
  if (event === "COMMENT") return "COMMENTED";
  throw new Error("Review publication supports only COMMENT reviews");
}

function providerCommentShape(comment) {
  return { path: comment.path, line: comment.line, side: comment.side, body: comment.body };
}

function providerOutcome(disposition, review) {
  return { disposition, reviewId: review.reviewId, url: review.url };
}
