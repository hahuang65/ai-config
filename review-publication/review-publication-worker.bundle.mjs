#!/usr/bin/env node
// Managed by ai-config: review-publication

// skills/review-change/bin/review-publication.mjs
import { lstat as lstat3, open as open3, readFile, realpath, rm } from "node:fs/promises";
import path5 from "node:path";

// skills/review-change/runtime/review-publication-protocol.mjs
import crypto from "node:crypto";
var PUBLICATION_TOKEN_VERSION = 1;
var PUBLICATION_GITHUB_HOST = "github.com";
var PUBLICATION_SIGNING_KEY_ID = "review-publication-v1";
var COMMENT_TEMPLATE_VERSION = 1;
var MAX_PUBLICATION_REQUEST_BODY_BYTES = 256 * 1024;
var MAX_FINDINGS = 50;
var MAX_FINDING_BODY_LENGTH = 1e4;
var ENCODED_SHA256_SIGNATURE_LENGTH = 43;
var WORST_CASE_CONFIRMATION_EXPIRY = Number.MAX_SAFE_INTEGER;
function createPublicationToken(claims, { key, actor, frozenScope } = {}) {
  if (!frozenScope)
    throw protocolError("frozen_publication_scope_is_required");
  const validatedClaims = claimsFromFrozenScope(claims, actor, frozenScope, key);
  const payload = encode({
    version: PUBLICATION_TOKEN_VERSION,
    audience: "review-publication",
    ...validatedClaims
  });
  validateRequestEnvelopes(payload, validatedClaims);
  return `${payload}.${signature(payload, key)}`;
}
function verifyPublicationToken(token, { key }) {
  const decoded = verifySignedToken(token, key, "invalid_publication_token");
  if (decoded.version !== PUBLICATION_TOKEN_VERSION || decoded.audience !== "review-publication") {
    throw protocolError("unsupported_publication_protocol");
  }
  return validateClaims(decoded);
}
function deriveReview(claims, selectedFindingIds) {
  const selectedIds = new Set(selectedFindingIds);
  if (selectedIds.size !== selectedFindingIds.length)
    throw protocolError("invalid_finding_selection");
  const findings = claims.findings.filter((finding) => selectedIds.has(finding.id));
  if (findings.length !== selectedIds.size)
    throw protocolError("invalid_finding_selection");
  const count = findings.length;
  const generalComment = count === 0 ? "Review completed. No Findings were selected for publication." : `Review found ${count} ${count === 1 ? "issue" : "issues"} worth addressing:

${findings.map((finding) => `- ${finding.title}`).join(`
`)}`;
  return { generalComment, findings };
}
function createConfirmationToken(payload, { key, now = Date.now() } = {}) {
  const token = createSignedToken(confirmationPayload(payload, now + 15 * 60 * 1000), key);
  validateFinalPublicationEnvelope(token);
  return token;
}
function verifyConfirmationToken(token, { key, now = Date.now() } = {}) {
  const decoded = verifySignedToken(token, key, "invalid_confirmation_token");
  if (decoded.version !== PUBLICATION_TOKEN_VERSION || decoded.audience !== "review-publication-confirmation") {
    throw protocolError("invalid_confirmation_token");
  }
  if (!Number.isFinite(decoded.expiresAt) || decoded.expiresAt < now)
    throw protocolError("confirmation_expired");
  return {
    claims: validateClaims(decoded.claims),
    selectedFindingIds: validateSelectedIds(decoded.selectedFindingIds)
  };
}
function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function claimsFromFrozenScope(claims, actor, frozenScope, key) {
  const trusted = verifyFrozenPublicationScope(frozenScope, key);
  const submitted = validatePublicationIdentity(claims);
  if (canonicalIdentity(submitted) !== canonicalIdentity(validatePublicationIdentity(trusted))) {
    throw protocolError("publication_scope_does_not_match");
  }
  if (claims.reportId !== undefined || claims.actor !== undefined) {
    throw protocolError("invalid_publication_claims");
  }
  return validateClaims({
    ...trusted,
    actor,
    findings: claims.findings
  });
}
function verifyFrozenPublicationScope(token, key) {
  const decoded = verifySignedToken(token, key, "invalid_publication_scope");
  if (decoded.version !== PUBLICATION_TOKEN_VERSION || decoded.audience !== "review-publication-scope") {
    throw protocolError("invalid_publication_scope");
  }
  if (!/^[0-9a-f]{32}$/.test(decoded.reportId ?? ""))
    throw protocolError("invalid_publication_scope");
  return { reportId: decoded.reportId, ...validatePublicationIdentity(decoded) };
}
function validateClaims(input) {
  if (!safeText(input?.reportId, 128) || !Array.isArray(input?.findings) || input.findings.length > MAX_FINDINGS) {
    throw protocolError("invalid_publication_claims");
  }
  if (!safeIdentity(input.actor))
    throw protocolError("invalid_publication_claims");
  const identity = validatePublicationIdentity(input);
  const findings = normalizePublicationFindings(input.findings);
  return {
    reportId: input.reportId,
    ...identity,
    actor: { id: input.actor.id, login: input.actor.login },
    findings
  };
}
function validatePublicationIdentity(input) {
  if (input?.host !== PUBLICATION_GITHUB_HOST || input?.signingKeyId !== PUBLICATION_SIGNING_KEY_ID || input?.commentTemplateVersion !== COMMENT_TEMPLATE_VERSION || !safeRepository(input?.repository) || !safePullRequest(input?.pullRequest, input?.repository) || !oid(input?.scope?.baseOid) || !oid(input?.scope?.headOid)) {
    throw protocolError("invalid_publication_claims");
  }
  return {
    host: PUBLICATION_GITHUB_HOST,
    signingKeyId: PUBLICATION_SIGNING_KEY_ID,
    commentTemplateVersion: COMMENT_TEMPLATE_VERSION,
    repository: { id: input.repository.id, nameWithOwner: input.repository.nameWithOwner },
    pullRequest: {
      id: input.pullRequest.id,
      number: input.pullRequest.number,
      url: input.pullRequest.url
    },
    scope: { baseOid: input.scope.baseOid, headOid: input.scope.headOid }
  };
}
function validateSelectedIds(value) {
  if (!Array.isArray(value) || value.some((id) => !safeText(id, 64)))
    throw protocolError("invalid_confirmation_token");
  return value;
}
function validateRequestEnvelopes(payload, claims) {
  const token = `${payload}.${"x".repeat(ENCODED_SHA256_SIGNATURE_LENGTH)}`;
  const confirmationForm = new URLSearchParams({ publication_token: token });
  const selectedFindingIds = claims.findings.map((finding) => finding.id);
  for (const id of selectedFindingIds)
    confirmationForm.append("selected_finding_id", id);
  const worstFinalToken = placeholderSignedToken(confirmationPayload({ claims, selectedFindingIds }, WORST_CASE_CONFIRMATION_EXPIRY));
  const requests = [confirmationForm.toString(), new URLSearchParams({ confirmation_token: worstFinalToken }).toString()];
  if (requests.some((request) => Buffer.byteLength(request) > MAX_PUBLICATION_REQUEST_BODY_BYTES)) {
    throw protocolError("invalid_publication_claims");
  }
}
function validateFinalPublicationEnvelope(token) {
  const form = new URLSearchParams({ confirmation_token: token });
  if (Buffer.byteLength(form.toString()) > MAX_PUBLICATION_REQUEST_BODY_BYTES) {
    throw protocolError("invalid_publication_claims");
  }
}
function confirmationPayload(payload, expiresAt) {
  return {
    version: PUBLICATION_TOKEN_VERSION,
    audience: "review-publication-confirmation",
    expiresAt,
    ...payload
  };
}
function placeholderSignedToken(value) {
  return `${encode(value)}.${"x".repeat(ENCODED_SHA256_SIGNATURE_LENGTH)}`;
}
function verifySignedToken(token, key, errorCode) {
  const [payload, suppliedSignature, extra] = String(token ?? "").split(".");
  if (!payload || !suppliedSignature || extra)
    throw protocolError(errorCode);
  const expectedSignature = signature(payload, key);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    throw protocolError(errorCode);
  }
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw protocolError(errorCode);
  }
}
function normalizePublicationFindings(findings) {
  if (!Array.isArray(findings) || findings.length > MAX_FINDINGS)
    throw protocolError("invalid_publication_claims");
  const normalized = findings.map(validateFinding);
  if (new Set(normalized.map((finding) => finding.id)).size !== normalized.length) {
    throw protocolError("invalid_publication_claims");
  }
  return normalized;
}
function validateFinding(finding) {
  if (!safeText(finding?.id, 64) || !safeText(finding?.title, 500))
    throw protocolError("invalid_publication_claims");
  const body = normalizeFindingBody(finding?.body);
  if (!safeText(finding.path, 1024) || finding.path.startsWith("/") || finding.path.split("/").includes(".."))
    throw protocolError("invalid_publication_claims");
  if (!Number.isInteger(finding.line) || finding.line < 1 || !["LEFT", "RIGHT"].includes(finding.side))
    throw protocolError("invalid_publication_claims");
  return { id: finding.id, title: finding.title, body, path: finding.path, line: finding.line, side: finding.side };
}
function safeIdentity(value) {
  return safeText(value?.id, 128) && safeText(value?.login, 128);
}
function safeRepository(value) {
  return safeText(value?.id, 128) && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value?.nameWithOwner ?? "");
}
function safePullRequest(value, repository) {
  return safeText(value?.id, 128) && Number.isInteger(value?.number) && value.number > 0 && value.url === `https://${PUBLICATION_GITHUB_HOST}/${repository.nameWithOwner}/pull/${value.number}`;
}
function normalizeFindingBody(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_FINDING_BODY_LENGTH) {
    throw protocolError("invalid_publication_claims");
  }
  const normalized = value.replaceAll(`\r
`, `
`).replaceAll("\r", `
`);
  if (!normalized || normalized.length > MAX_FINDING_BODY_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(normalized)) {
    throw protocolError("invalid_publication_claims");
  }
  return normalized;
}
function safeText(value, maximum) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}
function oid(value) {
  return typeof value === "string" && /^[0-9a-f]{40,64}$/.test(value);
}
function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
function createSignedToken(value, key) {
  const payload = encode(value);
  return `${payload}.${signature(payload, key)}`;
}
function signature(payload, key) {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}
function canonicalIdentity(identity) {
  return JSON.stringify(identity);
}
function protocolError(code) {
  const status = code.includes("token") || code === "confirmation_expired" || code === "invalid_publication_scope" ? 401 : code === "unsupported_publication_protocol" ? 400 : 422;
  return Object.assign(new Error(code.replaceAll("_", " ")), { code, status });
}

// skills/review-change/runtime/review-publication-provider.mjs
import { spawn } from "node:child_process";

