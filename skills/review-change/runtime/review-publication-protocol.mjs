import crypto from "node:crypto";

export const PUBLICATION_TOKEN_VERSION = 1;
export const PUBLICATION_GITHUB_HOST = "github.com";
export const PUBLICATION_SIGNING_KEY_ID = "review-publication-v1";
export const COMMENT_TEMPLATE_VERSION = 1;
export const MAX_PUBLICATION_REQUEST_BODY_BYTES = 256 * 1024;

const MAX_FINDINGS = 50;
const MAX_FINDING_BODY_LENGTH = 10_000;
const ENCODED_SHA256_SIGNATURE_LENGTH = 43;
const WORST_CASE_CONFIRMATION_EXPIRY = Number.MAX_SAFE_INTEGER;

export function createFrozenPublicationScope(identity, {
  key,
  randomBytes = crypto.randomBytes,
} = {}) {
  const validated = validatePublicationIdentity(identity);
  const reportId = randomBytes(16).toString("hex");
  if (!/^[0-9a-f]{32}$/.test(reportId)) throw protocolError("invalid_publication_scope");
  return createSignedToken({
    version: PUBLICATION_TOKEN_VERSION,
    audience: "review-publication-scope",
    reportId,
    ...validated,
  }, key);
}

export function createPublicationToken(claims, { key, actor, frozenScope } = {}) {
  if (!frozenScope) throw protocolError("frozen_publication_scope_is_required");
  const validatedClaims = claimsFromFrozenScope(claims, actor, frozenScope, key);
  const payload = encode({
    version: PUBLICATION_TOKEN_VERSION,
    audience: "review-publication",
    ...validatedClaims,
  });
  validateRequestEnvelopes(payload, validatedClaims);
  return `${payload}.${signature(payload, key)}`;
}

export function verifyPublicationToken(token, { key }) {
  const decoded = verifySignedToken(token, key, "invalid_publication_token");
  if (decoded.version !== PUBLICATION_TOKEN_VERSION || decoded.audience !== "review-publication") {
    throw protocolError("unsupported_publication_protocol");
  }
  return validateClaims(decoded);
}

export function deriveReview(claims, selectedFindingIds) {
  const selectedIds = new Set(selectedFindingIds);
  if (selectedIds.size !== selectedFindingIds.length) throw protocolError("invalid_finding_selection");
  const findings = claims.findings.filter((finding) => selectedIds.has(finding.id));
  if (findings.length !== selectedIds.size) throw protocolError("invalid_finding_selection");
  const count = findings.length;
  const generalComment = count === 0
    ? "Review completed. No Findings were selected for publication."
    : `Review found ${count} ${count === 1 ? "issue" : "issues"} worth addressing:\n\n${findings.map((finding) => `- ${finding.title}`).join("\n")}`;
  return { generalComment, findings };
}

export function createConfirmationToken(payload, { key, now = Date.now() } = {}) {
  const token = createSignedToken(confirmationPayload(payload, now + 15 * 60 * 1000), key);
  validateFinalPublicationEnvelope(token);
  return token;
}

export function verifyConfirmationToken(token, { key, now = Date.now() } = {}) {
  const decoded = verifySignedToken(token, key, "invalid_confirmation_token");
  if (decoded.version !== PUBLICATION_TOKEN_VERSION || decoded.audience !== "review-publication-confirmation") {
    throw protocolError("invalid_confirmation_token");
  }
  if (!Number.isFinite(decoded.expiresAt) || decoded.expiresAt < now) throw protocolError("confirmation_expired");
  return {
    claims: validateClaims(decoded.claims),
    selectedFindingIds: validateSelectedIds(decoded.selectedFindingIds),
  };
}

export function escapeHtml(value) {
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
    findings: claims.findings,
  });
}

function verifyFrozenPublicationScope(token, key) {
  const decoded = verifySignedToken(token, key, "invalid_publication_scope");
  if (decoded.version !== PUBLICATION_TOKEN_VERSION || decoded.audience !== "review-publication-scope") {
    throw protocolError("invalid_publication_scope");
  }
  if (!/^[0-9a-f]{32}$/.test(decoded.reportId ?? "")) throw protocolError("invalid_publication_scope");
  return { reportId: decoded.reportId, ...validatePublicationIdentity(decoded) };
}

