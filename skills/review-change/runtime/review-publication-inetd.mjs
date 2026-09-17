import http from "node:http";

import { PUBLICATION_SCRIPT_HASH, renderErrorPage } from "./review-publication-html.mjs";
import {
  REQUEST_WORK_TIMEOUT_MS,
  RESPONSE_FLUSH_TIMEOUT_MS,
} from "./review-publication-lifetime.mjs";
import { MAX_PUBLICATION_REQUEST_BODY_BYTES } from "./review-publication-protocol.mjs";

const MAX_HEADER_BYTES = 16 * 1024;
const MAX_INTERNAL_RESPONSE_BODY_BYTES = 2 * 1024 * 1024;
const HEADER_TERMINATOR_BYTES = 4;
const MAX_BUFFER_BYTES = MAX_HEADER_BYTES + HEADER_TERMINATOR_BYTES + MAX_PUBLICATION_REQUEST_BODY_BYTES;
const CONFIRMATION_PATH = "/api/v1/review-publication-confirmations";
const PUBLICATION_PATH = "/api/v1/review-publications";
const PUBLICATION_PATHS = new Set([CONFIRMATION_PATH, PUBLICATION_PATH]);
const END_TO_END_RESPONSE_HEADERS = new Set([
  "cache-control",
  "content-security-policy",
  "content-type",
  "referrer-policy",
  "x-frame-options",
]);

export async function relayInetdRequest(serverUrl, request, signal) {
  const selectedPath = exactPublicationPath(request.path);
  const port = loopbackServerPort(serverUrl);
  return new Promise((resolve, reject) => {
    let settled = false;
    let outgoing;
    const settle = (error, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", cancel);
      if (error) reject(error); else resolve(value);
    };
    const cancel = () => {
      const error = requestError(504, "request_timeout");
      settle(error);
      outgoing?.destroy(error);
    };
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) return cancel();
    outgoing = http.request({
      protocol: "http:",
      hostname: "127.0.0.1",
      port,
      path: selectedPath,
      method: request.method,
      maxHeaderSize: MAX_HEADER_BYTES,
      headers: {
        "content-type": request.headers["content-type"] ?? "",
        host: request.headers.host ?? "",
      },
      signal,
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
    body: Buffer.concat(chunks, bodyBytes).toString("utf8"),
  }));
}

function exactPublicationPath(candidate) {
  if (!PUBLICATION_PATHS.has(candidate)) throw requestError(400, "invalid_publication_endpoint");
  return candidate;
}

function loopbackServerPort(serverUrl) {
  let target;
  try {
    target = new URL(serverUrl);
  } catch {
    throw internalResponseError("invalid_internal_origin");
  }
  if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" || !target.port
    || target.username || target.password || target.pathname !== "/" || target.search || target.hash) {
    throw internalResponseError("invalid_internal_origin");
  }
  return target.port;
}

function internalResponseError(code) {
  return Object.assign(new Error(code), { code, status: 502 });
}

export async function handleInetdRequest({
  input,
  output,
  dispatch,
  requestTimeoutMs = REQUEST_WORK_TIMEOUT_MS,
  responseFlushTimeoutMs = RESPONSE_FLUSH_TIMEOUT_MS,
}) {
  const controller = new AbortController();
  const context = requestContext(controller.signal);
  const connection = observeConnection(input, output, controller);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(requestError(504, "request_timeout"));
    input.destroy?.();
  }, requestTimeoutMs);
  timer.unref?.();
  const outcome = await readAndDispatch(input, dispatch, context)
    .then((response) => ({ response }))
    .catch((error) => ({ error }));
  clearTimeout(timer);
  connection.dispose();
  if (!timedOut && !connection.disconnected() && outcome.response) {
    return writeHttpResponse(output, outcome.response, responseFlushTimeoutMs);
  }
  const typed = timedOut
    ? timeoutOutcome(context)
    : !context.dispatchStarted && outcome.error?.publicationParserError
      ? parserError(outcome.error)
      : connection.disconnected()
        ? cancellationOutcome(context)
        : responseError(outcome.error);
  await writeHttpResponse(output, {
    status: typed.status,
    headers: safeHtmlHeaders(),
    body: renderErrorPage(typed.code, { phase: context.phase }),
  }, responseFlushTimeoutMs);
}

async function readAndDispatch(input, dispatch, context) {
  const request = await readHttpRequest(input);
  exactPublicationPath(request.path);
  context.phase = request.path === PUBLICATION_PATH ? "publication" : "confirmation";
  if (context.signal.aborted) throw requestError(504, "request_timeout");
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
    markMutationStarted: () => { context.mutationMayHaveStarted = true; },
    markCleanupTrouble: () => { context.cleanupTrouble = true; },
  };
  return context;
}