// skills/review-change/runtime/github-target.mjs
var MAX_TARGET_LENGTH = 2048;
var MAX_PULL_REQUEST_NUMBER_TEXT = "2147483647";
var GITHUB_OWNER_PATTERN = /^(?=.{1,39}$)[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/;
var GITHUB_REPOSITORY_PATTERN = /^(?=.{1,100}$)(?!\.{1,2}$)[a-zA-Z0-9._-]+$/;
function parseGitHubTarget(target) {
  if (!target || /\p{Cc}/u.test(target))
    throw new Error("The GitHub target must be one non-empty line");
  if (target.length > MAX_TARGET_LENGTH)
    throw new Error("The GitHub target is too long");
  if (target.startsWith("gh:"))
    return parseConciseGitHubTarget(target);
  const parsedUrl = parseGitHubUrl(target);
  const [owner, repository, changeKind, targetValue, ...branchSegments] = parsedUrl.pathname.split("/").filter(Boolean);
  if (!isValidGitHubRepositoryIdentity(owner, repository))
    throw new Error("The GitHub target is malformed");
  if (changeKind === "pull" && isCanonicalPullRequestNumber(targetValue)) {
    return { kind: "pull-request", owner, repository, number: Number(targetValue) };
  }
  if (changeKind === "tree" && targetValue) {
    return { kind: "branch", owner, repository, branch: [targetValue, ...branchSegments].join("/") };
  }
  throw new Error("The GitHub target is malformed");
}
function isValidGitHubRepositoryIdentity(owner, repository) {
  return GITHUB_OWNER_PATTERN.test(owner ?? "") && GITHUB_REPOSITORY_PATTERN.test(repository ?? "");
}
function isCanonicalPullRequestNumber(value) {
  if (!/^[1-9]\d*$/.test(value))
    return false;
  if (value.length !== MAX_PULL_REQUEST_NUMBER_TEXT.length) {
    return value.length < MAX_PULL_REQUEST_NUMBER_TEXT.length;
  }
  return value <= MAX_PULL_REQUEST_NUMBER_TEXT;
}
function parseConciseGitHubTarget(target) {
  if (/[?#\\]/.test(target) || target.endsWith("/"))
    throw new Error("The GitHub target is malformed");
  const segments = target.slice(3).split("/");
  if (segments.some(isNormalizationSensitiveSegment))
    throw new Error("The GitHub target is malformed");
  const [owner, repository, changeKind, targetValue, ...branchSegments] = segments;
  if (!isValidGitHubRepositoryIdentity(owner, repository))
    throw new Error("The GitHub target is malformed");
  if (changeKind === "pull" && branchSegments.length === 0 && isCanonicalPullRequestNumber(targetValue)) {
    return { kind: "pull-request", owner, repository, number: Number(targetValue) };
  }
  if (changeKind === "tree" && targetValue) {
    return { kind: "branch", owner, repository, branch: [targetValue, ...branchSegments].join("/") };
  }
  throw new Error("The GitHub target is malformed");
}
function isNormalizationSensitiveSegment(segment) {
  if (!segment)
    return true;
  try {
    const decoded = decodeURIComponent(segment);
    return new Set([".", ".."]).has(decoded) || /[\\/]/.test(decoded);
  } catch {
    return false;
  }
}
function validateCanonicalBrowserEndpoint(target) {
  const pathMatch = /^https:\/\/github\.com(?::443)?(\/[^?#]*)?(?:[?#]|$)/.exec(target);
  if (!pathMatch)
    throw new Error("The GitHub target is malformed");
  const segments = (pathMatch[1] ?? "").split("/").slice(1);
  if (segments.some(isNormalizationSensitiveSegment)) {
    throw new Error("The GitHub target is malformed");
  }
}
function parseGitHubUrl(target) {
  let url;
  try {
    url = new URL(target);
  } catch {
    throw new Error("The GitHub target is malformed");
  }
  if (url.origin !== "https://github.com") {
    throw new Error("The GitHub target is malformed");
  }
  if (url.username || url.password)
    throw new Error("The GitHub target must not include credentials");
  validateCanonicalBrowserEndpoint(target);
  return url;
}

// skills/review-change/runtime/review-publication-executable.mjs
import { accessSync, constants, lstatSync, readlinkSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
var UNSAFE_WRITE_MODE = 18;
var GROUP_WRITE_MODE = 16;
var WORLD_WRITE_MODE = 2;
var STICKY_MODE = 512;
function validateGitHubCliPath(executable, {
  userId = typeof process.getuid === "function" ? process.getuid() : 0
} = {}) {
  if (typeof executable !== "string" || !path.isAbsolute(executable)) {
    throw new Error("GitHub CLI must resolve to an absolute executable path");
  }
  if (/[\u0000-\u001f\u007f]/.test(executable))
    throw new Error("GitHub CLI path is unsafe");
  try {
    const candidateState = lstatSync(executable);
    const resolved = candidateState.isSymbolicLink() ? validateHomebrewLink(executable) : realpathSync(executable);
    const state = statSync(resolved);
    if (!state.isFile())
      throw new Error("not a file");
    accessSync(resolved, constants.X_OK);
    if ((state.mode & UNSAFE_WRITE_MODE) !== 0)
      throw new Error("unsafe path");
    validateAncestors(resolved, userId);
    return candidateState.isSymbolicLink() ? executable : resolved;
  } catch (error) {
    if (error?.message === "unsafe path")
      throw new Error("GitHub CLI absolute executable path is unsafe");
    throw new Error("GitHub CLI absolute executable is not an executable file");
  }
}
function validateTrustedExecutablePath(executable, {
  userId = typeof process.getuid === "function" ? process.getuid() : 0
} = {}) {
  if (typeof executable !== "string" || !path.isAbsolute(executable) || /[\u0000-\u001f\u007f]/.test(executable)) {
    throw new Error("Trusted executable path is unsafe");
  }
  try {
    const candidateState = lstatSync(executable);
    if (candidateState.isSymbolicLink())
      throw new Error("unsafe path");
    const resolved = realpathSync(executable);
    const state = statSync(resolved);
    if (!state.isFile() || (state.mode & UNSAFE_WRITE_MODE) !== 0)
      throw new Error("unsafe path");
    accessSync(resolved, constants.X_OK);
    validateAncestors(resolved, userId);
    return resolved;
  } catch {
    throw new Error("Trusted executable is not a safe executable file");
  }
}
function validateHomebrewLink(executable) {
  const bin = path.dirname(executable);
  const prefix = path.dirname(bin);
  const target = readlinkSync(executable);
  const segments = target.split(path.sep);
  const version = segments[3];
  const exactShape = path.basename(executable) === "gh" && path.basename(bin) === "bin" && segments.length === 6 && segments[0] === ".." && segments[1] === "Cellar" && segments[2] === "gh" && safeVersion(version) && segments[4] === "bin" && segments[5] === "gh";
  if (!exactShape)
    throw new Error("unsafe path");
  const expected = path.join(prefix, "Cellar", "gh", version, "bin", "gh");
  const resolved = realpathSync(executable);
  if (resolved !== realpathSync(expected))
    throw new Error("unsafe path");
  return resolved;
}
function safeVersion(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(value);
}
function validateAncestors(executable, userId) {
  const allowedOwners = new Set([0, userId]);
  let current = path.dirname(executable);
  while (true) {
    const state = statSync(current);
    const worldWritable = (state.mode & WORLD_WRITE_MODE) !== 0;
    const groupWritable = (state.mode & GROUP_WRITE_MODE) !== 0;
    const safeStickyDirectory = worldWritable && (state.mode & STICKY_MODE) !== 0;
    if (!state.isDirectory() || !allowedOwners.has(state.uid) || worldWritable && !safeStickyDirectory || !worldWritable && groupWritable && state.uid !== userId) {
      throw new Error("unsafe path");
    }
    const parent = path.dirname(current);
    if (parent === current)
      return;
    current = parent;
  }
}

// skills/review-change/runtime/review-publication-github.mjs
import crypto2 from "node:crypto";

// skills/review-change/runtime/review-publication-lifetime.mjs
var REQUEST_WORK_TIMEOUT_MS = 240000;
var LOCK_WAIT_TIMEOUT_MS = 60000;
var OS_CONFIRMATION_TIMEOUT_MS = 65000;
var PROVIDER_CALL_TIMEOUT_MS = 20000;
var POST_ABORT_RECONCILIATION_TIMEOUT_MS = 65000;
var PROCESS_TERMINATION_GRACE_MS = 1000;
var RESPONSE_FLUSH_TIMEOUT_MS = 5000;
var CLEANUP_TIMEOUT_MS = 5000;
var SERVICE_SHUTDOWN_TIMEOUT_SECONDS = 5;
var SERVICE_TERMINATION_MARGIN_MS = SERVICE_SHUTDOWN_TIMEOUT_SECONDS * 1000;
var TOTAL_SERVICE_LIFETIME_MS = REQUEST_WORK_TIMEOUT_MS + POST_ABORT_RECONCILIATION_TIMEOUT_MS + RESPONSE_FLUSH_TIMEOUT_MS + CLEANUP_TIMEOUT_MS * 2 + SERVICE_TERMINATION_MARGIN_MS;
var TOTAL_SERVICE_LIFETIME_SECONDS = TOTAL_SERVICE_LIFETIME_MS / 1000;

// skills/review-change/runtime/review-publication-github.mjs
function createGitHubReviewPublisher(provider, {
  reconciliationTimeoutMs = POST_ABORT_RECONCILIATION_TIMEOUT_MS
} = {}) {
  return {
    async reconcileOrPublish(publication, context) {
      const marker = publicationMarker(publication);
      const body = `${publication.generalComment}

${marker}`;
      const expected = {
        actorId: publication.scope.actor.id,
        commitId: publication.commitId,
        state: expectedReviewState(publication.event),
        body,
        comments: publication.comments
      };
      const existing = await reconcileReviews(await provider.listReviews(publication.scope, context), expected);
      await provider.validateScope?.(publication.scope, context);
      if (existing)
        return providerOutcome("existing", existing);
      try {
        const created = await provider.createReview({
          event: publication.event,
          commitId: publication.commitId,
          body,
          comments: publication.comments,
          scope: publication.scope
        }, context);
        return providerOutcome("created", created);
      } catch (error) {
        if (!error?.ambiguous)
          throw error;
        try {
          return await reconcileAmbiguousPublication({
            context,
            expected,
            provider,
            publication,
            reconciliationTimeoutMs
          });
        } catch (reconciliationError) {
          if (reconciliationError?.code === "publication_reconciliation_conflict")
            throw reconciliationError;
          throw unknownPublicationOutcome();
        }
      }
    }
  };
}
async function reconcileAmbiguousPublication({
  context,
  expected,
  provider,
  publication,
  reconciliationTimeoutMs
}) {
  const controller = new AbortController;
  const reconciliationContext = {
    ...context,
    signal: controller.signal,
    mutation: false,
    markMutationStarted: undefined
  };
  let rejectDeadline;
  const deadline = new Promise((_, reject) => {
    rejectDeadline = reject;
  });
  const timer = setTimeout(() => {
    controller.abort();
    rejectDeadline(unknownPublicationOutcome());
  }, reconciliationTimeoutMs);
  timer.unref?.();
  try {
    const reconciliation = (async () => {
      const reconciled = await reconcileReviews(await provider.listReviews(publication.scope, reconciliationContext), expected);
      if (!reconciled)
        throw unknownPublicationOutcome();
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
    status: 502
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
    scope: publication.scope.scope
  });
  const digest = crypto2.createHash("sha256").update(canonical).digest("hex");
  return `<!-- review-change:publication:v1 report=${publication.scope.reportId} digest=${digest} -->`;
}
async function reconcileReviews(result, expected) {
  const { reviews, complete } = Array.isArray(result) ? { reviews: result, complete: true } : result;
  if (!complete)
    throw reconciliationConflict("GitHub pagination did not prove a complete review list");
  if (reviews.length === 0)
    return null;
  const expectedComments = expected.comments.map(providerCommentShape);
  const matches = reviews.filter((review) => review.actorId === expected.actorId && review.commitId === expected.commitId && review.state === expected.state && review.body === expected.body && JSON.stringify(review.comments.map(providerCommentShape)) === JSON.stringify(expectedComments));
  if (reviews.length !== 1 || matches.length !== 1)
    throw reconciliationConflict();
  return matches[0];
}
function reconciliationConflict(message = "The report has a conflicting GitHub review") {
  return Object.assign(new Error(message), {
    code: "publication_reconciliation_conflict",
    status: 409
  });
}
function expectedReviewState(event) {
  if (event === "COMMENT")
    return "COMMENTED";
  throw new Error("Review publication supports only COMMENT reviews");
}
function providerCommentShape(comment) {
  return { path: comment.path, line: comment.line, side: comment.side, body: comment.body };
}
function providerOutcome(disposition, review) {
  return { disposition, reviewId: review.reviewId, url: review.url };
}

// skills/review-change/runtime/review-publication-inline-locations.mjs
async function verifyInlineLocations(findings, files, loadCompleteDiff) {
  const patchLocations = collectPatchLocations(files);
  const unverified = findInvalidLocation(findings, patchLocations);
  if (!unverified)
    return;
  let completeLocations;
  try {
    completeLocations = parseCompleteDiff(await loadCompleteDiff());
  } catch {
    throw inlineLocationUnverifiable(unverified);
  }
  const invalid = findInvalidLocation(findings, completeLocations);
  if (invalid)
    throw invalidInlineLocation(invalid);
}
function parseCompleteDiff(diff) {
  if (typeof diff !== "string" || !diff.startsWith("diff --git "))
    throw invalidDiff();
  const locations = new Set;
  const sections = diff.split(/^diff --git /m).slice(1);
  for (const section of sections) {
    const lines = section.split(`
`);
    const paths = sectionPaths(lines);
    if (lines.some((line) => line.startsWith("@@") && !isHunkHeader(line)))
      throw invalidDiff();
    addPatchLocations(locations, paths, lines);
  }
  return locations;
}
function sectionPaths(lines) {
  const headerPaths = parseDiffGitHeader(lines[0] ?? "");
  const metadata = lines.slice(1, lines.findIndex((line) => line.startsWith("@@")) < 0 ? lines.length : lines.findIndex((line) => line.startsWith("@@")));
  const oldHeaders = metadata.filter((line) => line.startsWith("--- "));
  const newHeaders = metadata.filter((line) => line.startsWith("+++ "));
  if (oldHeaders.length === 0 && newHeaders.length === 0)
    return headerPaths;
  if (oldHeaders.length !== 1 || newHeaders.length !== 1)
    throw invalidDiff();
  const oldPath = parsePatchHeaderPath(oldHeaders[0], "a/");
  const newPath = parsePatchHeaderPath(newHeaders[0], "b/");
  if (oldPath !== null && oldPath !== headerPaths.oldPath || newPath !== null && newPath !== headerPaths.newPath)
    throw invalidDiff();
  return headerPaths;
}
function parseDiffGitHeader(source) {
  const oldToken = parseGitPathToken(source, 0);
  if (source[oldToken.next] !== " ")
    throw invalidDiff();
  let next = oldToken.next;
  while (source[next] === " ")
    next += 1;
  const newToken = parseGitPathToken(source, next);
  if (newToken.next !== source.length)
    throw invalidDiff();
  return {
    oldPath: normalizeCoordinatePath(oldToken.value, "a/"),
    newPath: normalizeCoordinatePath(newToken.value, "b/")
  };
}
function parsePatchHeaderPath(line, prefix) {
  const source = line.slice(4);
  if (source === "/dev/null")
    return null;
  const token = parseGitPathToken(source, 0);
  if (token.next !== source.length)
    throw invalidDiff();
  return normalizeCoordinatePath(token.value, prefix);
}
function parseGitPathToken(source, start) {
  if (start >= source.length)
    throw invalidDiff();
  if (source[start] === '"')
    return parseQuotedGitPath(source, start);
  let next = start;
  while (next < source.length && source[next] !== " ")
    next += 1;
  const value = source.slice(start, next);
  if (!value || /["\\\u0000-\u001f\u007f]/u.test(value))
    throw invalidDiff();
  return { value, next };
}
function parseQuotedGitPath(source, start) {
  const bytes = [];
  let index = start + 1;
  while (index < source.length && source[index] !== '"') {
    if (source[index] === "\\")
      index = appendEscapedByte(bytes, source, index + 1);
    else
      index = appendUtf8Character(bytes, source, index);
  }
  if (source[index] !== '"')
    throw invalidDiff();
  let value;
  try {
    value = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    throw invalidDiff();
  }
  if (value.includes("\x00"))
    throw invalidDiff();
  return { value, next: index + 1 };
}
function appendEscapedByte(bytes, source, index) {
  const escapes = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
  const escaped = source[index];
  if (escaped in escapes) {
    bytes.push(escapes[escaped]);
    return index + 1;
  }
  if (!/[0-7]/.test(escaped ?? ""))
    throw invalidDiff();
  const octal = /^[0-7]{1,3}/.exec(source.slice(index))?.[0] ?? "";
  const byte = Number.parseInt(octal, 8);
  if (byte > 255)
    throw invalidDiff();
  bytes.push(byte);
  return index + octal.length;
}
function appendUtf8Character(bytes, source, index) {
  const codePoint = source.codePointAt(index);
  if (codePoint === undefined || codePoint < 32 || codePoint === 127)
    throw invalidDiff();
  const character = String.fromCodePoint(codePoint);
  bytes.push(...Buffer.from(character, "utf8"));
  return index + character.length;
}
function normalizeCoordinatePath(value, prefix) {
  if (!value.startsWith(prefix) || value.length === prefix.length)
    throw invalidDiff();
  return value.slice(prefix.length);
}
function invalidDiff() {
  return new Error("Invalid complete diff");
}
function collectPatchLocations(files) {
  const locations = new Set;
  for (const file of files) {
    addPatchLocations(locations, { oldPath: file.filename, newPath: file.filename }, file.patch?.split(`
`) ?? []);
  }
  return locations;
}
function addPatchLocations(locations, paths, lines) {
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const line of lines) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
    } else if (inHunk && line.startsWith("+")) {
      locations.add(locationKey(paths.newPath, "RIGHT", newLine));
      newLine += 1;
    } else if (inHunk && line.startsWith("-")) {
      locations.add(locationKey(paths.oldPath, "LEFT", oldLine));
      oldLine += 1;
    } else if (inHunk && line.startsWith(" ")) {
      locations.add(locationKey(paths.oldPath, "LEFT", oldLine));
      locations.add(locationKey(paths.newPath, "RIGHT", newLine));
      oldLine += 1;
      newLine += 1;
    }
  }
}
function isHunkHeader(line) {
  return /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.test(line);
}
function findInvalidLocation(findings, locations) {
  return findings.find((finding) => !locations.has(locationKey(finding.path, finding.side, finding.line)));
}
function invalidInlineLocation(finding) {
  return Object.assign(new Error("The selected Finding location is not in the exact pull-request changes"), {
    code: "invalid_inline_location",
    status: 409,
    details: findingDetails(finding)
  });
}
function inlineLocationUnverifiable(finding) {
  return Object.assign(new Error("GitHub did not provide complete evidence for the selected Finding location"), {
    code: "inline_location_unverifiable",
    status: 502,
    ambiguous: false,
    details: findingDetails(finding)
  });
}
function findingDetails(finding) {
  return {
    findingId: finding.id,
    title: finding.title,
    path: finding.path,
    line: finding.line,
    side: finding.side
  };
}
function locationKey(filePath, side, line) {
  return `${filePath}\x00${side}\x00${line}`;
}

// skills/review-change/runtime/review-publication-review-url.mjs
function validateGitHubReviewUrl(value, claims, reviewId) {
  try {
    if (!Number.isSafeInteger(reviewId) || reviewId <= 0 || typeof value !== "string")
      throw new Error("invalid review identity");
    const url = new URL(value);
    const expectedPath = `/${claims.repository.nameWithOwner}/pull/${claims.pullRequest.number}`;
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.pathname !== expectedPath || url.search || url.hash !== `#pullrequestreview-${reviewId}`) {
      throw new Error("invalid review URL");
    }
    return value;
  } catch {
    throw Object.assign(new Error("provider_invalid_response"), {
      code: "provider_invalid_response",
      status: 502,
      ambiguous: false
    });
  }
}

// skills/review-change/runtime/review-publication-provider.mjs
var DEFAULT_PROVIDER_TIMEOUT_MS = PROVIDER_CALL_TIMEOUT_MS;
var OUTPUT_LIMIT = 2 * 1024 * 1024;
var GITHUB_REVIEW_STATES = new Set(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED", "PENDING"]);
function createGitHubProvider({
  execute,
  ghPath = process.env.REVIEW_PUBLICATION_GH,
  environment = process.env,
  spawnProcess = spawn,
  timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
  outputLimit = OUTPUT_LIMIT,
  terminationGraceMs = PROCESS_TERMINATION_GRACE_MS
} = {}) {
  const run = execute ?? createCommandExecutor({
    executable: validateGitHubCliPath(ghPath),
    environment,
    spawnProcess,
    timeoutMs,
    outputLimit,
    terminationGraceMs
  });
  const provider = {
    getActor: async (context) => validateActor(parseProviderJson(await run(["api", "user"], "", context))),
    preparePullRequest: (target, context) => preparePullRequest(target, run, context),
    inspectPullRequest: (claims, selectedFindings = claims.findings, context) => inspectPullRequest(claims, selectedFindings, run, context)
  };
  const publisher = createGitHubReviewPublisher({
    listReviews: (claims, context) => listReviews(claims, run, context),
    validateScope: async (claims, context) => assertExpectedScope(claims, await readPullRequestScope(claims, run, context)),
    createReview: (request, context) => createReview(request, run, context)
  });
  return {
    ...provider,
    publishReview: async (publication, context) => {
      const outcome = await publisher.reconcileOrPublish(publication, context);
      return { reviewId: outcome.reviewId, url: outcome.url, disposition: outcome.disposition };
    }
  };
}
async function preparePullRequest(target, execute, context) {
  const parsedTarget = parseGitHubTarget(target);
  if (parsedTarget.kind !== "pull-request")
    throw new Error("Review publication requires an exact GitHub pull request");
  const requestedRepository = `${parsedTarget.owner}/${parsedTarget.repository}`;
  const [repositoryValue, pullRequestValue] = await Promise.all([
    execute(["repo", "view", requestedRepository, "--json", "id,nameWithOwner"], "", context),
    execute(["pr", "view", String(parsedTarget.number), "--repo", requestedRepository, "--json", "id,number,url,baseRefOid,headRefOid"], "", context)
  ]);
  const repository = validateRepository(parseProviderJson(repositoryValue));
  const pullRequest = validatePreparedPullRequest(parseProviderJson(pullRequestValue), repository, parsedTarget.number);
  return {
    repository,
    pullRequest: { id: pullRequest.id, number: pullRequest.number, url: pullRequest.url },
    scope: { baseOid: pullRequest.baseRefOid, headOid: pullRequest.headRefOid }
  };
}
async function inspectPullRequest(claims, selectedFindings, execute, context) {
  const current = await readPullRequestScope(claims, execute, context);
  if (!matchesExpectedScope(claims, current) || selectedFindings.length === 0)
    return current;
  const repositoryName = claims.repository.nameWithOwner;
  const endpoint = `repos/${repositoryName}/pulls/${claims.pullRequest.number}/files?per_page=100`;
  const files = parsePages(await execute(["api", "--paginate", "--slurp", endpoint], "", context), validateChangedFile);
  const rechecked = await readPullRequestScope(claims, execute, context);
  if (!matchesExpectedScope(claims, rechecked))
    return rechecked;
  await verifyInlineLocations(selectedFindings, files, () => readCompletePullRequestDiff(claims, execute, context));
  return rechecked;
}
async function readPullRequestScope(claims, execute, context) {
  const repositoryName = claims.repository.nameWithOwner;
  const [actorValue, repositoryValue, pullRequestValue] = await Promise.all([
    execute(["api", "user"], "", context),
    execute(["repo", "view", repositoryName, "--json", "id,nameWithOwner"], "", context),
    execute(["pr", "view", String(claims.pullRequest.number), "--repo", repositoryName, "--json", "id,number,state,baseRefOid,headRefOid"], "", context)
  ]);
  const actor = validateActor(parseProviderJson(actorValue));
  const repository = validateRepository(parseProviderJson(repositoryValue));
  const pullRequest = validatePullRequest(parseProviderJson(pullRequestValue));
  return {
    actor,
    repository,
    pullRequest: { ...claims.pullRequest, id: pullRequest.id, number: pullRequest.number, state: pullRequest.state },
    scope: { baseOid: pullRequest.baseRefOid, headOid: pullRequest.headRefOid }
  };
}
function assertExpectedScope(expected, current) {
  if (current.actor.id !== expected.actor.id || current.actor.login !== expected.actor.login) {
    throw Object.assign(new Error("github_actor_changed"), {
      code: "github_actor_changed",
      status: 403,
      expectedActor: expected.actor.login,
      currentActor: current.actor.login
    });
  }
  if (!matchesExpectedScope(expected, current)) {
    throw Object.assign(new Error("pull_request_scope_changed"), {
      code: "pull_request_scope_changed",
      status: 409
    });
  }
}
function matchesExpectedScope(expected, current) {
  return current.actor.id === expected.actor.id && current.actor.login === expected.actor.login && current.repository.id === expected.repository.id && current.repository.nameWithOwner === expected.repository.nameWithOwner && current.pullRequest.id === expected.pullRequest.id && current.pullRequest.number === expected.pullRequest.number && current.pullRequest.state === "OPEN" && current.scope.baseOid === expected.scope.baseOid && current.scope.headOid === expected.scope.headOid;
}
async function listReviews(claims, execute, context) {
  const prefix = `repos/${claims.repository.nameWithOwner}/pulls/${claims.pullRequest.number}`;
  const reviewPages = parsePaginatedPages(await execute(["api", "--paginate", "--slurp", `${prefix}/reviews`], "", context), (review2) => validateReviewEntry(review2, claims));
  const marker = `report=${claims.reportId} digest=`;
  const candidates = reviewPages.entries.filter((review2) => review2.body.includes(marker));
  if (candidates.length !== 1) {
    return { complete: reviewPages.complete, reviews: candidates.map((review2) => reviewSummary(review2, [])) };
  }
  const [review] = candidates;
  const commentPages = parsePaginatedPages(await execute(["api", "--paginate", "--slurp", `${prefix}/reviews/${review.id}/comments`], "", context), validateReviewComment);
  return {
    complete: reviewPages.complete && commentPages.complete,
    reviews: [reviewSummary(review, commentPages.entries.map(normalizeProviderComment))]
  };
}
async function createReview(request, execute, context) {
  const claims = request.scope;
  const endpoint = `repos/${claims.repository.nameWithOwner}/pulls/${claims.pullRequest.number}/reviews`;
  const payload = {
    event: request.event,
    commit_id: request.commitId,
    body: request.body,
    comments: request.comments.map(({ path: filePath, line, side, body }) => ({ path: filePath, line, side, body }))
  };
  const response = await execute(["api", "--method", "POST", endpoint, "--input", "-"], JSON.stringify(payload), { ...context, mutation: true });
  try {
    const review = parseJson(response);
    validateCreatedReviewIdentity(review, claims);
    return { reviewId: review.id, url: review.html_url, body: request.body, comments: request.comments };
  } catch {
    throw providerError("provider_invalid_response", 502, true);
  }
}
function validateCreatedReviewIdentity(review, claims) {
  if (!review)
    throw new Error("Invalid review identity");
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
  const response = typeof value === "object" && value !== null ? value : { body: value, paginationComplete: true };
  const pages = parseProviderJson(response.body);
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw providerError("provider_invalid_response", 502, false);
  }
  return {
    complete: response.paginationComplete === true,
    entries: pages.flatMap((page) => page.map(validateEntry))
  };
}
function validateActor(value) {
  if (!value || !safeText2(value.node_id) || !safeText2(value.login))
    throw providerError("provider_invalid_response", 502, false);
  return { id: String(value.node_id), login: value.login };
}
function validateRepository(value) {
  if (!value || !safeText2(value.id) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.nameWithOwner ?? "")) {
    throw providerError("provider_invalid_response", 502, false);
  }
  return { id: value.id, nameWithOwner: value.nameWithOwner };
}
function validatePullRequest(value) {
  if (!value || !safeText2(value.id) || !Number.isSafeInteger(value.number) || value.number <= 0 || !["OPEN", "CLOSED", "MERGED"].includes(value.state) || !oid2(value.baseRefOid) || !oid2(value.headRefOid)) {
    throw providerError("provider_invalid_response", 502, false);
  }
  return value;
}
function validatePreparedPullRequest(value, repository, expectedNumber) {
  const expectedUrl = `https://github.com/${repository.nameWithOwner}/pull/${expectedNumber}`;
  if (!value || !safeText2(value.id) || value.number !== expectedNumber || value.url !== expectedUrl || !oid2(value.baseRefOid) || !oid2(value.headRefOid)) {
    throw providerError("provider_invalid_response", 502, false);
  }
  return value;
}
function validateChangedFile(value) {
  if (!value || !safeText2(value.filename) || value.patch !== undefined && typeof value.patch !== "string") {
    throw providerError("provider_invalid_response", 502, false);
  }
  return { filename: value.filename, patch: value.patch };
}
function validateReviewEntry(value, claims) {
  if (!value || typeof value.body !== "string" || !oid2(value.commit_id) || !safeText2(value.user?.node_id) || !GITHUB_REVIEW_STATES.has(value.state)) {
    throw providerError("provider_invalid_response", 502, false);
  }
  validateGitHubReviewUrl(value.html_url, claims, value.id);
  return value;
}
function validateReviewComment(value) {
  const line = value?.line ?? value?.original_line;
  const side = value?.side ?? "RIGHT";
  if (!value || !safeText2(value.path) || !Number.isSafeInteger(line) || line < 1 || !["LEFT", "RIGHT"].includes(side) || typeof value.body !== "string") {
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
    comments
  };
}
function normalizeProviderComment(comment) {
  return comment;
}
function parseProviderJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw providerError("provider_invalid_response", 502, false);
  }
}
function parseJson(value) {
  return JSON.parse(value);
}
function safeText2(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value);
}
function oid2(value) {
  return typeof value === "string" && /^[0-9a-f]{40,64}$/.test(value);
}
function createCommandExecutor({ executable, environment, spawnProcess, timeoutMs, outputLimit, terminationGraceMs }) {
  return (args, input = "", context = {}) => new Promise((resolve, reject) => {
    if (context.signal?.aborted)
      return reject(cancelledProviderError(context.mutation));
    let child;
    try {
      child = spawnProcess(executable, args, {
        env: { ...environment, GH_HOST: "github.com", GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch {
      return reject(providerError("provider_unavailable", 502, false));
    }
    if (context.mutation)
      context.markMutationStarted?.();
    const stdout = [];
    const stderr = [];
    let outputSize = 0;
    let termination = "";
    let settled = false;
    let forceTimer;
    let timeoutTimer;
    const cancel = () => terminate("cancelled");
    const settle = (error, value) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(forceTimer);
      context.signal?.removeEventListener("abort", cancel);
      if (error)
        reject(error);
      else
        resolve(value);
    };
    const terminationError = () => {
      if (termination === "cancelled")
        return cancelledProviderError(context.mutation);
      if (termination === "timeout")
        return providerError("provider_timeout", 504, Boolean(context.mutation));
      return providerError("provider_output_limit", 502, Boolean(context.mutation));
    };
    const terminate = (reason) => {
      if (termination)
        return;
      termination = reason;
      try {
        child.kill("SIGTERM");
      } catch {}
      forceTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
        child.stdin.destroy?.();
        child.stdout.destroy?.();
        child.stderr.destroy?.();
        child.unref?.();
        settle(terminationError());
      }, terminationGraceMs);
    };
    context.signal?.addEventListener("abort", cancel, { once: true });
    timeoutTimer = setTimeout(() => terminate("timeout"), timeoutMs);
    if (context.signal?.aborted)
      cancel();
    const collect = (target) => (chunk) => {
      outputSize += chunk.length;
      if (outputSize > outputLimit)
        terminate("output-limit");
      else
        target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("error", () => settle(providerError("provider_unavailable", 502, Boolean(context.mutation))));
    child.once("close", (status) => {
      if (status === 0 && !termination)
        return settle(null, Buffer.concat(stdout).toString("utf8"));
      settle(termination ? terminationError() : classifyProviderFailure(Buffer.concat(stderr).toString("utf8"), Boolean(context.mutation)));
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
  if (mutation && httpStatus >= 500)
    return providerError("provider_failed", 502, true);
  if (/rate.?limit|secondary rate/i.test(stderr))
    return providerError("provider_rate_limited", 429, false);
  if (/authentication|authenticate|bad credentials|requires authentication/i.test(stderr))
    return providerError("provider_authentication_failed", 401, false);
  if (/forbidden|permission|resource not accessible/i.test(stderr))
    return providerError("provider_permission_denied", 403, false);
  if (/validation failed|unprocessable|invalid.*line/i.test(stderr))
    return providerError("invalid_inline_location", 409, false);
  if (httpStatus >= 100)
    return providerError("provider_failed", 502, false);
  return providerError("provider_failed", 502, mutation);
}
function cancelledProviderError(mutation) {
  return providerError("request_timeout", 504, Boolean(mutation));
}
function providerError(code, status, ambiguous) {
  return Object.assign(new Error(code), { code, status, ambiguous });
}

// skills/review-change/runtime/review-publication-state.mjs
import crypto3 from "node:crypto";
import { constants as constants2 } from "node:fs";
import { link, lstat, mkdir, open, readdir, rename, rmdir, unlink, utimes } from "node:fs/promises";
import os from "node:os";
import path2 from "node:path";
var DEFAULT_STALE_THRESHOLD_MS = 120000;
var DEFAULT_POLL_INTERVAL_MS = 25;
var KEY_BYTES = 32;
var KEY_TEMPORARY_PREFIX = ".signing-key.";
var KEY_TEMPORARY_SUFFIX = ".tmp";
var LEASE_SUFFIX = ".lease";
async function loadPublicationKey({
  home = os.homedir(),
  staleThresholdMs = DEFAULT_STALE_THRESHOLD_MS,
  now = () => Date.now()
} = {}) {
  const directory = await stateDirectory(home);
  const destination = path2.join(directory, "signing-key");
  await removeStaleKeyTemporaries(directory, staleThresholdMs, now);
  try {
    return await readPublicationKey(destination);
  } catch (error) {
    if (error?.code === "ENOENT")
      return initializePublicationKey(directory, destination);
    if (!error?.publicationKeyIncomplete || now() - error.state.mtimeMs <= staleThresholdMs)
      throw error;
    return recoverIncompletePublicationKey(directory, destination);
  }
}
async function initializePublicationKey(directory, destination) {
  const temporary = path2.join(directory, `${KEY_TEMPORARY_PREFIX}${process.pid}.${crypto3.randomUUID()}${KEY_TEMPORARY_SUFFIX}`);
  let handle;
  try {
    handle = await open(temporary, "wx", 384);
    await handle.writeFile(crypto3.randomBytes(KEY_BYTES));
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporary, destination);
      await syncDirectory(directory);
    } catch (error) {
      if (error?.code !== "EEXIST")
        throw error;
    }
    return await readPublicationKey(destination);
  } finally {
    await handle?.close();
    if (await unlinkIfPresent(temporary))
      await syncDirectory(directory);
  }
}
async function readPublicationKey(destination) {
  const handle = await open(destination, constants2.O_RDONLY | constants2.O_NOFOLLOW);
  try {
    const state = await handle.stat();
    const wrongOwner = typeof process.getuid === "function" && state.uid !== process.getuid();
    if (!state.isFile() || (state.mode & 63) !== 0 || wrongOwner) {
      throw new Error("Review publication signing key is unsafe");
    }
    const key = await handle.readFile();
    if (key.length !== KEY_BYTES) {
      throw Object.assign(new Error("Review publication signing key is invalid"), {
        publicationKeyIncomplete: key.length < KEY_BYTES,
        state
      });
    }
    return key;
  } finally {
    await handle.close();
  }
}
async function recoverIncompletePublicationKey(directory, destination) {
  const quarantine = path2.join(directory, `${KEY_TEMPORARY_PREFIX}recovery.${process.pid}.${crypto3.randomUUID()}${KEY_TEMPORARY_SUFFIX}`);
  try {
    await rename(destination, quarantine);
  } catch (error) {
    if (error?.code !== "ENOENT")
      throw error;
    return initializePublicationKey(directory, destination);
  }
  try {
    try {
      await readPublicationKey(quarantine);
      try {
        await link(quarantine, destination);
        await syncDirectory(directory);
      } catch (error) {
        if (error?.code !== "EEXIST")
          throw error;
      }
      return await readPublicationKey(destination);
    } catch (error) {
      if (!error?.publicationKeyIncomplete)
        throw error;
    }
  } finally {
    if (await unlinkIfPresent(quarantine))
      await syncDirectory(directory);
  }
  return initializePublicationKey(directory, destination);
}
async function removeStaleKeyTemporaries(directory, staleThresholdMs, now) {
  const names = await readdir(directory);
  for (const name of names) {
    if (!name.startsWith(KEY_TEMPORARY_PREFIX) || !name.endsWith(KEY_TEMPORARY_SUFFIX))
      continue;
    const candidate = path2.join(directory, name);
    const state = await lstatIfPresent(candidate);
    if (!state)
      continue;
    const wrongOwner = typeof process.getuid === "function" && state.uid !== process.getuid();
    if (!state.isFile() || state.isSymbolicLink() || wrongOwner || (state.mode & 63) !== 0) {
      throw new Error("Review publication signing key initialization artifact is unsafe");
    }
    if (now() - state.mtimeMs <= staleThresholdMs)
      continue;
    const current = await lstatIfPresent(candidate);
    if (current?.dev === state.dev && current.ino === state.ino && current.mtimeMs === state.mtimeMs) {
      if (await unlinkIfPresent(candidate))
        await syncDirectory(directory);
    }
  }
}
async function lstatIfPresent(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (error?.code === "ENOENT")
      return null;
    throw error;
  }
}
async function unlinkIfPresent(candidate) {
  try {
    await unlink(candidate);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT")
      return false;
    throw error;
  }
}
async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EBADF"].includes(error?.code))
      throw error;
  } finally {
    await handle.close();
  }
}
async function withPublisherLock(identity, task, {
  home = os.homedir(),
  now = () => Date.now(),
  sleep = sleepFor,
  ownerToken = crypto3.randomUUID(),
  waitTimeoutMs = LOCK_WAIT_TIMEOUT_MS,
  staleThresholdMs = DEFAULT_STALE_THRESHOLD_MS,
  refreshIntervalMs = Math.max(1, Math.floor(staleThresholdMs / 3)),
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  cleanupTimeoutMs = CLEANUP_TIMEOUT_MS,
  onCleanupFailure = () => {},
  releaseLease = releaseOwnedLease,
  signal
} = {}) {
  throwIfCancelled(signal);
  const directory = await stateDirectory(home);
  const lock = path2.join(directory, `publisher-${publicationIdentityDigest(identity)}.lock`);
  const lease = path2.join(lock, `${ownerToken}${LEASE_SUFFIX}`);
  const deadline = now() + waitTimeoutMs;
  await acquireLease({ deadline, lease, lock, now, ownerToken, pollIntervalMs, signal, sleep, staleThresholdMs });
  const heartbeat = startLeaseHeartbeat(lease, refreshIntervalMs);
  let taskFailed = false;
  let taskError;
  let taskValue;
  try {
    throwIfCancelled(signal);
    taskValue = await task();
  } catch (error) {
    taskFailed = true;
    taskError = error;
  }
  try {
    await boundedLockCleanup(heartbeat, lock, lease, cleanupTimeoutMs, releaseLease);
  } catch {
    try {
      await onCleanupFailure();
    } catch {}
  }
  if (taskFailed)
    throw taskError;
  return taskValue;
}
async function boundedLockCleanup(heartbeat, lock, lease, timeoutMs, releaseLease) {
  let rejectDeadline;
  const deadline = new Promise((_, reject) => {
    rejectDeadline = reject;
  });
  const timer = setTimeout(() => rejectDeadline(new Error("Review publisher lock cleanup timed out")), timeoutMs);
  timer.unref?.();
  try {
    await Promise.race([
      heartbeat.stop().then(() => releaseLease(lock, lease)),
      deadline
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function acquireLease(options) {
  while (true) {
    try {
      await mkdir(options.lock, { mode: 448 });
      const handle = await open(options.lease, "wx", 384);
      await handle.close();
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        await releaseOwnedLease(options.lock, options.lease);
        throw error;
      }
    }
    await inspectExistingLock(options);
    if (options.now() >= options.deadline)
      throw publisherBusyError();
    await options.sleep(options.pollIntervalMs, options.signal);
    throwIfCancelled(options.signal);
  }
}
async function inspectExistingLock({ lock, now, staleThresholdMs }) {
  let lockState;
  let entries;
  try {
    [lockState, entries] = await Promise.all([lstat(lock), readdir(lock, { withFileTypes: true })]);
  } catch (error) {
    if (error?.code === "ENOENT")
      return;
    throw error;
  }
  if (!lockState.isDirectory() || lockState.isSymbolicLink())
    throw new Error("Review publisher lock is unsafe");
  if (entries.length === 0) {
    if (now() - lockState.mtimeMs > staleThresholdMs)
      await removeEmptyLock(lock);
    return;
  }
  if (entries.length !== 1 || !entries[0].isFile() || entries[0].isSymbolicLink() || !entries[0].name.endsWith(LEASE_SUFFIX)) {
    throw new Error("Review publisher lock is unsafe");
  }
  const lease = path2.join(lock, entries[0].name);
  const leaseState = await safeLeaseState(lease);
  if (leaseState && now() - leaseState.mtimeMs > staleThresholdMs) {
    await removeStaleLease(lock, lease, leaseState);
  }
}
async function removeStaleLease(lock, lease, observedState) {
  const currentState = await safeLeaseState(lease);
  if (!currentState || currentState.dev !== observedState.dev || currentState.ino !== observedState.ino || currentState.mtimeMs !== observedState.mtimeMs)
    return;
  try {
    await unlink(lease);
    await removeEmptyLock(lock);
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY"].includes(error?.code))
      throw error;
  }
}
function startLeaseHeartbeat(lease, refreshIntervalMs) {
  let stopped = false;
  let timer;
  let refresh = Promise.resolve();
  const schedule = () => {
    timer = setTimeout(() => {
      const refreshedAt = new Date;
      refresh = utimes(lease, refreshedAt, refreshedAt).catch(() => {}).finally(() => {
        if (!stopped)
          schedule();
      });
    }, refreshIntervalMs);
    timer.unref?.();
  };
  schedule();
  return {
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
      await refresh;
    }
  };
}
async function releaseOwnedLease(lock, lease) {
  try {
    await unlink(lease);
  } catch (error) {
    if (error?.code !== "ENOENT")
      throw error;
  }
  await removeEmptyLock(lock);
}
async function removeEmptyLock(lock) {
  try {
    await rmdir(lock);
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY"].includes(error?.code))
      throw error;
  }
}
async function safeLeaseState(lease) {
  try {
    const state = await lstat(lease);
    if (!state.isFile() || state.isSymbolicLink())
      throw new Error("Review publisher lock is unsafe");
    return state;
  } catch (error) {
    if (error?.code === "ENOENT")
      return null;
    throw error;
  }
}
function sleepFor(duration, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted)
      return reject(cancellationError());
    const timer = setTimeout(finish, duration);
    const cancel = () => finish(cancellationError());
    signal?.addEventListener("abort", cancel, { once: true });
    function finish(error) {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (error)
        reject(error);
      else
        resolve();
    }
  });
}
function throwIfCancelled(signal) {
  if (signal?.aborted)
    throw cancellationError();
}
function cancellationError() {
  return Object.assign(new Error("Review publication request timed out"), {
    code: "request_timeout",
    status: 504
  });
}
function publisherBusyError() {
  return Object.assign(new Error("Another Review publication is still running"), {
    code: "publisher_busy",
    status: 409
  });
}
function publicationIdentityDigest(identity) {
  const values = [
    identity?.host,
    identity?.reportId,
    identity?.actor?.id,
    identity?.repository?.id,
    identity?.repository?.nameWithOwner,
    identity?.pullRequest?.id,
    identity?.pullRequest?.number,
    identity?.scope?.baseOid,
    identity?.scope?.headOid
  ];
  if (values.some((value) => !["string", "number"].includes(typeof value))) {
    throw new Error("Review publication identity is invalid");
  }
  return crypto3.createHash("sha256").update(JSON.stringify(values)).digest("hex");
}
async function stateDirectory(home) {
  const directory = path2.join(home, ".review-publication");
  await mkdir(directory, { recursive: true, mode: 448 });
  const state = await lstat(directory);
  const wrongOwner = typeof process.getuid === "function" && state.uid !== process.getuid();
  if (!state.isDirectory() || state.isSymbolicLink() || (state.mode & 63) !== 0 || wrongOwner) {
    throw new Error("Review publication state directory is unsafe");
  }
  return directory;
}

// skills/review-change/runtime/review-publication-boundary.mjs
async function renderPublicationClaims(submittedClaims, {
  frozenScope,
  home,
  keyLoader = loadPublicationKey,
  provider = createGitHubProvider()
} = {}) {
  const [actor, key, currentIdentity] = await Promise.all([
    provider.getActor(),
    keyLoader({ home }),
    provider.preparePullRequest(submittedClaims.pullRequest.url)
  ]);
  const publicationToken = createPublicationToken(submittedClaims, {
    actor,
    frozenScope,
    key
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
    value.scope?.headOid
  ];
  if (JSON.stringify(identityValues(current)) === JSON.stringify(identityValues(expected)))
    return;
  throw Object.assign(new Error("The pull request base or head changed; run Review change again"), {
    code: "pull_request_scope_changed",
    status: 409
  });
}

// skills/review-change/runtime/review-publication-html.mjs
import crypto4 from "node:crypto";

// skills/review-change/runtime/review-publication-outcomes.mjs
var ERROR_OUTCOMES = {
  confirmation_expired: ["Confirmation expired.", "Nothing was posted because the fifteen-minute confirmation expired.", "Return to the still-open report and request a new confirmation."],
  duplicate_http_header: ["The browser request contained a duplicate header.", "No comments were posted because duplicate HTTP headers are unsafe.", "Return to the report and request publication again."],
  forbidden_host: ["The local publication address was rejected.", "No comments were posted because the request used the wrong local host.", "Open the original report and try again without changing its address."],
  github_actor_changed: ["The GitHub account changed.", "No comments were posted because a different GitHub account is active.", "Sign in to GitHub CLI with the account named in the report, then try again."],
  incomplete_http_request: ["The browser request was incomplete.", "No comments were posted because the local publisher did not receive the complete request.", "Return to the report and request publication again."],
  invalid_confirmation_token: ["The confirmation is invalid.", "Nothing was posted because the confirmation could not be verified.", "Return to the report and request a new confirmation."],
  invalid_content_length: ["The browser request size was invalid.", "No comments were posted because the request body size could not be verified.", "Return to the report and request publication again."],
  invalid_finding_selection: ["The Finding selection is invalid.", "No comments were posted because the selected Findings do not match this report.", "Return to the report and select the Findings again."],
  invalid_http_framing: ["The browser request contained extra data.", "No comments were posted because the local request body did not match its declared size.", "Return to the report and request publication again."],
  invalid_http_header: ["The browser request contained an invalid header.", "No comments were posted because the local request headers could not be checked safely.", "Return to the report and request publication again."],
  invalid_http_request: ["The browser request is invalid.", "No comments were posted because the local publisher could not safely read the request.", "Return to the report and request publication again."],
  invalid_http_request_line: ["The browser request line is invalid.", "No comments were posted because the local publisher accepts only its fixed POST request.", "Return to the report and request publication again."],
  invalid_inline_location: ["A Finding no longer matches the pull request.", "No comments were posted because a selected Finding is not in the reviewed changes.", "Run Review change again. The Finding will not be moved."],
  inline_location_unverifiable: ["GitHub could not verify a Finding location.", "No comments were posted because GitHub did not provide a complete pull-request diff.", "Check GitHub status, then try again from the report."],
  invalid_publication: ["The review cannot be posted.", "No comments were posted because the publication request failed validation.", "Run Review change again, then use the new report."],
  invalid_publication_claims: ["The report data is invalid.", "No comments were posted because the signed report contains invalid publication data.", "Run Review change again, then use the new report."],
  invalid_publication_endpoint: ["The publication address is invalid.", "No comments were posted because the request did not use a supported local endpoint.", "Return to the original report and request publication again."],
  invalid_publication_request: ["The publication form is invalid.", "No comments were posted because the submitted form contains missing, duplicate, or unknown fields.", "Return to the report and request publication again."],
  invalid_publication_token: ["The report could not be verified.", "No comments were posted because the signed report data is invalid.", "Run Review change again, then use the new report."],
  not_found: ["The publication endpoint was not found.", "No comments were posted because the local request used an unknown method or path.", "Return to the original report and request publication again."],
  os_confirmation_denied: ["Publication was not approved.", "Nothing was posted because you denied the operating-system confirmation.", "Return to the report if you want to try again."],
  os_confirmation_dismissed: ["Confirmation was dismissed.", "Nothing was posted because the operating-system confirmation was closed.", "Return to the report if you want to try again."],
  os_confirmation_failed: ["Operating-system confirmation failed.", "Nothing was posted because the required system confirmation did not complete.", "Check your desktop session, then try again."],
  os_confirmation_invalid_response: ["The confirmation response was invalid.", "Nothing was posted because explicit operating-system approval could not be verified.", "Return to the report and request publication again."],
  os_confirmation_timeout: ["Confirmation timed out.", "Nothing was posted because the operating-system confirmation was not answered in time.", "Return to the report and request publication again."],
  os_confirmation_unavailable: ["Operating-system confirmation is unavailable.", "Nothing was posted because the publisher could not show the required system confirmation.", "Repair the Review publication installation, then try again."],
  provider_authentication_failed: ["GitHub sign-in failed.", "No comments were posted because GitHub could not verify your account.", "Sign in with GitHub CLI, then try again."],
  provider_failed: ["GitHub could not complete the request.", "No comments were posted because GitHub did not complete the required check.", "Check your connection and GitHub status, then try again."],
  provider_invalid_response: ["GitHub returned an unreadable response.", "No comments were posted because the GitHub response could not be checked safely.", "Check GitHub status, then run Review change again."],
  provider_output_limit: ["GitHub returned too much data.", "No comments were posted because the GitHub response exceeded the safe limit.", "Check GitHub status, then try again."],
  provider_permission_denied: ["GitHub refused the review.", "No comments were posted because the active account cannot review this pull request.", "Ask for pull-request review permission, then try again."],
  provider_rate_limited: ["GitHub is temporarily limiting requests.", "No comments were posted by this attempt.", "Wait for the GitHub limit to reset, then try again."],
  provider_timeout: ["GitHub did not respond in time.", "No comments were posted because GitHub did not complete the required check in time.", "Check your connection and GitHub status, then try again."],
  provider_unavailable: ["GitHub CLI is unavailable.", "No comments were posted because the required GitHub command could not start.", "Install or repair GitHub CLI, then try again."],
  publisher_configuration_invalid: ["Review publication is not configured safely.", "No comments were posted because the managed worker configuration could not be validated.", "Repair the Review publication installation, then try again."],
  publisher_initialization_failed: ["Review publication could not start.", "No comments were posted because the local worker could not initialize safely.", "Repair the Review publication installation, then try again."],
  publisher_signing_key_unavailable: ["Review publication signing is unavailable.", "No comments were posted because the local signing key could not be validated.", "Repair the Review publication installation, then try again."],
  publication_outcome_unknown: ["GitHub did not confirm the result.", "The review may have been posted because the create-review request might have reached GitHub.", "Submit this same confirmed review again."],
  publication_reconciliation_conflict: ["This report conflicts with an existing review.", "No new comments were posted because a different review already uses this report identity.", "Inspect the pull request, then run Review change again if another review is needed."],
  pull_request_scope_changed: ["The pull request changed.", "No comments were posted because the reviewed commits no longer match.", "Run Review change again. Comments will not be moved to different lines."],
  publisher_busy: ["This review is already being posted.", "No comments were posted by this attempt.", "Wait for this report to finish, then try again."],
  request_body_too_large: ["The browser request body is too large.", "No comments were posted because the request exceeded the safe body limit.", "Run Review change again with fewer or shorter Findings."],
  request_headers_too_large: ["The browser request headers are too large.", "No comments were posted because the request exceeded the safe header limit.", "Return to the report and request publication again."],
  request_timeout: ["The publication request took too long.", "No comments were posted because the request did not finish in time.", "Run Review change again, then use the new report."],
  request_too_large: ["The publication request is too large.", "No comments were posted because the request exceeded the safe size limit.", "Run Review change again with fewer or shorter Findings."],
  unsupported_media_type: ["The publication form type is unsupported.", "No comments were posted because the local request was not a browser form submission.", "Return to the original report and request publication again."],
  unsupported_publication_protocol: ["This report uses an unsupported publication protocol.", "No comments were posted because this publisher cannot safely read the report.", "Update the Review publication installation, then run Review change again."],
  unsupported_transfer_encoding: ["The browser request encoding is unsupported.", "No comments were posted because chunked local requests are not accepted.", "Return to the report and request publication again."]
};
var PUBLICATION_ERROR_OUTCOMES = Object.freeze(Object.keys(ERROR_OUTCOMES));
var PRE_CREATE_REJECTION_BRANCHES = Object.freeze({
  http: Object.freeze([
    "duplicate_http_header",
    "incomplete_http_request",
    "invalid_content_length",
    "invalid_http_framing",
    "invalid_http_header",
    "invalid_http_request",
    "invalid_http_request_line",
    "invalid_publication_endpoint",
    "request_body_too_large",
    "request_headers_too_large",
    "request_timeout",
    "request_too_large",
    "unsupported_transfer_encoding"
  ]),
  server: Object.freeze([
    "confirmation_expired",
    "forbidden_host",
    "github_actor_changed",
    "invalid_confirmation_token",
    "inline_location_unverifiable",
    "invalid_finding_selection",
    "invalid_inline_location",
    "invalid_publication",
    "invalid_publication_claims",
    "invalid_publication_request",
    "invalid_publication_token",
    "not_found",
    "os_confirmation_denied",
    "os_confirmation_dismissed",
    "os_confirmation_failed",
    "os_confirmation_invalid_response",
    "os_confirmation_timeout",
    "os_confirmation_unavailable",
    "pull_request_scope_changed",
    "publisher_busy",
    "request_too_large",
    "unsupported_media_type",
    "unsupported_publication_protocol"
  ]),
  provider: Object.freeze([
    "github_actor_changed",
    "inline_location_unverifiable",
    "invalid_inline_location",
    "provider_authentication_failed",
    "provider_failed",
    "provider_invalid_response",
    "provider_output_limit",
    "provider_permission_denied",
    "provider_rate_limited",
    "provider_timeout",
    "provider_unavailable",
    "publication_reconciliation_conflict",
    "pull_request_scope_changed",
    "request_timeout"
  ])
});
var POST_CREATE_OUTCOME_BRANCHES = Object.freeze(["publication_outcome_unknown"]);
function publicationErrorContent(code) {
  const outcome = ERROR_OUTCOMES[code] ?? ERROR_OUTCOMES.invalid_publication;
  return { heading: outcome[0], impact: outcome[1], action: outcome[2] };
}

// skills/review-change/runtime/review-publication-html.mjs
var CONFIRMATION_PATH = "/api/v1/review-publication-confirmations";
var SELECTION_SCRIPT = `(()=>{const boxes=[...document.querySelectorAll('input[name="selected_finding_id"]')];const output=document.querySelector('#publication-general-comment');const count=document.querySelector('#publication-selected-count');function update(){const selected=boxes.filter(box=>box.checked).map(box=>box.closest('[data-finding-id]').querySelector('strong').textContent);count.textContent=String(selected.length);output.textContent=selected.length===0?'Review completed. No Findings were selected for publication.':'Review found '+selected.length+' '+(selected.length===1?'issue':'issues')+' worth addressing:\\n\\n'+selected.map(title=>'- '+title).join('\\n')}boxes.forEach(box=>box.addEventListener('change',update));document.querySelector('[data-initial-focus]')?.focus();update()})()`;
var PAGE_SCRIPT = `document.querySelector('[data-initial-focus]')?.focus();const change=document.querySelector('#change-selection');const form=document.querySelector('form');change?.addEventListener('click',()=>history.back());form?.addEventListener('submit',()=>{const submit=form.querySelector('button[type="submit"]');if(submit)submit.disabled=true})`;
var PUBLICATION_SCRIPT_HASH = crypto4.createHash("sha256").update(PAGE_SCRIPT).digest("base64");
var STYLE = `
:root{color-scheme:dark;--bg:#0c111b;--panel:#131b29;--panel2:#192438;--line:#2b3b55;--text:#edf3fc;--muted:#a9b8cd;--blue:#78b2ff;--green:#70dda5;--amber:#f2c66d;--red:#ff8999}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% -10%,#19345b 0,transparent 35%),var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.publication-page{width:min(100% - 32px,980px);margin:0 auto;padding:48px 0 72px}.publication-panel{border:1px solid var(--line);border-radius:18px;background:linear-gradient(145deg,var(--panel2),var(--panel));box-shadow:0 22px 70px #02050a99;overflow:hidden}.publication-head,.publication-body,.publication-actions{padding:24px}.publication-head{border-bottom:1px solid var(--line)}.publication-body{display:grid;gap:18px}.publication-selection{display:grid;gap:18px}.publication-selection-grid{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:20px;align-items:start}.publication-findings{display:grid;gap:12px;min-width:0;margin:0;border:0;padding:24px}.publication-summary{position:sticky;top:16px}.publication-summary .publication-body{gap:14px}.publication-count{margin:0;font-size:1.05rem}.publication-count output{font-size:1.8rem;font-weight:800}.publication-confirmation-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start}.publication-confirmation-details,.publication-confirmation-comments{min-width:0}.publication-actions{display:flex;justify-content:flex-end;gap:12px;border-top:1px solid var(--line)}.publication-eyebrow{margin:0 0 8px;color:var(--blue);font-size:.75rem;font-weight:800;letter-spacing:.13em;text-transform:uppercase}h1,h2,h3,p{overflow-wrap:anywhere}h1{margin:0;font-size:clamp(2rem,7vw,3.5rem);line-height:1.05}h2{margin:0 0 8px}h3{margin:0}.publication-lead,.publication-muted{color:var(--muted)}.publication-finding,.publication-preview,.publication-facts,.publication-notice{border:1px solid var(--line);border-radius:13px;background:#0f1724;padding:16px}.publication-finding{display:grid;grid-template-columns:auto minmax(0,1fr);gap:14px}.publication-finding input{width:20px;height:20px;margin-top:4px}.publication-finding strong{display:block;font-size:1.05rem}.finding-anchor{display:block;color:var(--muted);font:13px ui-monospace,SFMono-Regular,monospace}.publication-preview{white-space:pre-wrap}.publication-facts{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:8px 16px;margin:0}.publication-facts dt{color:var(--muted)}.publication-facts dd{margin:0;font-weight:650}.publication-notice{border-color:#386b50;background:#10251c}.publication-button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;border:1px solid #45658f;border-radius:10px;background:#17263c;color:var(--text);padding:10px 16px;font-weight:750;text-decoration:none}.publication-button.primary{border-color:#5795ed;background:#3678e5}.publication-button:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid #fff;outline-offset:3px}.publication-terminal{text-align:center;padding:44px 24px}.publication-terminal .publication-icon{display:grid;width:58px;height:58px;margin:0 auto 18px;place-items:center;border:2px solid currentColor;border-radius:50%;font-size:1.7rem;font-weight:850}.publication-terminal.success{color:var(--green)}.publication-terminal.stale{color:var(--amber)}.publication-terminal.error{color:var(--red)}.publication-terminal h1,.publication-terminal p,.publication-terminal a{color:var(--text)}.publication-secondary{font-size:.82rem;color:var(--muted)}@media(max-width:800px){.publication-selection-grid,.publication-confirmation-grid{grid-template-columns:1fr}.publication-summary{position:static}}@media(max-width:600px){.publication-page{width:min(100% - 20px,980px);padding:20px 0}.publication-head,.publication-body,.publication-actions,.publication-findings{padding:18px}.publication-actions{align-items:stretch;flex-direction:column-reverse}.publication-button{width:100%}.publication-facts{grid-template-columns:1fr;gap:3px}.publication-facts dd{margin-bottom:9px}}
`;
function renderPublicationFragment({ publicationToken, findings, review = selectionReview(findings), publisherUrl = "http://127.0.0.1:4392" }) {
  return `<style data-review-publication-styles>${STYLE}</style><section aria-labelledby="review-publication-heading">${renderSelection({
    publicationToken,
    findings,
    review,
    action: `${publisherUrl}${CONFIRMATION_PATH}`,
    headingLevel: 2
  })}</section><script>${SELECTION_SCRIPT}</script>`;
}
function renderConfirmationPage(claims, review, confirmationToken) {
  const comments = review.findings.map((finding) => `<article class="publication-preview"><h3>${escapeHtml(finding.title)}</h3><span class="finding-anchor">${escapeHtml(finding.path)}:${finding.line}</span><p>${escapeHtml(finding.body)}</p></article>`).join("");
  const content = `<main class="publication-page" data-review-publication-state="confirmation"><div class="publication-panel"><header class="publication-head"><p class="publication-eyebrow">Browser review</p><h1 tabindex="-1" data-initial-focus>Post this review to GitHub?</h1><p class="publication-lead">Nothing has been posted yet. Check the account, pull request, and selected comments. The final action opens a separate operating-system confirmation.</p></header><div class="publication-body publication-confirmation-grid"><section class="publication-confirmation-details" aria-labelledby="details-heading"><h2 id="details-heading">Publication details</h2><dl class="publication-facts"><dt>GitHub account</dt><dd>@${escapeHtml(claims.actor.login)}</dd><dt>Destination</dt><dd>${escapeHtml(claims.repository.nameWithOwner)} · PR #${claims.pullRequest.number}</dd><dt>Review type</dt><dd>Comment only</dd><dt>Selected scope</dt><dd>Base ${escapeHtml(shortOid(claims.scope.baseOid))} · Head ${escapeHtml(shortOid(claims.scope.headOid))}</dd></dl><div class="publication-notice"><strong>The pull request still matches this report.</strong><p class="publication-muted">The pull request is open and both commits are unchanged.</p></div></section><section class="publication-confirmation-comments" aria-labelledby="comments-heading"><h2 id="comments-heading">Comments to publish</h2><article class="publication-preview"><h3>General comment</h3><p>${escapeHtml(review.generalComment)}</p></article>${comments}</section></div><div class="publication-actions"><button class="publication-button" id="change-selection" type="button">← Change selection</button><form method="post" action="/api/v1/review-publications"><input type="hidden" name="confirmation_token" value="${escapeHtml(confirmationToken)}"><button class="publication-button primary" type="submit">Post review to GitHub</button></form></div></div></main>`;
  return page("Confirm Review publication", content, PAGE_SCRIPT);
}
function renderSuccessPage(claims, providerReview, { cleanupTrouble = false } = {}) {
  const cleanupNotice = cleanupTrouble ? '<p class="publication-secondary">Local publication cleanup did not finish. The review is posted. Wait before retrying; a later retry will reconcile the exact review.</p>' : "";
  const content = `<main class="publication-page" data-review-publication-state="posted"><div class="publication-panel publication-terminal success"><div class="publication-icon" aria-hidden="true">✓</div><h1 tabindex="-1" data-initial-focus>Review posted.</h1><p>GitHub accepted the comment review for ${escapeHtml(claims.repository.nameWithOwner)} · PR #${claims.pullRequest.number}.</p><p class="publication-secondary">Posted by @${escapeHtml(claims.actor.login)} · Review #${escapeHtml(providerReview.reviewId)}</p>${cleanupNotice}<a class="publication-button primary" href="${escapeHtml(providerReview.url)}">Open review on GitHub</a></div></main>`;
  return page("Review posted", content, PAGE_SCRIPT);
}
function renderErrorPage(code, details = {}) {
  const stale = new Set(["pull_request_scope_changed", "invalid_inline_location"]).has(code);
  const content = errorContent(code, details);
  const state = stale ? "stale" : "error";
  return page("Review publication error", `<main class="publication-page" data-review-publication-state="${state}" data-publication-error="${escapeHtml(code)}"><div class="publication-panel publication-terminal ${state}"><div class="publication-icon" aria-hidden="true">!</div><h1 tabindex="-1" data-initial-focus>${escapeHtml(content.heading)}</h1><p>${escapeHtml(content.impact)}</p><p><strong>${escapeHtml(content.action)}</strong></p>${content.secondary ? `<p class="publication-secondary">${escapeHtml(content.secondary)}</p>` : ""}</div></main>`, PAGE_SCRIPT);
}
function renderSelection({ publicationToken, findings, review, action, headingLevel }) {
  const cards = findings.map((finding, index) => `<article class="publication-finding" data-finding-id="${escapeHtml(finding.id)}"><input ${index === 0 ? "data-initial-focus " : ""}type="checkbox" checked name="selected_finding_id" value="${escapeHtml(finding.id)}" aria-label="${escapeHtml(`${finding.title}, ${finding.path}:${finding.line}`)}"><div><strong>${escapeHtml(finding.title)}</strong><span class="finding-anchor">${escapeHtml(finding.path)}:${finding.line}</span><p>${escapeHtml(finding.body)}</p></div></article>`).join("");
  const heading = `h${headingLevel}`;
  const headingId = headingLevel === 2 ? ' id="review-publication-heading"' : "";
  const emptyFocus = findings.length === 0 ? " data-initial-focus" : "";
  return `<div class="publication-selection" data-review-publication-state="selection"><header class="publication-head"><p class="publication-eyebrow">Review publication</p><${heading}${headingId}>Select Findings</${heading}><p class="publication-lead">All Findings are selected. Clear any comment that should not be posted.</p></header><form id="review-publication-selection" method="post" action="${escapeHtml(action)}"><div class="publication-selection-grid"><section class="publication-panel publication-findings-panel" aria-labelledby="publication-findings-heading"><header class="publication-head"><h3 id="publication-findings-heading">Choose inline comments</h3><p class="publication-muted">Clear anything that should not be published.</p></header><fieldset class="publication-findings"><legend>Findings selected for publication</legend>${cards}</fieldset></section><aside class="publication-panel publication-summary" aria-labelledby="publication-summary-heading"><header class="publication-head"><h3 id="publication-summary-heading">General comment</h3><p class="publication-muted">Generated from the current selection and never edited by hand.</p></header><div class="publication-body"><p class="publication-count"><output id="publication-selected-count" role="status">${findings.length}</output> inline comments selected</p><output class="publication-preview" id="publication-general-comment">${escapeHtml(review.generalComment)}</output><p class="publication-muted">The general and inline comments stay read-only.</p></div><div class="publication-actions"><button class="publication-button primary"${emptyFocus} type="submit">Review before posting</button></div></aside></div><input type="hidden" name="publication_token" value="${escapeHtml(publicationToken)}"></form></div>`;
}
function errorContent(code, details) {
  const content = publicationErrorContent(code);
  if (code === "publication_outcome_unknown")
    return {
      ...content,
      secondary: "The publisher will use marker reconciliation before it tries to create another review."
    };
  if (code === "github_actor_changed" && details.expectedActor && details.currentActor)
    return {
      ...content,
      impact: `No comments were posted because this report expected @${details.expectedActor}, but @${details.currentActor} is active.`,
      action: `Sign in to the GitHub command-line app as @${details.expectedActor}, then try again.`
    };
  if (code === "invalid_inline_location") {
    const finding = details.details;
    const identifier = finding?.title ? `${finding.title} (${finding.findingId})` : finding?.findingId;
    const location = finding?.path && Number.isInteger(finding?.line) ? `${finding.path}:${finding.line}` : "the selected line";
    return identifier ? {
      ...content,
      impact: `No comments were posted because ${identifier} at ${location} is not in the reviewed changes.`
    } : content;
  }
  if (["provider_unavailable", "provider_output_limit", "provider_timeout", "provider_failed"].includes(code)) {
    return {
      ...content,
      impact: details.phase === "publication" ? "No comments were posted because final publication stopped before GitHub could accept the review." : "No comments were posted because read-only confirmation could not finish."
    };
  }
  return content;
}
function page(title, content, script = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style data-review-publication-styles>${STYLE}</style></head><body>${content}${script ? `<script>${script}</script>` : ""}</body></html>`;
}
function selectionReview(findings) {
  const count = findings.length;
  return {
    findings,
    generalComment: count === 0 ? "Review completed. No Findings were selected for publication." : `Review found ${count} ${count === 1 ? "issue" : "issues"} worth addressing:

${findings.map((finding) => `- ${finding.title}`).join(`
`)}`
  };
}
function shortOid(value) {
  return value.slice(0, 8);
}

// skills/review-change/runtime/review-publication-socket.mjs
import { fstatSync } from "node:fs";
function validateInheritedPublicationSocket({
  inputDescriptor = 0,
  outputDescriptor = 1,
  descriptorState = fstatSync
} = {}) {
  let input;
  let output;
  try {
    input = descriptorState(inputDescriptor);
    output = descriptorState(outputDescriptor);
  } catch {
    throw inheritedSocketError();
  }
  if (!input.isSocket() || !output.isSocket() || input.dev !== output.dev || input.ino !== output.ino) {
    throw inheritedSocketError();
  }
}
function inheritedSocketError() {
  return new Error("Review publication requires one inherited accepted socket on standard input and output. Repair the user service installation, then try again.");
}

// skills/review-change/runtime/review-publication-os-confirmation.mjs
import { spawn as spawn2 } from "node:child_process";
import path3 from "node:path";
var PROMPT_TIMEOUT_SECONDS = 60;
var APPROVAL_LABEL = "Post review";
function createOperatingSystemConfirmation({ promptRunner } = {}) {
  const runPrompt = promptRunner ?? (async () => ({ outcome: "unavailable" }));
  return async (claims, review, context = {}) => {
    const prompt = publicationPrompt(claims, review);
    const response = await runPrompt({ prompt, signal: context.signal });
    if (response?.outcome === "approved")
      return;
    throw confirmationError(response?.outcome);
  };
}
function createOperatingSystemPromptRunner({
  platform,
  executable,
  spawnProcess = spawn2,
  timeoutMs = OS_CONFIRMATION_TIMEOUT_MS,
  terminationGraceMs = PROCESS_TERMINATION_GRACE_MS
} = {}) {
  return async ({ prompt, signal }) => {
    if (!isSupportedPlatform(platform) || !isAbsoluteExecutable(executable)) {
      return { outcome: "unavailable" };
    }
    return runPromptProcess({
      args: promptArguments(platform, prompt),
      executable,
      platform,
      signal,
      spawnProcess,
      terminationGraceMs,
      timeoutMs
    });
  };
}
function publicationPrompt(claims, review) {
  const selectedCount = review.findings.length;
  return [
    "Approve this GitHub Review publication?",
    "",
    `GitHub actor: @${claims.actor.login} (ID ${claims.actor.id})`,
    `Repository: ${claims.repository.nameWithOwner} (ID ${claims.repository.id})`,
    `Pull request: #${claims.pullRequest.number} (ID ${claims.pullRequest.id})`,
    `Base commit: ${claims.scope.baseOid}`,
    `Head commit: ${claims.scope.headOid}`,
    `Selected Findings: ${selectedCount}`,
    `Inline comments included: ${selectedCount > 0 ? "Yes" : "No"}`,
    "",
    "Choose Post review only if you want to publish this exact review now."
  ].join(`
`);
}
function promptArguments(platform, prompt) {
  if (platform === "macos") {
    const script = `display dialog ${appleScriptString(prompt)} with title "Review publication" buttons {"Cancel", "${APPROVAL_LABEL}"} default button "${APPROVAL_LABEL}" cancel button "Cancel" with icon caution giving up after ${PROMPT_TIMEOUT_SECONDS}`;
    return ["-e", script];
  }
  return [
    "--question",
    "--title=Review publication",
    `--text=${prompt}`,
    `--ok-label=${APPROVAL_LABEL}`,
    "--cancel-label=Cancel",
    `--timeout=${PROMPT_TIMEOUT_SECONDS}`,
    "--no-wrap"
  ];
}
function runPromptProcess(options) {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted)
      return reject(cancellationError2());
    let child;
    try {
      child = options.spawnProcess(options.executable, options.args, {
        env: confirmationEnvironment(),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      return resolve({ outcome: unavailableProcess(error) ? "unavailable" : "failed" });
    }
    observePromptProcess(child, options, resolve, reject);
  });
}
function observePromptProcess(child, options, resolve, reject) {
  const stdout = [];
  const stderr = [];
  let termination = "";
  let settled = false;
  let forceTimer;
  const settle = (error, response) => {
    if (settled)
      return;
    settled = true;
    clearTimeout(timeoutTimer);
    clearTimeout(forceTimer);
    options.signal?.removeEventListener("abort", cancel);
    if (error)
      reject(error);
    else
      resolve(response);
  };
  const forceSettle = () => {
    child.kill("SIGKILL");
    child.stdout?.destroy?.();
    child.stderr?.destroy?.();
    child.unref?.();
    settle(termination === "cancelled" ? cancellationError2() : null, { outcome: "timeout" });
  };
  const terminate = (reason) => {
    if (termination)
      return;
    termination = reason;
    child.kill("SIGTERM");
    forceTimer = setTimeout(forceSettle, options.terminationGraceMs);
  };
  const cancel = () => terminate("cancelled");
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timeoutTimer = setTimeout(() => terminate("timeout"), options.timeoutMs);
  timeoutTimer.unref?.();
  if (options.signal?.aborted)
    cancel();
  child.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  child.once("error", (error) => {
    if (termination === "cancelled")
      return settle(cancellationError2());
    if (termination === "timeout")
      return settle(null, { outcome: "timeout" });
    settle(null, { outcome: unavailableProcess(error) ? "unavailable" : "failed" });
  });
  child.once("close", (status, processSignal) => {
    if (termination === "cancelled")
      return settle(cancellationError2());
    if (termination === "timeout")
      return settle(null, { outcome: "timeout" });
    settle(null, interpretProcessResponse(options.platform, status, processSignal, stdout, stderr));
  });
}
function interpretProcessResponse(platform, status, processSignal, stdoutChunks, stderrChunks) {
  if (processSignal)
    return { outcome: "dismissed" };
  const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
  const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
  if (platform === "macos") {
    if (status === 0 && new RegExp(`^button returned:${APPROVAL_LABEL}(?:, gave up:false)?$`).test(stdout)) {
      return { outcome: "approved" };
    }
    if (status === 0 && /gave up:true/.test(stdout))
      return { outcome: "timeout" };
    if (status === 1 && /User canceled|\(-128\)/i.test(stderr))
      return { outcome: "denied" };
    if (status === 0)
      return { outcome: "malformed" };
    return { outcome: "failed" };
  }
  if (status === 0 && stdout === "")
    return { outcome: "approved" };
  if (/cannot open display|unable to init server|cannot connect|org\.freedesktop/i.test(stderr)) {
    return { outcome: "unavailable" };
  }
  if (status === 1)
    return { outcome: "denied" };
  if (status === 5)
    return { outcome: "timeout" };
  if (status === 0)
    return { outcome: "malformed" };
  return { outcome: "failed" };
}
function confirmationError(outcome) {
  const definitions = {
    denied: [403, "os_confirmation_denied", "Operating-system confirmation was denied"],
    dismissed: [403, "os_confirmation_dismissed", "Operating-system confirmation was dismissed"],
    timeout: [504, "os_confirmation_timeout", "Operating-system confirmation timed out"],
    unavailable: [503, "os_confirmation_unavailable", "Operating-system confirmation is unavailable"],
    malformed: [502, "os_confirmation_invalid_response", "Operating-system confirmation returned an invalid response"],
    failed: [503, "os_confirmation_failed", "Operating-system confirmation failed"]
  };
  const [status, code, message] = definitions[outcome] ?? definitions.malformed;
  return Object.assign(new Error(message), { status, code });
}
function cancellationError2() {
  return Object.assign(new Error("Review publication request timed out"), {
    code: "request_timeout",
    status: 504
  });
}
function appleScriptString(value) {
  return value.split(`
`).map((line) => `"${line.replaceAll("\\", "\\\\").replaceAll('"', "\\\"")}"`).join(" & return & ");
}
function confirmationEnvironment() {
  const environment = {};
  for (const name of ["DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL"]) {
    if (process.env[name] !== undefined)
      environment[name] = process.env[name];
  }
  return environment;
}
function unavailableProcess(error) {
  return ["ENOENT", "EACCES"].includes(error?.code);
}
function isSupportedPlatform(value) {
  return value === "macos" || value === "linux";
}
function isAbsoluteExecutable(value) {
  return typeof value === "string" && path3.isAbsolute(value);
}

