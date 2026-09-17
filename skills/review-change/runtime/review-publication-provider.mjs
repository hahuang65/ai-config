import { spawn } from "node:child_process";

import { parseGitHubTarget } from "./github-target.mjs";
import {
  resolveGitHubCliPath,
  validateGitHubCliPath,
} from "./review-publication-executable.mjs";
import { createGitHubReviewPublisher } from "./review-publication-github.mjs";
import { verifyInlineLocations } from "./review-publication-inline-locations.mjs";
import {
  PROCESS_TERMINATION_GRACE_MS,
  PROVIDER_CALL_TIMEOUT_MS,
} from "./review-publication-lifetime.mjs";
import { validateGitHubReviewUrl } from "./review-publication-review-url.mjs";

export const DEFAULT_PROVIDER_TIMEOUT_MS = PROVIDER_CALL_TIMEOUT_MS;
const OUTPUT_LIMIT = 2 * 1024 * 1024;
const GITHUB_REVIEW_STATES = new Set(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED", "PENDING"]);

export { resolveGitHubCliPath };

export function createGitHubProvider({
  execute,
  ghPath = process.env.REVIEW_PUBLICATION_GH,
  environment = process.env,
  spawnProcess = spawn,
  timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
  outputLimit = OUTPUT_LIMIT,
  terminationGraceMs = PROCESS_TERMINATION_GRACE_MS,
} = {}) {
  const run = execute ?? createCommandExecutor({
    executable: validateGitHubCliPath(ghPath), environment, spawnProcess, timeoutMs, outputLimit, terminationGraceMs,
  });
  const provider = {
    getActor: async (context) => validateActor(parseProviderJson(await run(["api", "user"], "", context))),
    preparePullRequest: (target, context) => preparePullRequest(target, run, context),
    inspectPullRequest: (claims, selectedFindings = claims.findings, context) => inspectPullRequest(claims, selectedFindings, run, context),
  };
  const publisher = createGitHubReviewPublisher({
    listReviews: (claims, context) => listReviews(claims, run, context),
    validateScope: async (claims, context) => assertExpectedScope(claims, await readPullRequestScope(claims, run, context)),
    createReview: (request, context) => createReview(request, run, context),
  });
  return {
    ...provider,
    publishReview: async (publication, context) => {
      const outcome = await publisher.reconcileOrPublish(publication, context);
      return { reviewId: outcome.reviewId, url: outcome.url, disposition: outcome.disposition };
    },
  };
}

async function preparePullRequest(target, execute, context) {
  const parsedTarget = parseGitHubTarget(target);
  if (parsedTarget.kind !== "pull-request") throw new Error("Review publication requires an exact GitHub pull request");
  const requestedRepository = `${parsedTarget.owner}/${parsedTarget.repository}`;
  const [repositoryValue, pullRequestValue] = await Promise.all([
    execute(["repo", "view", requestedRepository, "--json", "id,nameWithOwner"], "", context),
    execute(["pr", "view", String(parsedTarget.number), "--repo", requestedRepository, "--json", "id,number,url,baseRefOid,headRefOid"], "", context),
  ]);
  const repository = validateRepository(parseProviderJson(repositoryValue));
  const pullRequest = validatePreparedPullRequest(parseProviderJson(pullRequestValue), repository, parsedTarget.number);
  return {
    repository,
    pullRequest: { id: pullRequest.id, number: pullRequest.number, url: pullRequest.url },
    scope: { baseOid: pullRequest.baseRefOid, headOid: pullRequest.headRefOid },
  };
}

async function inspectPullRequest(claims, selectedFindings, execute, context) {
  const current = await readPullRequestScope(claims, execute, context);
  if (!matchesExpectedScope(claims, current) || selectedFindings.length === 0) return current;
  const repositoryName = claims.repository.nameWithOwner;
  const endpoint = `repos/${repositoryName}/pulls/${claims.pullRequest.number}/files?per_page=100`;
  const files = parsePages(await execute(["api", "--paginate", "--slurp", endpoint], "", context), validateChangedFile);
  const rechecked = await readPullRequestScope(claims, execute, context);
  if (!matchesExpectedScope(claims, rechecked)) return rechecked;
  await verifyInlineLocations(selectedFindings, files, () => readCompletePullRequestDiff(claims, execute, context));
  return rechecked;
}

async function readPullRequestScope(claims, execute, context) {
  const repositoryName = claims.repository.nameWithOwner;
  const [actorValue, repositoryValue, pullRequestValue] = await Promise.all([
    execute(["api", "user"], "", context),
    execute(["repo", "view", repositoryName, "--json", "id,nameWithOwner"], "", context),
    execute(["pr", "view", String(claims.pullRequest.number), "--repo", repositoryName, "--json", "id,number,state,baseRefOid,headRefOid"], "", context),
  ]);
  const actor = validateActor(parseProviderJson(actorValue));
  const repository = validateRepository(parseProviderJson(repositoryValue));
  const pullRequest = validatePullRequest(parseProviderJson(pullRequestValue));
  return {
    actor,
    repository,
    pullRequest: { ...claims.pullRequest, id: pullRequest.id, number: pullRequest.number, state: pullRequest.state },
    scope: { baseOid: pullRequest.baseRefOid, headOid: pullRequest.headRefOid },
  };
}

function assertExpectedScope(expected, current) {
  if (current.actor.id !== expected.actor.id || current.actor.login !== expected.actor.login) {
    throw Object.assign(new Error("github_actor_changed"), {
      code: "github_actor_changed",
      status: 403,
      expectedActor: expected.actor.login,
      currentActor: current.actor.login,
    });
  }
  if (!matchesExpectedScope(expected, current)) {
    throw Object.assign(new Error("pull_request_scope_changed"), {
      code: "pull_request_scope_changed",
      status: 409,
    });
  }
}

function matchesExpectedScope(expected, current) {
  return current.actor.id === expected.actor.id
    && current.actor.login === expected.actor.login
    && current.repository.id === expected.repository.id
    && current.repository.nameWithOwner === expected.repository.nameWithOwner
    && current.pullRequest.id === expected.pullRequest.id
    && current.pullRequest.number === expected.pullRequest.number
    && current.pullRequest.state === "OPEN"
    && current.scope.baseOid === expected.scope.baseOid
    && current.scope.headOid === expected.scope.headOid;
}

async function listReviews(claims, execute, context) {
  const prefix = `repos/${claims.repository.nameWithOwner}/pulls/${claims.pullRequest.number}`;
  const reviewPages = parsePaginatedPages(
    await execute(["api", "--paginate", "--slurp", `${prefix}/reviews`], "", context),
    (review) => validateReviewEntry(review, claims),
  );
  const marker = `report=${claims.reportId} digest=`;
  const candidates = reviewPages.entries.filter((review) => review.body.includes(marker));
  if (candidates.length !== 1) {
    return { complete: reviewPages.complete, reviews: candidates.map((review) => reviewSummary(review, [])) };
  }
  const [review] = candidates;
  const commentPages = parsePaginatedPages(
    await execute(["api", "--paginate", "--slurp", `${prefix}/reviews/${review.id}/comments`], "", context),
    validateReviewComment,
  );
  return {
    complete: reviewPages.complete && commentPages.complete,
    reviews: [reviewSummary(review, commentPages.entries.map(normalizeProviderComment))],
  };
}

async function createReview(request, execute, context) {
  const claims = request.scope;
  const endpoint = `repos/${claims.repository.nameWithOwner}/pulls/${claims.pullRequest.number}/reviews`;
  const payload = {
    event: request.event,
    commit_id: request.commitId,
    body: request.body,
    comments: request.comments.map(({ path: filePath, line, side, body }) => ({ path: filePath, line, side, body })),
  };
  const response = await execute(
    ["api", "--method", "POST", endpoint, "--input", "-"],
    JSON.stringify(payload),
    { ...context, mutation: true },
  );
  try {
    const review = parseJson(response);
    validateCreatedReviewIdentity(review, claims);
    return { reviewId: review.id, url: review.html_url, body: request.body, comments: request.comments };
  } catch {
    throw providerError("provider_invalid_response", 502, true);
  }
}

function validateCreatedReviewIdentity(review, claims) {
  if (!review) throw new Error("Invalid review identity");
  validateGitHubReviewUrl(review.html_url, claims, review.id);
}

function readCompletePullRequestDiff(claims, execute, context) {
  const endpoint = `repos/${claims.repository.nameWithOwner}/pulls/${claims.pullRequest.number}`;
  return execute(["api", "-H", "Accept: application/vnd.github.diff", endpoint], "", context);
}

function parsePages(value, validateEntry) {
  return parsePaginatedPages(value, validateEntry).entries;
}

function parsePaginatedPages(value, validateEntry) {
  const response = typeof value === "object" && value !== null
    ? value
    : { body: value, paginationComplete: true };
  const pages = parseProviderJson(response.body);
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw providerError("provider_invalid_response", 502, false);
  }
  return {
    complete: response.paginationComplete === true,
    entries: pages.flatMap((page) => page.map(validateEntry)),
  };
}

