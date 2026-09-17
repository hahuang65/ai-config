import crypto from "node:crypto";

import {
  createPublicationToken,
  PUBLICATION_TOKEN_VERSION,
} from "../../skills/review-change/runtime/review-publication-protocol.mjs";

export function publicationClaims() {
  return {
    reportId: "08".repeat(16),
    host: "github.com",
    signingKeyId: "review-publication-v1",
    commentTemplateVersion: 1,
    actor: { id: "U_123", login: "reviewer" },
    repository: { id: "R_456", nameWithOwner: "acme/payments" },
    pullRequest: { id: "PR_789", number: 842, url: "https://github.com/acme/payments/pull/842" },
    scope: { baseOid: "a".repeat(40), headOid: "b".repeat(40) },
    findings: [{
      id: "RC-001",
      title: "Retry can create duplicate exports",
      body: "Guard the retry transition before creating a new export.",
      path: "src/export/export-runner.ts",
      line: 84,
      side: "RIGHT",
    }],
  };
}

export function signTestPublicationClaims(
  claims: ReturnType<typeof publicationClaims>,
  { key }: { key: Buffer },
) {
  const { reportId, actor, findings, ...identity } = claims;
  const payload = Buffer.from(JSON.stringify({
    version: PUBLICATION_TOKEN_VERSION,
    audience: "review-publication-scope",
    reportId,
    ...identity,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", key).update(payload).digest("base64url");
  return createPublicationToken({ ...identity, findings }, {
    key,
    actor,
    frozenScope: `${payload}.${signature}`,
  });
}

export function derivePublication(claims: ReturnType<typeof publicationClaims>) {
  return {
    event: "COMMENT",
    commitId: claims.scope.headOid,
    generalComment: "Review found 1 issue worth addressing:\n\n- Retry can create duplicate exports",
    comments: claims.findings.map((finding) => ({
      findingId: finding.id,
      path: finding.path,
      line: finding.line,
      side: finding.side,
      body: finding.body,
    })),
    scope: claims,
  };
}

export function currentPullRequest(claims: ReturnType<typeof publicationClaims>) {
  return {
    actor: claims.actor,
    repository: claims.repository,
    pullRequest: { ...claims.pullRequest, state: "OPEN" },
    scope: claims.scope,
  };
}