// skills/review-change/runtime/review-publication-inetd.mjs
import http from "node:http";
var MAX_HEADER_BYTES = 16 * 1024;
var MAX_INTERNAL_RESPONSE_BODY_BYTES = 2 * 1024 * 1024;
var HEADER_TERMINATOR_BYTES = 4;
var MAX_BUFFER_BYTES = MAX_HEADER_BYTES + HEADER_TERMINATOR_BYTES + MAX_PUBLICATION_REQUEST_BODY_BYTES;
var CONFIRMATION_PATH2 = "/api/v1/review-publication-confirmations";
var PUBLICATION_PATH = "/api/v1/review-publications";
var PUBLICATION_PATHS = new Set([CONFIRMATION_PATH2, PUBLICATION_PATH]);
var END_TO_END_RESPONSE_HEADERS = new Set([
  "cache-control",
  "content-security-policy",
  "content-type",
  "referrer-policy",
  "x-frame-options"
]);
async function relayInetdRequest(serverUrl, request, signal) {
  const selectedPath = exactPublicationPath(request.path);
  const port = loopbackServerPort(serverUrl);
  return new Promise((resolve, reject) => {
    let settled = false;
    let outgoing;
    const settle = (error, value) => {
      if (settled)
        return;
      settled = true;
      signal?.removeEventListener("abort", cancel);
      if (error)
        reject(error);
      else
        resolve(value);
    };
    const cancel = () => {
      const error = requestError(504, "request_timeout");
      settle(error);
      outgoing?.destroy(error);
    };
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted)
      return cancel();
    outgoing = http.request({
      protocol: "http:",
      hostname: "127.0.0.1",
      port,
      path: selectedPath,
      method: request.method,
      maxHeaderSize: MAX_HEADER_BYTES,
      headers: {
        "content-type": request.headers["content-type"] ?? "",
        host: request.headers.host ?? ""
      },
      signal
    }, (response) => collectInternalResponse(response, outgoing, settle));
    outgoing.once("error", (error) => settle(error));
    outgoing.end(request.body);
  });
}
function collectInternalResponse(response, outgoing, settle) {
  const chunks = [];
  let bodyBytes = 0;
  response.on("data", (chunk) => {
    bodyBytes += chunk.length;
    if (bodyBytes > MAX_INTERNAL_RESPONSE_BODY_BYTES) {
      const error = internalResponseError("internal_response_too_large");
      settle(error);
      response.destroy(error);
      outgoing.destroy(error);
      return;
    }
    chunks.push(Buffer.from(chunk));
  });
  response.once("aborted", () => settle(internalResponseError("internal_response_aborted")));
  response.once("error", (error) => settle(error));
  response.once("end", () => settle(null, {
    status: response.statusCode ?? 502,
    headers: response.headers,
    body: Buffer.concat(chunks, bodyBytes).toString("utf8")
  }));
}
function exactPublicationPath(candidate) {
  if (!PUBLICATION_PATHS.has(candidate))
    throw requestError(400, "invalid_publication_endpoint");
  return candidate;
}
function loopbackServerPort(serverUrl) {
  let target;
  try {
    target = new URL(serverUrl);
  } catch {
    throw internalResponseError("invalid_internal_origin");
  }
  if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" || !target.port || target.username || target.password || target.pathname !== "/" || target.search || target.hash) {
    throw internalResponseError("invalid_internal_origin");
  }
  return target.port;
}
function internalResponseError(code) {
  return Object.assign(new Error(code), { code, status: 502 });
}
async function handleInetdRequest({
  input,
  output,
  dispatch,
  requestTimeoutMs = REQUEST_WORK_TIMEOUT_MS,
  responseFlushTimeoutMs = RESPONSE_FLUSH_TIMEOUT_MS
}) {
  const controller = new AbortController;
  const context = requestContext(controller.signal);
  const connection = observeConnection(input, output, controller);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(requestError(504, "request_timeout"));
    input.destroy?.();
  }, requestTimeoutMs);
  timer.unref?.();
  const outcome = await readAndDispatch(input, dispatch, context).then((response) => ({ response })).catch((error) => ({ error }));
  clearTimeout(timer);
  connection.dispose();
  if (!timedOut && !connection.disconnected() && outcome.response) {
    return writeHttpResponse(output, outcome.response, responseFlushTimeoutMs);
  }
  const typed = timedOut ? timeoutOutcome(context) : !context.dispatchStarted && outcome.error?.publicationParserError ? parserError(outcome.error) : connection.disconnected() ? cancellationOutcome(context) : responseError(outcome.error);
  await writeHttpResponse(output, {
    status: typed.status,
    headers: safeHtmlHeaders(),
    body: renderErrorPage(typed.code, { phase: context.phase })
  }, responseFlushTimeoutMs);
}
async function readAndDispatch(input, dispatch, context) {
  const request = await readHttpRequest(input);
  exactPublicationPath(request.path);
  context.phase = request.path === PUBLICATION_PATH ? "publication" : "confirmation";
  if (context.signal.aborted)
    throw requestError(504, "request_timeout");
  context.dispatchStarted = true;
  return dispatch(request, context);
}
function requestContext(signal) {
  const context = {
    signal,
    phase: "confirmation",
    dispatchStarted: false,
    mutationMayHaveStarted: false,
    cleanupTrouble: false,
    markMutationStarted: () => {
      context.mutationMayHaveStarted = true;
    },
    markCleanupTrouble: () => {
      context.cleanupTrouble = true;
    }
  };
  return context;
}
function observeConnection(input, output, controller) {
  let wasDisconnected = false;
  const disconnect = () => {
    wasDisconnected = true;
    if (!controller.signal.aborted)
      controller.abort(requestError(504, "request_timeout"));
  };
  const observations = [[input, "close"], [input, "error"], [output, "close"], [output, "error"]];
  for (const [stream, event] of observations)
    stream.on?.(event, disconnect);
  return {
    disconnected: () => wasDisconnected,
    dispose: () => {
      for (const [stream, event] of observations)
        stream.off?.(event, disconnect);
    }
  };
}
function timeoutOutcome(context) {
  return cancellationOutcome(context);
}
function cancellationOutcome(context) {
  return context.mutationMayHaveStarted ? requestError(502, "publication_outcome_unknown") : requestError(504, "request_timeout");
}
async function readHttpRequest(input) {
  let buffer = Buffer.alloc(0);
  let expectedBytes = null;
  const iterator = input[Symbol.asyncIterator]();
  while (true) {
    const { value: rawChunk, done } = await iterator.next();
    if (done)
      break;
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    const bufferLimit = expectedBytes ?? MAX_BUFFER_BYTES;
    if (chunk.length > bufferLimit - buffer.length)
      throw requestError(413, "request_too_large");
    buffer = Buffer.concat([buffer, chunk], buffer.length + chunk.length);
    if (expectedBytes !== null) {
      if (buffer.length < expectedBytes)
        continue;
      if (buffer.length > expectedBytes)
        throw requestError(400, "invalid_http_framing");
      return parseCompleteRequest(buffer, expectedBytes);
    }
    const separator = buffer.indexOf(`\r
\r
`);
    if (separator === -1) {
      if (buffer.length >= MAX_HEADER_BYTES)
        throw requestError(413, "request_headers_too_large");
      continue;
    }
    const bodyStart = separator + HEADER_TERMINATOR_BYTES;
    if (bodyStart > MAX_HEADER_BYTES)
      throw requestError(413, "request_headers_too_large");
    const parsed = parseHeader(buffer.subarray(0, separator).toString("ascii"));
    const contentLength = parseContentLength(parsed.headers["content-length"]);
    expectedBytes = bodyStart + contentLength;
    if (buffer.length < expectedBytes)
      continue;
    if (buffer.length > expectedBytes)
      throw requestError(400, "invalid_http_framing");
    return {
      ...parsed,
      body: buffer.subarray(bodyStart, expectedBytes).toString("utf8")
    };
  }
  throw requestError(400, "incomplete_http_request");
}
function parseCompleteRequest(buffer, expectedBytes) {
  const separator = buffer.indexOf(`\r
\r
`);
  const parsed = parseHeader(buffer.subarray(0, separator).toString("ascii"));
  return {
    ...parsed,
    body: buffer.subarray(separator + HEADER_TERMINATOR_BYTES, expectedBytes).toString("utf8")
  };
}
function parseHeader(header) {
  const [requestLine, ...lines] = header.split(`\r
`);
  const match = /^(POST) (\/[^ ]*) HTTP\/1\.[01]$/.exec(requestLine);
  if (!match)
    throw requestError(400, "invalid_http_request_line");
  const headers = {};
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator < 1)
      throw requestError(400, "invalid_http_header");
    const name = line.slice(0, separator).trim().toLowerCase();
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(name))
      throw requestError(400, "invalid_http_header");
    if (headers[name] !== undefined)
      throw requestError(400, "duplicate_http_header");
    headers[name] = line.slice(separator + 1).trim();
  }
  if (headers["transfer-encoding"])
    throw requestError(400, "unsupported_transfer_encoding");
  return { method: match[1], path: match[2], headers };
}
function parseContentLength(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value))
    throw requestError(400, "invalid_content_length");
  const contentLength = Number(value);
  if (!Number.isSafeInteger(contentLength) || contentLength > MAX_PUBLICATION_REQUEST_BODY_BYTES) {
    throw requestError(413, "request_body_too_large");
  }
  return contentLength;
}
function writeHttpResponse(output, response, timeoutMs) {
  const body = Buffer.from(response.body);
  const headers = Object.fromEntries(Object.entries(response.headers).map(([name, value]) => [name.toLowerCase(), value]).filter(([name]) => END_TO_END_RESPONSE_HEADERS.has(name)));
  headers.connection = "close";
  headers["content-length"] = String(body.length);
  const head = [`HTTP/1.1 ${response.status} ${statusText(response.status)}`].concat(Object.entries(headers).map(([name, value]) => `${name}: ${value}`)).concat("", "").join(`\r
`);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timer);
      output.off?.("error", finish);
      output.off?.("close", finish);
      resolve();
    };
    output.once?.("error", finish);
    output.once?.("close", finish);
    const timer = setTimeout(() => {
      output.destroy?.();
      finish();
    }, timeoutMs);
    timer.unref?.();
    output.write(head);
    output.end(body, finish);
  });
}
function safeHtmlHeaders() {
  return {
    "cache-control": "no-store",
    "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${PUBLICATION_SCRIPT_HASH}'; form-action 'none'; frame-ancestors 'none'`,
    "content-type": "text/html; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY"
  };
}
function parserError(error) {
  return error?.publicationParserError ? error : requestError(400, "invalid_http_request");
}
function responseError(error) {
  if (error?.publicationParserError || error?.publicationResponseError)
    return error;
  return requestError(400, "invalid_http_request");
}
function requestError(status, code) {
  return Object.assign(new Error(code), { status, code, publicationParserError: true });
}
function statusText(status) {
  return { 200: "OK", 201: "Created", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 409: "Conflict", 413: "Payload Too Large", 415: "Unsupported Media Type", 422: "Unprocessable Content", 429: "Too Many Requests", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout" }[status] ?? "Error";
}

// skills/review-change/runtime/review-publication-server.mjs
import http2 from "node:http";
var CONFIRMATION_PATH3 = "/api/v1/review-publication-confirmations";
var PUBLICATION_PATH2 = "/api/v1/review-publications";
async function createReviewPublicationServer(dependencies) {
  const activeRequests = new Set;
  const server = http2.createServer((request, response) => {
    const context = createRequestContext(request, dependencies.requestContext);
    const operation = handleRequest(request, response, dependencies, context).catch((error) => {
      if (!response.destroyed)
        renderPublicationError(response, error, requestPhase(request.url));
    }).finally(context.dispose);
    activeRequests.add(operation);
    operation.then(() => activeRequests.delete(operation), () => activeRequests.delete(operation));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: (timeoutMs = CLEANUP_TIMEOUT_MS) => closeServer(server, activeRequests, timeoutMs)
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
      if (error)
        reject(error);
      else
        resolve();
    });
  });
}
function renderPublicationError(response, error, phase = "confirmation") {
  const status = error?.status ?? 422;
  const code = error?.code ?? "invalid_publication";
  renderHtml(response, status, renderErrorPage(code, { ...error, phase }));
}
async function handleRequest(request, response, dependencies, context) {
  if (dependencies.expectedHost && request.headers.host !== dependencies.expectedHost) {
    throw httpError(403, "forbidden_host");
  }
  if (request.method !== "POST")
    throw httpError(404, "not_found");
  const mediaType = String(request.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/x-www-form-urlencoded")
    throw httpError(415, "unsupported_media_type");
  const form = new URLSearchParams(await readBody(request));
  if (request.url === CONFIRMATION_PATH3)
    return confirmPublication(form, response, dependencies, context);
  if (request.url === PUBLICATION_PATH2)
    return publishReview(form, response, dependencies, context);
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
    cleanupTrouble: context.hasCleanupTrouble()
  }));
}
function createRequestContext(request, parent) {
  const controller = new AbortController;
  let cleanupTrouble = false;
  const abort = () => controller.abort();
  request.once("aborted", abort);
  const signal = parent?.signal ? AbortSignal.any([parent.signal, controller.signal]) : controller.signal;
  return {
    signal,
    markMutationStarted: parent?.markMutationStarted ?? (() => {}),
    markCleanupTrouble: () => {
      cleanupTrouble = true;
      parent?.markCleanupTrouble?.();
    },
    hasCleanupTrouble: () => cleanupTrouble,
    dispose: () => request.off("aborted", abort)
  };
}
function requestPhase(url) {
  return url === PUBLICATION_PATH2 ? "publication" : "confirmation";
}
function verifyFormFields(form, allowed, requiredSingleton) {
  if ([...form.keys()].some((name) => !allowed.has(name)) || form.getAll(requiredSingleton).length !== 1) {
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
      body: finding.body
    })),
    scope: claims
  };
}
async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_PUBLICATION_REQUEST_BODY_BYTES)
      throw httpError(413, "request_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size).toString("utf8");
}
function verifyCurrentScope(claims, current) {
  const actorMatches = current.actor.id === claims.actor.id && current.actor.login === claims.actor.login;
  if (!actorMatches) {
    throw httpError(403, "github_actor_changed", {
      expectedActor: claims.actor.login,
      currentActor: current.actor.login
    });
  }
  const scopeMatches = current.repository.id === claims.repository.id && current.repository.nameWithOwner === claims.repository.nameWithOwner && current.pullRequest.id === claims.pullRequest.id && current.pullRequest.number === claims.pullRequest.number && current.pullRequest.state === "OPEN" && current.scope.baseOid === claims.scope.baseOid && current.scope.headOid === claims.scope.headOid;
  if (!scopeMatches)
    throw httpError(409, "pull_request_scope_changed");
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
    "x-frame-options": "DENY"
  });
  response.end(body);
}
function httpError(status, code, details = {}) {
  return Object.assign(new Error(code), { status, code, ...details });
}