function validateActor(value) {
  if (!value || !safeText(value.node_id) || !safeText(value.login)) throw providerError("provider_invalid_response", 502, false);
  return { id: String(value.node_id), login: value.login };
}
function validateRepository(value) {
  if (!value || !safeText(value.id) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.nameWithOwner ?? "")) {
    throw providerError("provider_invalid_response", 502, false);
  }
  return { id: value.id, nameWithOwner: value.nameWithOwner };
}
function validatePullRequest(value) {
  if (!value || !safeText(value.id) || !Number.isSafeInteger(value.number) || value.number <= 0
    || !["OPEN", "CLOSED", "MERGED"].includes(value.state) || !oid(value.baseRefOid) || !oid(value.headRefOid)) {
    throw providerError("provider_invalid_response", 502, false);
  }
  return value;
}
function validatePreparedPullRequest(value, repository, expectedNumber) {
  const expectedUrl = `https://github.com/${repository.nameWithOwner}/pull/${expectedNumber}`;
  if (!value || !safeText(value.id) || value.number !== expectedNumber || value.url !== expectedUrl
    || !oid(value.baseRefOid) || !oid(value.headRefOid)) {
    throw providerError("provider_invalid_response", 502, false);
  }
  return value;
}
function validateChangedFile(value) {
  if (!value || !safeText(value.filename) || (value.patch !== undefined && typeof value.patch !== "string")) {
    throw providerError("provider_invalid_response", 502, false);
  }
  return { filename: value.filename, patch: value.patch };
}
function validateReviewEntry(value, claims) {
  if (!value || typeof value.body !== "string" || !oid(value.commit_id) || !safeText(value.user?.node_id)
    || !GITHUB_REVIEW_STATES.has(value.state)) {
    throw providerError("provider_invalid_response", 502, false);
  }
  validateGitHubReviewUrl(value.html_url, claims, value.id);
  return value;
}
function validateReviewComment(value) {
  const line = value?.line ?? value?.original_line;
  const side = value?.side ?? "RIGHT";
  if (!value || !safeText(value.path) || !Number.isSafeInteger(line) || line < 1
    || !["LEFT", "RIGHT"].includes(side) || typeof value.body !== "string") {
    throw providerError("provider_invalid_response", 502, false);
  }
  return { path: value.path, line, side, body: value.body };
}
function reviewSummary(review, comments) {
  return {
    reviewId: review.id,
    url: review.html_url,
    actorId: review.user.node_id,
    commitId: review.commit_id,
    state: review.state,
    body: review.body,
    comments,
  };
}
function normalizeProviderComment(comment) { return comment; }
function parseProviderJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw providerError("provider_invalid_response", 502, false);
  }
}
function parseJson(value) { return JSON.parse(value); }
function safeText(value) { return typeof value === "string" && value.length > 0 && value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value); }
function oid(value) { return typeof value === "string" && /^[0-9a-f]{40,64}$/.test(value); }