function observeConnection(input, output, controller) {
  let wasDisconnected = false;
  const disconnect = () => {
    wasDisconnected = true;
    if (!controller.signal.aborted) controller.abort(requestError(504, "request_timeout"));
  };
  const observations = [[input, "close"], [input, "error"], [output, "close"], [output, "error"]];
  for (const [stream, event] of observations) stream.on?.(event, disconnect);
  return {
    disconnected: () => wasDisconnected,
    dispose: () => {
      for (const [stream, event] of observations) stream.off?.(event, disconnect);
    },
  };
}

function timeoutOutcome(context) {
  return cancellationOutcome(context);
}

function cancellationOutcome(context) {
  return context.mutationMayHaveStarted
    ? requestError(502, "publication_outcome_unknown")
    : requestError(504, "request_timeout");
}

async function readHttpRequest(input) {
  let buffer = Buffer.alloc(0);
  let expectedBytes = null;
  const iterator = input[Symbol.asyncIterator]();
  while (true) {
    const { value: rawChunk, done } = await iterator.next();
    if (done) break;
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    const bufferLimit = expectedBytes ?? MAX_BUFFER_BYTES;
    if (chunk.length > bufferLimit - buffer.length) throw requestError(413, "request_too_large");
    buffer = Buffer.concat([buffer, chunk], buffer.length + chunk.length);
    if (expectedBytes !== null) {
      if (buffer.length < expectedBytes) continue;
      if (buffer.length > expectedBytes) throw requestError(400, "invalid_http_framing");
      return parseCompleteRequest(buffer, expectedBytes);
    }
    const separator = buffer.indexOf("\r\n\r\n");
    if (separator === -1) {
      if (buffer.length >= MAX_HEADER_BYTES) throw requestError(413, "request_headers_too_large");
      continue;
    }
    const bodyStart = separator + HEADER_TERMINATOR_BYTES;
    if (bodyStart > MAX_HEADER_BYTES) throw requestError(413, "request_headers_too_large");
    const parsed = parseHeader(buffer.subarray(0, separator).toString("ascii"));
    const contentLength = parseContentLength(parsed.headers["content-length"]);
    expectedBytes = bodyStart + contentLength;
    if (buffer.length < expectedBytes) continue;
    if (buffer.length > expectedBytes) throw requestError(400, "invalid_http_framing");
    return {
      ...parsed,
      body: buffer.subarray(bodyStart, expectedBytes).toString("utf8"),
    };
  }
  throw requestError(400, "incomplete_http_request");
}

function parseCompleteRequest(buffer, expectedBytes) {
  const separator = buffer.indexOf("\r\n\r\n");
  const parsed = parseHeader(buffer.subarray(0, separator).toString("ascii"));
  return {
    ...parsed,
    body: buffer.subarray(separator + HEADER_TERMINATOR_BYTES, expectedBytes).toString("utf8"),
  };
}

function parseHeader(header) {
  const [requestLine, ...lines] = header.split("\r\n");
  const match = /^(POST) (\/[^ ]*) HTTP\/1\.[01]$/.exec(requestLine);
  if (!match) throw requestError(400, "invalid_http_request_line");
  const headers = {};
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator < 1) throw requestError(400, "invalid_http_header");
    const name = line.slice(0, separator).trim().toLowerCase();
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) throw requestError(400, "invalid_http_header");
    if (headers[name] !== undefined) throw requestError(400, "duplicate_http_header");
    headers[name] = line.slice(separator + 1).trim();
  }
  if (headers["transfer-encoding"]) throw requestError(400, "unsupported_transfer_encoding");
  return { method: match[1], path: match[2], headers };
}

function parseContentLength(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw requestError(400, "invalid_content_length");
  const contentLength = Number(value);
  if (!Number.isSafeInteger(contentLength) || contentLength > MAX_PUBLICATION_REQUEST_BODY_BYTES) {
    throw requestError(413, "request_body_too_large");
  }
  return contentLength;
}

function writeHttpResponse(output, response, timeoutMs) {
  const body = Buffer.from(response.body);
  const headers = Object.fromEntries(Object.entries(response.headers)
    .map(([name, value]) => [name.toLowerCase(), value])
    .filter(([name]) => END_TO_END_RESPONSE_HEADERS.has(name)));
  headers.connection = "close";
  headers["content-length"] = String(body.length);
  const head = [`HTTP/1.1 ${response.status} ${statusText(response.status)}`]
    .concat(Object.entries(headers).map(([name, value]) => `${name}: ${value}`))
    .concat("", "")
    .join("\r\n");
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
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
    "x-frame-options": "DENY",
  };
}

function parserError(error) {
  return error?.publicationParserError
    ? error
    : requestError(400, "invalid_http_request");
}

function responseError(error) {
  if (error?.publicationParserError || error?.publicationResponseError) return error;
  return requestError(400, "invalid_http_request");
}

function requestError(status, code) {
  return Object.assign(new Error(code), { status, code, publicationParserError: true });
}

function statusText(status) {
  return ({ 200: "OK", 201: "Created", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 409: "Conflict", 413: "Payload Too Large", 415: "Unsupported Media Type", 422: "Unprocessable Content", 429: "Too Many Requests", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout" })[status] ?? "Error";
}
