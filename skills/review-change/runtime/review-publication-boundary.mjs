import {
  COMMENT_TEMPLATE_VERSION,
  createFrozenPublicationScope,
  createPublicationToken,
  deriveReview,
  PUBLICATION_GITHUB_HOST,
  PUBLICATION_SIGNING_KEY_ID,
} from "./review-publication-protocol.mjs";
import { createGitHubProvider } from "./review-publication-provider.mjs";
import { loadPublicationKey } from "./review-publication-state.mjs";

export const RENDER_PUBLICATION_PROVIDER_ROUNDS = 1;

export async function prepareFrozenPublicationScope(target, {
  home,
  keyLoader = loadPublicationKey,
  provider = createGitHubProvider(),
  randomBytes,
} = {}) {
  const providerIdentity = await provider.preparePullRequest(target);
  const identity = {
    host: PUBLICATION_GITHUB_HOST,
    signingKeyId: PUBLICATION_SIGNING_KEY_ID,
    commentTemplateVersion: COMMENT_TEMPLATE_VERSION,
    ...providerIdentity,
  };
  const key = await keyLoader({ home });
  return {
    ...identity,
    frozenScope: createFrozenPublicationScope(identity, { key, randomBytes }),
  };
}

export async function renderPreparedPublication(prepared, findings, dependencies = {}) {
  const { frozenScope, ...identity } = prepared;
  return renderPublicationClaims({ ...identity, findings }, {
    ...dependencies,
    frozenScope,
  });
}

export async function renderPublicationClaims(submittedClaims, {
  frozenScope,
  home,
  keyLoader = loadPublicationKey,
  provider = createGitHubProvider(),
} = {}) {
  const [actor, key, currentIdentity] = await Promise.all([
    provider.getActor(),
    keyLoader({ home }),
    provider.preparePullRequest(submittedClaims.pullRequest.url),
  ]);
  const publicationToken = createPublicationToken(submittedClaims, {
    actor,
    frozenScope,
    key,
  });
  assertCurrentIdentity(submittedClaims, currentIdentity);
  const claims = { ...submittedClaims, actor, reportId: "trusted-by-frozen-scope" };
  const review = deriveReview(claims, submittedClaims.findings.map((finding) => finding.id));
  return { claims, publicationToken, review };
}

function assertCurrentIdentity(expected, current) {
  const identityValues = (value) => [
    value.repository?.id,
    value.repository?.nameWithOwner,
    value.pullRequest?.id,
    value.pullRequest?.number,
    value.pullRequest?.url,
    value.scope?.baseOid,
    value.scope?.headOid,
  ];
  if (JSON.stringify(identityValues(current)) === JSON.stringify(identityValues(expected))) return;
  throw Object.assign(new Error("The pull request base or head changed; run Review change again"), {
    code: "pull_request_scope_changed",
    status: 409,
  });
}
