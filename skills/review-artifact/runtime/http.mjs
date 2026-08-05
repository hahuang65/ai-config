import { validatePrompt as validateReviewPrompt } from "./assets/message-validation.js";
import { REVIEW_PURPOSES } from "./protocol.mjs";

export const LOOPBACK_HOST = "127.0.0.1";

const MAX_JSON_BYTES = 256 * 1024;
const REVIEW_PURPOSE_SET = new Set(REVIEW_PURPOSES);

export function assertAllowedHost(hostHeader, port) {
  const allowed = new Set([`${LOOPBACK_HOST}:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  if (!hostHeader || !allowed.has(hostHeader.toLowerCase())) {
    throw publicError(403, "forbidden_host", "Host is not allowed");
  }
}

export function assertSameOrigin(origin, port) {
  const allowed = new Set([
    `http://${LOOPBACK_HOST}:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
  ]);
  if (!origin || !allowed.has(origin.toLowerCase())) {
    throw publicError(403, "forbidden_origin", "Origin is not allowed");
  }
}

export async function readJson(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers["content-type"] ?? "")) {
    throw publicError(415, "unsupported_media_type", "Request body must use application/json");
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_JSON_BYTES) throw publicError(413, "payload_too_large", "Request body is too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw publicError(400, "invalid_json", "Request body must be valid JSON");
  }
}

export function validateReviewPurpose(value) {
  const purpose = String(value ?? "feedback");
  if (!REVIEW_PURPOSE_SET.has(purpose)) {
    throw publicError(422, "invalid_review_purpose", "Review purpose is invalid");
  }
  return purpose;
}

export function validateFeedback(payload) {
  if (!Array.isArray(payload.prompts) || payload.prompts.length > 100) {
    throw publicError(422, "invalid_feedback", "Feedback prompts must be an array of at most 100 items");
  }
  const action = payload.action ?? "feedback";
  if (!new Set(["feedback", "approve", "end"]).has(action)) {
    throw publicError(422, "invalid_feedback", "Feedback action is invalid");
  }
  return {
    prompts: payload.prompts.map(validatePrompt),
    domSnapshot: boundedString(payload.domSnapshot, 100_000),
    action,
  };
}

function validatePrompt(prompt) {
  const validated = validateReviewPrompt(prompt);
  if (!validated) throw publicError(422, "invalid_feedback", "Prompt or annotation target is invalid");
  return validated;
}

export function validateLayoutWarnings(payload) {
  if (!Array.isArray(payload.layoutWarnings) || payload.layoutWarnings.length > 50) {
    throw publicError(422, "invalid_layout_warnings", "Layout warnings must be an array of at most 50 items");
  }
  return payload.layoutWarnings.filter((warning) => warning?.severity === "error").map(validateLayoutWarning);
}

function validateLayoutWarning(warning) {
  return {
    selector: boundedString(warning.selector, 2_000),
    kind: boundedString(warning.kind, 100),
    ...(new Set(["horizontal", "vertical"]).has(warning.axis) ? { axis: warning.axis } : {}),
    overflowPx: finiteNumber(warning.overflowPx),
    viewportWidth: finiteNumber(warning.viewportWidth),
    severity: "error",
  };
}

export function boundedString(value, maximum) {
  const text = String(value ?? "");
  if (text.length > maximum) throw publicError(422, "invalid_field", "Request field is too long");
  return text;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function publicError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code, expose: true });
}

export function sendJson(response, statusCode, body) {
  sendContent(response, statusCode, "application/json; charset=utf-8", JSON.stringify(body));
}

export function sendHtml(response, statusCode, content) {
  sendContent(response, statusCode, "text/html; charset=utf-8", content);
}

export function sendContent(response, statusCode, type, content) {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(statusCode, {
    "content-type": type,
    "content-length": Buffer.byteLength(content),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(content);
}