function createCommandExecutor({ executable, environment, spawnProcess, timeoutMs, outputLimit, terminationGraceMs }) {
  return (args, input = "", context = {}) => new Promise((resolve, reject) => {
    if (context.signal?.aborted) return reject(cancelledProviderError(context.mutation));
    let child;
    try {
      child = spawnProcess(executable, args, {
        env: { ...environment, GH_HOST: "github.com", GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      return reject(providerError("provider_unavailable", 502, false));
    }
    if (context.mutation) context.markMutationStarted?.();
    const stdout = [];
    const stderr = [];
    let outputSize = 0;
    let termination = "";
    let settled = false;
    let forceTimer;
    let timeoutTimer;
    const cancel = () => terminate("cancelled");
    const settle = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer); clearTimeout(forceTimer);
      context.signal?.removeEventListener("abort", cancel);
      if (error) reject(error); else resolve(value);
    };
    const terminationError = () => {
      if (termination === "cancelled") return cancelledProviderError(context.mutation);
      if (termination === "timeout") return providerError("provider_timeout", 504, Boolean(context.mutation));
      return providerError("provider_output_limit", 502, Boolean(context.mutation));
    };
    const terminate = (reason) => {
      if (termination) return;
      termination = reason;
      try { child.kill("SIGTERM"); } catch {}
      forceTimer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
        child.stdin.destroy?.(); child.stdout.destroy?.(); child.stderr.destroy?.(); child.unref?.();
        settle(terminationError());
      }, terminationGraceMs);
    };
    context.signal?.addEventListener("abort", cancel, { once: true });
    timeoutTimer = setTimeout(() => terminate("timeout"), timeoutMs);
    if (context.signal?.aborted) cancel();
    const collect = (target) => (chunk) => {
      outputSize += chunk.length;
      if (outputSize > outputLimit) terminate("output-limit"); else target.push(chunk);
    };
    child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr));
    child.once("error", () => settle(providerError("provider_unavailable", 502, Boolean(context.mutation))));
    child.once("close", (status) => {
      if (status === 0 && !termination) return settle(null, Buffer.concat(stdout).toString("utf8"));
      settle(termination ? terminationError() : classifyProviderFailure(
        Buffer.concat(stderr).toString("utf8"),
        Boolean(context.mutation),
      ));
    });
    child.stdin.on?.("error", () => {});
    try {
      child.stdin.end(input);
    } catch {
      settle(providerError("provider_unavailable", 502, Boolean(context.mutation)));
    }
  });
}

function classifyProviderFailure(stderr, mutation) {
  const httpStatus = Number(/\bHTTP\s+([1-5][0-9]{2})\b/i.exec(stderr)?.[1]);
  if (mutation && httpStatus >= 500) return providerError("provider_failed", 502, true);
  if (/rate.?limit|secondary rate/i.test(stderr)) return providerError("provider_rate_limited", 429, false);
  if (/authentication|authenticate|bad credentials|requires authentication/i.test(stderr)) return providerError("provider_authentication_failed", 401, false);
  if (/forbidden|permission|resource not accessible/i.test(stderr)) return providerError("provider_permission_denied", 403, false);
  if (/validation failed|unprocessable|invalid.*line/i.test(stderr)) return providerError("invalid_inline_location", 409, false);
  if (httpStatus >= 100) return providerError("provider_failed", 502, false);
  return providerError("provider_failed", 502, mutation);
}
function cancelledProviderError(mutation) {
  return providerError("request_timeout", 504, Boolean(mutation));
}
function providerError(code, status, ambiguous) { return Object.assign(new Error(code), { code, status, ambiguous }); }
