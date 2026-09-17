import os from "node:os";
import path from "node:path";

import {
  COMMENT_TEMPLATE_VERSION,
  createFrozenPublicationScope,
  PUBLICATION_GITHUB_HOST,
  PUBLICATION_SIGNING_KEY_ID,
} from "./review-publication-protocol.mjs";
import { loadPublicationKey } from "./review-publication-state.mjs";
import { parseGitHubTarget } from "./github-target.mjs";

export async function createReviewPublicationMetadata(scope, workspace, {
  home = os.homedir(),
  keyLoader = loadPublicationKey,
  randomBytes,
  signerPath = path.join(home, ".local", "bin", "review-publication"),
} = {}) {
  if (scope.kind !== "pull-request") return undefined;
  const identity = publicationIdentity(scope, workspace);
  if (!identity) return undefined;
  if (!path.isAbsolute(signerPath)) throw new Error("Review publication signer path must be absolute");
  const key = await keyLoader({ home });
  return {
    ...identity,
    frozenScope: createFrozenPublicationScope(identity, { key, randomBytes }),
    signerPath,
  };
}

function publicationIdentity(scope, workspace) {
  const providerRepository = workspace.details?.providerRepository;
  const target = parseGitHubTarget(scope.target);
  const [baseOid, headOid] = String(scope.immutableRange ?? "").split("...");
  if (!providerRepository?.id || !scope.pullRequestId || !baseOid || !headOid) return undefined;
  const nameWithOwner = `${providerRepository.owner}/${providerRepository.repository}`;
  return {
    host: PUBLICATION_GITHUB_HOST,
    signingKeyId: PUBLICATION_SIGNING_KEY_ID,
    commentTemplateVersion: COMMENT_TEMPLATE_VERSION,
    repository: { id: providerRepository.id, nameWithOwner },
    pullRequest: {
      id: scope.pullRequestId,
      number: target.number,
      url: `https://${PUBLICATION_GITHUB_HOST}/${nameWithOwner}/pull/${target.number}`,
    },
    scope: { baseOid, headOid },
  };
}
