import http from "node:http";

import {
  PUBLICATION_SCRIPT_HASH,
  renderConfirmationPage,
  renderErrorPage,
  renderSuccessPage,
} from "./review-publication-html.mjs";
import { CLEANUP_TIMEOUT_MS } from "./review-publication-lifetime.mjs";
import { validateGitHubReviewUrl } from "./review-publication-review-url.mjs";
import {
  createConfirmationToken,
  deriveReview,
  MAX_PUBLICATION_REQUEST_BODY_BYTES,
  verifyConfirmationToken,
  verifyPublicationToken,
} from "./review-publication-protocol.mjs";

const CONFIRMATION_PATH = "/api/v1/review-publication-confirmations";
const PUBLICATION_PATH = "/api/v1/review-publications";

export async function createReviewPublicationServer(dependencies) {
  const activeRequests = new Set();
  const server = http.createServer((request, response) => {
    const context = createRequestContext(request, dependencies.requestContext);
    const operation = handleRequest(request, response, dependencies, context)
      .catch((error) => {
        if (!response.destroyed) renderPublicationError(response, error, requestPhase(request.url));
      })
      .finally(context.dispose);
    activeRequests.add(operation);
    operation.then(
      () => activeRequests.delete(operation),
      () => activeRequests.delete(operation),
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: (timeoutMs = CLEANUP_TIMEOUT_MS) => closeServer(server, activeRequests, timeoutMs),
  };
}

async function closeServer(server, activeRequests, timeoutMs) {
  await Promise.all(activeRequests);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.closeAllConnections?.();
      server.close();
      reject(new Error("Review publication server cleanup timed out"));
    }, timeoutMs);
    timer.unref?.();
    server.close((error) => {
      clearTimeout(timer);
      if (error) reject(error); else resolve();
    });
  });
}

export function renderPublicationError(response, error, phase = "confirmation") {
  const status = error?.status ?? 422;
  const code = error?.code ?? "invalid_publication";
  renderHtml(response, status, renderErrorPage(code, { ...error, phase }));
}

async function handleRequest(request, response, dependencies, context) {
  if (dependencies.expectedHost && request.headers.host !== dependencies.expectedHost) {
    throw httpError(403, "forbidden_host");
  }
  if (request.method !== "POST") throw httpError(404, "not_found");
  const mediaType = String(request.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/x-www-form-urlencoded") throw httpError(415, "unsupported_media_type");
  const form = new URLSearchParams(await readBody(request));
  if (request.url === CONFIRMATION_PATH) return confirmPublication(form, response, dependencies, context);
  if (request.url === PUBLICATION_PATH) return publishReview(form, response, dependencies, context);
  throw httpError(404, "not_found");
}

async function confirmPublication(form, response, dependencies, context) {
  verifyFormFields(form, new Set(["publication_token", "selected_finding_id"]), "publication_token");
  const claims = verifyPublicationToken(form.get("publication_token"), { key: dependencies.key });
  const selectedFindingIds = form.getAll("selected_finding_id");
  const review = deriveReview(claims, selectedFindingIds);
  verifyCurrentScope(claims, await dependencies.inspectPullRequest(claims, review.findings, context));
  const confirmationToken = createConfirmationToken({ claims, selectedFindingIds }, { key: dependencies.key });
  renderHtml(response, 200, renderConfirmationPage(claims, review, confirmationToken));
}

async function publishReview(form, response, dependencies, context) {
  verifyFormFields(form, new Set(["confirmation_token"]), "confirmation_token");
  const { claims, selectedFindingIds } = verifyConfirmationToken(form.get("confirmation_token"), { key: dependencies.key });
  const lock = dependencies.withPublicationLock ?? ((_claims, task) => task());
  const providerReview = await lock(claims, async () => {
    const review = deriveReview(claims, selectedFindingIds);
    verifyCurrentScope(claims, await dependencies.inspectPullRequest(claims, review.findings, context));
    if (typeof dependencies.confirmPublication !== "function") {
      throw httpError(503, "os_confirmation_unavailable");
    }
    await dependencies.confirmPublication(claims, review, context);
    const publication = publicationFromReview(claims, review);
    return validateProviderReview(await dependencies.publishReview(publication, context), claims);
  }, context);
  const status = providerReview.disposition === "existing" ? 200 : 201;
  renderHtml(response, status, renderSuccessPage(claims, providerReview, {
    cleanupTrouble: context.hasCleanupTrouble(),
  }));
}

function createRequestContext(request, parent) {
  const controller = new AbortController();
  let cleanupTrouble = false;
  const abort = () => controller.abort();
  request.once("aborted", abort);
  const signal = parent?.signal
    ? AbortSignal.any([parent.signal, controller.signal])
    : controller.signal;
  return {
    signal,
    markMutationStarted: parent?.markMutationStarted ?? (() => {}),
    markCleanupTrouble: () => {
      cleanupTrouble = true;
      parent?.markCleanupTrouble?.();
    },
    hasCleanupTrouble: () => cleanupTrouble,
    dispose: () => request.off("aborted", abort),
  };
}

function requestPhase(url) {
  return url === PUBLICATION_PATH ? "publication" : "confirmation";
}

function verifyFormFields(form, allowed, requiredSingleton) {
  if ([...form.keys()].some((name) => !allowed.has(name))
    || form.getAll(requiredSingleton).length !== 1) {
    throw httpError(422, "invalid_publication_request");
  }
}

function publicationFromReview(claims, review) {
  return {
    event: "COMMENT",
    commitId: claims.scope.headOid,
    generalComment: review.generalComment,
    comments: review.findings.map((finding) => ({
      findingId: finding.id,
      path: finding.path,
      line: finding.line,
      side: finding.side,
      body: finding.body,
    })),
    scope: claims,
  };
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_PUBLICATION_REQUEST_BODY_BYTES) throw httpError(413, "request_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size).toString("utf8");
}

function verifyCurrentScope(claims, current) {
  const actorMatches = current.actor.id === claims.actor.id && current.actor.login === claims.actor.login;
  if (!actorMatches) {
    throw httpError(403, "github_actor_changed", {
      expectedActor: claims.actor.login,
      currentActor: current.actor.login,
    });
  }
  const scopeMatches = current.repository.id === claims.repository.id
    && current.repository.nameWithOwner === claims.repository.nameWithOwner
    && current.pullRequest.id === claims.pullRequest.id
    && current.pullRequest.number === claims.pullRequest.number
    && current.pullRequest.state === "OPEN"
    && current.scope.baseOid === claims.scope.baseOid
    && current.scope.headOid === claims.scope.headOid;
  if (!scopeMatches) throw httpError(409, "pull_request_scope_changed");
}

function validateProviderReview(review, claims) {
  validateGitHubReviewUrl(review?.url, claims, review?.reviewId);
  return review;
}

function renderHtml(response, status, body) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${PUBLICATION_SCRIPT_HASH}'; form-action 'self'; frame-ancestors 'none'`,
    "content-type": "text/html; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
  });
  response.end(body);
}

function httpError(status, code, details = {}) {
  return Object.assign(new Error(code), { status, code, ...details });
}