function validateClaims(input) {
  if (!safeText(input?.reportId, 128) || !Array.isArray(input?.findings) || input.findings.length > MAX_FINDINGS) {
    throw protocolError("invalid_publication_claims");
  }
  if (!safeIdentity(input.actor)) throw protocolError("invalid_publication_claims");
  const identity = validatePublicationIdentity(input);
  const findings = normalizePublicationFindings(input.findings);
  return {
    reportId: input.reportId,
    ...identity,
    actor: { id: input.actor.id, login: input.actor.login },
    findings,
  };
}

function validatePublicationIdentity(input) {
  if (input?.host !== PUBLICATION_GITHUB_HOST
    || input?.signingKeyId !== PUBLICATION_SIGNING_KEY_ID
    || input?.commentTemplateVersion !== COMMENT_TEMPLATE_VERSION
    || !safeRepository(input?.repository)
    || !safePullRequest(input?.pullRequest, input?.repository)
    || !oid(input?.scope?.baseOid)
    || !oid(input?.scope?.headOid)) {
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
      url: input.pullRequest.url,
    },
    scope: { baseOid: input.scope.baseOid, headOid: input.scope.headOid },
  };
}

function validateSelectedIds(value) {
  if (!Array.isArray(value) || value.some((id) => !safeText(id, 64))) throw protocolError("invalid_confirmation_token");
  return value;
}

function validateRequestEnvelopes(payload, claims) {
  const token = `${payload}.${"x".repeat(ENCODED_SHA256_SIGNATURE_LENGTH)}`;
  const confirmationForm = new URLSearchParams({ publication_token: token });
  const selectedFindingIds = claims.findings.map((finding) => finding.id);
  for (const id of selectedFindingIds) confirmationForm.append("selected_finding_id", id);
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
    ...payload,
  };
}

function placeholderSignedToken(value) {
  return `${encode(value)}.${"x".repeat(ENCODED_SHA256_SIGNATURE_LENGTH)}`;
}

function verifySignedToken(token, key, errorCode) {
  const [payload, suppliedSignature, extra] = String(token ?? "").split(".");
  if (!payload || !suppliedSignature || extra) throw protocolError(errorCode);
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

export function normalizePublicationFindings(findings) {
  if (!Array.isArray(findings) || findings.length > MAX_FINDINGS) throw protocolError("invalid_publication_claims");
  const normalized = findings.map(validateFinding);
  if (new Set(normalized.map((finding) => finding.id)).size !== normalized.length) {
    throw protocolError("invalid_publication_claims");
  }
  return normalized;
}

function validateFinding(finding) {
  if (!safeText(finding?.id, 64) || !safeText(finding?.title, 500)) throw protocolError("invalid_publication_claims");
  const body = normalizeFindingBody(finding?.body);
  if (!safeText(finding.path, 1024) || finding.path.startsWith("/") || finding.path.split("/").includes("..")) throw protocolError("invalid_publication_claims");
  if (!Number.isInteger(finding.line) || finding.line < 1 || !["LEFT", "RIGHT"].includes(finding.side)) throw protocolError("invalid_publication_claims");
  return { id: finding.id, title: finding.title, body, path: finding.path, line: finding.line, side: finding.side };
}

function safeIdentity(value) { return safeText(value?.id, 128) && safeText(value?.login, 128); }
function safeRepository(value) {
  return safeText(value?.id, 128) && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value?.nameWithOwner ?? "");
}
function safePullRequest(value, repository) {
  return safeText(value?.id, 128)
    && Number.isInteger(value?.number)
    && value.number > 0
    && value.url === `https://${PUBLICATION_GITHUB_HOST}/${repository.nameWithOwner}/pull/${value.number}`;
}
function normalizeFindingBody(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_FINDING_BODY_LENGTH) {
    throw protocolError("invalid_publication_claims");
  }
  const normalized = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (!normalized || normalized.length > MAX_FINDING_BODY_LENGTH
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(normalized)) {
    throw protocolError("invalid_publication_claims");
  }
  return normalized;
}
function safeText(value, maximum) { return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f-\u009f]/u.test(value); }
function oid(value) { return typeof value === "string" && /^[0-9a-f]{40,64}$/.test(value); }
function encode(value) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
function createSignedToken(value, key) {
  const payload = encode(value);
  return `${payload}.${signature(payload, key)}`;
}
function signature(payload, key) { return crypto.createHmac("sha256", key).update(payload).digest("base64url"); }
function canonicalIdentity(identity) { return JSON.stringify(identity); }
function protocolError(code) {
  const status = code.includes("token") || code === "confirmation_expired" || code === "invalid_publication_scope"
    ? 401
    : code === "unsupported_publication_protocol" ? 400 : 422;
  return Object.assign(new Error(code.replaceAll("_", " ")), { code, status });
}