// skills/review-change/runtime/review-publication-worker-config.mjs
import { constants as constants3 } from "node:fs";
import { lstat as lstat2, open as open2 } from "node:fs/promises";
import os2 from "node:os";
import path4 from "node:path";
var CONFIGURATION_VERSION = 1;
var MAX_CONFIGURATION_BYTES = 16 * 1024;
var MANAGED_BY = "Managed by ai-config: review-publication";
var CONFIGURATION_KEYS = [
  "confirmationExecutable",
  "githubExecutable",
  "managedBy",
  "version"
];
async function loadReviewPublicationWorkerConfiguration({
  home = os2.homedir(),
  runtimePlatform = process.platform
} = {}) {
  const platform = supportedPlatform(runtimePlatform);
  const directory = path4.join(home, ".review-publication");
  await validatePrivateDirectory(directory);
  const configuration = await readPrivateConfiguration(path4.join(directory, "worker-config.json"));
  validateConfiguration(configuration);
  return {
    confirmationExecutable: configuration.confirmationExecutable,
    githubExecutable: configuration.githubExecutable,
    platform
  };
}
async function validatePrivateDirectory(directory) {
  const state = await lstat2(directory);
  const wrongOwner = typeof process.getuid === "function" && state.uid !== process.getuid();
  if (!state.isDirectory() || state.isSymbolicLink() || wrongOwner || (state.mode & 63) !== 0) {
    throw new Error("Review publication worker configuration directory is unsafe");
  }
}
async function readPrivateConfiguration(configurationPath) {
  const handle = await open2(configurationPath, constants3.O_RDONLY | constants3.O_NOFOLLOW);
  try {
    const state = await handle.stat();
    const wrongOwner = typeof process.getuid === "function" && state.uid !== process.getuid();
    if (!state.isFile() || wrongOwner || (state.mode & 63) !== 0 || state.size > MAX_CONFIGURATION_BYTES) {
      throw new Error("Review publication worker configuration is unsafe");
    }
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}
function validateConfiguration(configuration) {
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration) || JSON.stringify(Object.keys(configuration).sort()) !== JSON.stringify(CONFIGURATION_KEYS) || configuration.version !== CONFIGURATION_VERSION || configuration.managedBy !== MANAGED_BY || !absoluteSafePath(configuration.confirmationExecutable) || !absoluteSafePath(configuration.githubExecutable)) {
    throw new Error("Review publication worker configuration is invalid");
  }
}
function absoluteSafePath(candidate) {
  return typeof candidate === "string" && path4.isAbsolute(candidate) && !/[\u0000-\u001f\u007f]/.test(candidate);
}
function supportedPlatform(runtimePlatform) {
  if (runtimePlatform === "darwin")
    return "macos";
  if (runtimePlatform === "linux")
    return "linux";
  throw new Error(`Review publication is unsupported on ${runtimePlatform}`);
}

