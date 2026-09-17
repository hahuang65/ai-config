export function validateGitHubReviewUrl(value, claims, reviewId) {
  try {
    if (!Number.isSafeInteger(reviewId) || reviewId <= 0 || typeof value !== "string") throw new Error("invalid review identity");
    const url = new URL(value);
    const expectedPath = `/${claims.repository.nameWithOwner}/pull/${claims.pullRequest.number}`;
    if (url.protocol !== "https:"
      || url.hostname !== "github.com"
      || url.port
      || url.username
      || url.password
      || url.pathname !== expectedPath
      || url.search
      || url.hash !== `#pullrequestreview-${reviewId}`) {
      throw new Error("invalid review URL");
    }
    return value;
  } catch {
    throw Object.assign(new Error("provider_invalid_response"), {
      code: "provider_invalid_response",
      status: 502,
      ambiguous: false,
    });
  }
}