// skills/review-change/runtime/review-publication-worker.mjs
async function runReviewPublicationRequest({
  input = process.stdin,
  output = process.stdout,
  home,
  loadConfiguration = loadReviewPublicationWorkerConfiguration,
  loadKey = loadPublicationKey,
  providerFactory = createGitHubProvider,
  serverFactory = createReviewPublicationServer
} = {}) {
  await handleInetdRequest({
    input,
    output,
    dispatch: async (request, context) => {
      const worker = await initializeWorker({
        home,
        loadConfiguration,
        loadKey,
        providerFactory
      });
      const server = await initializeStage(() => serverFactory({
        key: worker.key,
        ...worker.provider,
        publishReview: worker.provider.publishReview,
        confirmPublication: worker.confirmPublication,
        requestContext: context,
        withPublicationLock: (claims, task, lockContext) => withPublisherLock(claims, task, {
          signal: lockContext.signal,
          onCleanupFailure: lockContext.markCleanupTrouble
        }),
        expectedHost: "127.0.0.1:4392"
      }), "publisher_initialization_failed");
      try {
        return await relayInetdRequest(server.url, request, context.signal);
      } finally {
        await server.close();
      }
    }
  });
}
async function initializeWorker({ home, loadConfiguration, loadKey, providerFactory }) {
  const configuration = await initializeStage(() => loadConfiguration(home === undefined ? {} : { home }), "publisher_configuration_invalid");
  const key = await initializeStage(() => loadKey(home === undefined ? {} : { home }), "publisher_signing_key_unavailable");
  const githubExecutable = await initializeStage(() => validateGitHubCliPath(configuration.githubExecutable), "provider_unavailable");
  const confirmationExecutable = await initializeStage(() => validateTrustedExecutablePath(configuration.confirmationExecutable), "os_confirmation_unavailable");
  const provider = await initializeStage(() => providerFactory({ ghPath: githubExecutable }), "publisher_initialization_failed");
  const confirmPublication2 = await initializeStage(() => createOperatingSystemConfirmation({
    promptRunner: createOperatingSystemPromptRunner({
      platform: configuration.platform,
      executable: confirmationExecutable
    })
  }), "publisher_initialization_failed");
  return { confirmPublication: confirmPublication2, key, provider };
}
async function initializeStage(operation, code) {
  try {
    return await operation();
  } catch {
    throw Object.assign(new Error(code), {
      code,
      status: 503,
      publicationResponseError: true
    });
  }
}

// skills/review-change/bin/review-publication.mjs
var MAX_CLAIMS_BYTES = 1024 * 1024;
var FRAGMENT_SUFFIX = ".review-fragment";
var arguments_ = process.argv.slice(2);
if (arguments_[0] === "--inetd" && arguments_.length === 1) {
  await runProductionRequest().catch((error) => {
    process.stderr.write(`${error?.message ?? "Review publication worker failed."}
`);
    process.exitCode = 1;
  });
} else if (arguments_[0] === "--sign" && arguments_.length === 3)
  await signAndRender(arguments_[1], arguments_[2]);
else if (arguments_[0] === "--validate-github-executable" && arguments_.length === 2) {
  process.stdout.write(`${validateGitHubCliPath(arguments_[1])}
`);
} else {
  process.stderr.write(`Usage: review-publication --inetd | --sign <claims-file> <form.review-fragment>
`);
  process.exitCode = 2;
}
async function signAndRender(claimsFile, fragmentFile) {
  const root = await realpath(process.env.REVIEW_CHANGE_REPORT_ROOT ?? process.env.TMPDIR ?? "/tmp");
  const resolvedClaims = await validateInputFile(claimsFile, root);
  const resolvedFragment = await validateOutputPath(fragmentFile, root, FRAGMENT_SUFFIX, "Publication form");
  let source;
  try {
    source = await readFile(resolvedClaims, "utf8");
  } finally {
    await rm(claimsFile, { force: true });
  }
  const submitted = JSON.parse(source);
  const { frozenScope, ...claims } = submitted;
  const rendered = await renderPublicationClaims(claims, { frozenScope });
  const fragment = renderPublicationFragment({
    publicationToken: rendered.publicationToken,
    findings: claims.findings,
    review: rendered.review
  });
  const handle = await open3(resolvedFragment, "wx", 384);
  try {
    await handle.writeFile(fragment, "utf8");
  } finally {
    await handle.close();
  }
  process.stdout.write(`${fragmentFile}
`);
}
async function validateInputFile(candidate, root) {
  const resolved = await realpath(candidate);
  if (path5.dirname(resolved) !== root)
    throw new Error("Publication claims must be in the report root");
  const state = await lstat3(candidate);
  if (!state.isFile() || state.isSymbolicLink())
    throw new Error("Publication claims must be a regular file");
  if (state.size > MAX_CLAIMS_BYTES)
    throw new Error("Publication claims exceed the size limit");
  return resolved;
}
async function validateOutputPath(candidate, root, suffix, label) {
  const parent = await realpath(path5.dirname(path5.resolve(candidate)));
  if (parent !== root)
    throw new Error(`${label} must be in the report root`);
  if (!path5.basename(candidate).endsWith(suffix))
    throw new Error(`${label} must use the ${suffix} suffix`);
  return path5.join(root, path5.basename(candidate));
}
async function runProductionRequest() {
  validateInheritedPublicationSocket();
  await runReviewPublicationRequest();
}
