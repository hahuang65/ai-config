import { EventEmitter } from "node:events";
import { unwatchFile, watchFile } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

import {
  canonicalHtmlFile,
  confinedArtifactAsset,
  contentType,
  decodeArtifactPath,
} from "./artifact-files.mjs";
import {
  assertAllowedHost,
  assertSameOrigin,
  boundedString,
  LOOPBACK_HOST,
  publicError,
  readJson,
  sendContent,
  sendHtml,
  sendJson,
  validateFeedback,
  validateLayoutWarnings,
  validateReviewPurpose,
} from "./http.mjs";
import { SessionStore, sessionKey } from "./session-store.mjs";
import { injectBridge, renderReviewShell } from "./shell.mjs";
import {
  AGENT_TOKEN_HEADER,
  agentTokenMatches,
  createAgentToken,
  REVIEW_ARTIFACT_APP,
  REVIEW_ARTIFACT_RUNTIME_VERSION,
} from "./protocol.mjs";

const ARTIFACT_WATCH_INTERVAL_MS = 100;
const RELOAD_DEBOUNCE_MS = 60;

export async function startReviewServer({ port, stateFile, agentToken = createAgentToken() }) {
  const store = new SessionStore(stateFile);
  const events = new EventEmitter();
  const watchers = new Map();
  const server = createServer((request, response) => {
    const context = { request, response, store, events, watchers, agentToken, port: server.address()?.port };
    handleRequest(context).catch((error) => {
      sendJson(response, error.statusCode ?? 500, {
        error: { code: error.code ?? "internal_error", message: error.expose ? error.message : "Internal error" },
      });
    });
  });

  await listen(server, port);
  const address = server.address();
  const baseUrl = `http://${LOOPBACK_HOST}:${address.port}`;
  const close = () => closeServer(server, watchers);
  events.once("server:shutdown", close);
  return { baseUrl, agentToken, close };
}

async function listen(server, port) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, LOOPBACK_HOST, resolve);
  });
}

function closeServer(server, watchers) {
  for (const watcher of watchers.values()) watcher.close();
  watchers.clear();
  server.close();
  server.closeAllConnections?.();
  return Promise.resolve();
}

async function handleRequest(context) {
  const { request, response, port } = context;
  assertAllowedHost(request.headers.host, port);
  const url = new URL(request.url, `http://${LOOPBACK_HOST}:${port}`);
  if (await handleSystemRoutes(context, url)) return;
  if (await handleAgentRoutes(context, url)) return;
  if (await handleBrowserApiRoutes(context, url)) return;
  if (await handlePresentationRoutes(context, url)) return;
  sendJson(response, 404, { error: { code: "not_found", message: "Route not found" } });
}

async function handleSystemRoutes(context, url) {
  const { request, response, events, store, watchers, agentToken, port } = context;
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      app: REVIEW_ARTIFACT_APP,
      version: REVIEW_ARTIFACT_RUNTIME_VERSION,
    });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/shutdown") {
    assertAgentToken(request, agentToken);
    assertOptionalOrigin(request.headers.origin, port);
    sendJson(response, 200, { status: "stopping" });
    setImmediate(() => events.emit("server:shutdown"));
    return true;
  }
  if (request.method !== "POST" || url.pathname !== "/api/sessions") return false;
  assertOptionalOrigin(request.headers.origin, port);
  const payload = await readJson(request);
  const file = await canonicalHtmlFile(payload.file);
  const purpose = validateReviewPurpose(payload.purpose);
  const key = sessionKey(file);
  const sessionUrl = `http://${LOOPBACK_HOST}:${port}/session/${key}`;
  const session = await store.upsert(file, sessionUrl, {
    purpose,
    mode: purpose === "decision" ? "explore" : "annotate",
    reopen: Boolean(payload.reopen),
  });
  if (session.reopened !== false) watchArtifact(session, watchers, events);
  sendJson(response, 201, session);
  return true;
}

async function handleAgentRoutes(context, url) {
  const { request, response, store, events, agentToken, port } = context;
  const match = url.pathname.match(/^\/api\/sessions\/([0-9a-f]{16})\/(end|agent-reply|poll)$/);
  if (!match) return false;
  assertAgentToken(request, agentToken);
  const [, key, action] = match;
  if (request.method === "GET" && action === "poll") {
    sendJson(response, 200, await takeOrWait({ request, store, events, key }));
    return true;
  }
  if (request.method !== "POST") return false;
  assertOptionalOrigin(request.headers.origin, port);
  if (action === "end") {
    await endAsAgent({ key, store, events });
    sendJson(response, 200, { status: "ended", endedBy: "agent" });
    return true;
  }
  const text = boundedString((await readJson(request)).text, 10_000).trim();
  if (!text) throw publicError(422, "invalid_reply", "Agent reply is required");
  if (!(await store.addAgentReply(key, text))) throw missingSession();
  events.emit(`browser:${key}`, { type: "agent-reply", text });
  sendJson(response, 202, { status: "sent" });
  return true;
}

async function endAsAgent({ key, store, events }) {
  if (!(await store.finish(key, { decision: "ended", endedBy: "agent" }))) throw missingSession();
  events.emit(key);
  events.emit(`browser:${key}`, { type: "ended", endedBy: "agent" });
}

async function handleBrowserApiRoutes(context, url) {
  const { request, response, store, events, port } = context;
  const match = url.pathname.match(/^\/api\/sessions\/([0-9a-f]{16})\/(feedback|layout-warnings)$/);
  if (request.method !== "POST" || !match) return false;
  const [, key, action] = match;
  assertSameOrigin(request.headers.origin, port);
  if (action === "layout-warnings") {
    const warnings = validateLayoutWarnings(await readJson(request));
    const current = await requiredSession(store, key);
    if (new Set(["approved", "ended"]).has(current.status)) {
      sendJson(response, 202, { status: "ignored", warnings: 0 });
      return true;
    }
    if (!(await store.queueLayoutWarnings(key, warnings))) throw missingSession();
    if (warnings.length > 0) events.emit(key);
    sendJson(response, 202, { status: "recorded", warnings: warnings.length });
    return true;
  }
  const session = await receiveFeedback({ key, payload: validateFeedback(await readJson(request)), store });
  events.emit(key);
  events.emit(`browser:${key}`, { type: "presence", state: "working" });
  sendJson(response, 202, { status: "queued", pendingEvents: session.events.length });
  return true;
}

async function receiveFeedback({ key, payload, store }) {
  let session = await store.find(key);
  if (!session) throw missingSession();
  if (new Set(["approved", "ended"]).has(session.status)) {
    throw publicError(409, "session_finished", "Review session has already finished");
  }
  if (payload.prompts.length > 0) session = await store.queueFeedback(key, payload);
  if (payload.action === "approve" || payload.action === "end") {
    session = await store.finish(key, {
      decision: payload.action === "approve" ? "approved" : "ended",
      endedBy: "user",
    });
  }
  return session;
}

async function handlePresentationRoutes(context, url) {
  const { request, response, store, events } = context;
  if (request.method !== "GET") return false;
  const browserFile = browserAsset(url.pathname);
  if (browserFile) {
    response.setHeader("access-control-allow-origin", "*");
    sendContent(response, 200, browserFile.type, await readFile(new URL(`./assets/${browserFile.file}`, import.meta.url)));
    return true;
  }
  const eventMatch = url.pathname.match(/^\/api\/sessions\/([0-9a-f]{16})\/events$/);
  if (eventMatch) {
    await requiredSession(store, eventMatch[1]);
    streamBrowserEvents({ request, response, events, key: eventMatch[1] });
    return true;
  }
  const sessionMatch = url.pathname.match(/^\/session\/([0-9a-f]{16})$/);
  if (sessionMatch) {
    sendHtml(response, 200, renderReviewShell(await requiredSession(store, sessionMatch[1])));
    return true;
  }
  const artifactMatch = url.pathname.match(/^\/artifact\/([0-9a-f]{16})\/(.+)$/);
  if (!artifactMatch) return false;
  await serveArtifact(response, await requiredSession(store, artifactMatch[1]), artifactMatch[2]);
  return true;
}

async function serveArtifact(response, session, encodedPath) {
  const requested = decodeArtifactPath(encodedPath);
  if (requested === "index.html") {
    sendHtml(response, 200, injectBridge(await readFile(session.file, "utf8"), session.key));
    return;
  }
  const asset = await confinedArtifactAsset(session.file, requested);
  sendContent(response, 200, contentType(asset), await readFile(asset));
}

function watchArtifact(session, watchers, events) {
  if (watchers.has(session.key)) return;
  let timer;
  const onChange = (current, previous) => {
    if (sameFileState(current, previous)) return;
    clearTimeout(timer);
    timer = setTimeout(
      () => events.emit(`browser:${session.key}`, { type: "reload" }),
      RELOAD_DEBOUNCE_MS,
    );
  };
  watchFile(session.file, { interval: ARTIFACT_WATCH_INTERVAL_MS, persistent: false }, onChange);
  watchers.set(session.key, {
    close() {
      clearTimeout(timer);
      unwatchFile(session.file, onChange);
    },
  });
}

function sameFileState(current, previous) {
  return current.mtimeMs === previous.mtimeMs
    && current.ctimeMs === previous.ctimeMs
    && current.size === previous.size
    && current.ino === previous.ino
    && current.nlink === previous.nlink;
}

function streamBrowserEvents({ request, response, events, key }) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  const initialPresence = events.agentListeningKeys?.has(key) ? "listening" : "waiting";
  response.write(`data: ${JSON.stringify({ type: "presence", state: initialPresence })}\n\n`);
  const eventName = `browser:${key}`;
  const send = (event) => response.write(`data: ${JSON.stringify(event)}\n\n`);
  const cleanup = () => events.off(eventName, send);
  events.on(eventName, send);
  request.once("close", cleanup);
}

async function requiredSession(store, key) {
  const session = await store.find(key);
  if (!session) throw missingSession();
  return session;
}

async function takeOrWait({ request, store, events, key }) {
  events.agentListeningKeys ??= new Set();
  events.agentListeningKeys.add(key);
  events.emit(`browser:${key}`, { type: "presence", state: "listening" });
  const immediate = await store.takeEvent(key);
  if (immediate.status !== "waiting") {
    events.agentListeningKeys.delete(key);
    return immediate;
  }
  return new Promise((resolve) => {
    const finish = async () => {
      cleanup();
      resolve(await store.takeEvent(key));
    };
    const cleanup = () => {
      events.agentListeningKeys.delete(key);
      events.off(key, finish);
      request.off("close", close);
    };
    const close = () => {
      cleanup();
      events.emit(`browser:${key}`, { type: "presence", state: "waiting" });
      resolve({ status: "interrupted" });
    };
    events.once(key, finish);
    request.once("close", close);
  });
}

function browserAsset(pathname) {
  return {
    "/artifact-revision.js": { file: "artifact-revision.js", type: "text/javascript; charset=utf-8" },
    "/bridge.js": { file: "bridge.js", type: "text/javascript; charset=utf-8" },
    "/change-bar.js": { file: "change-bar.js", type: "text/javascript; charset=utf-8" },
    "/change-overlay.js": { file: "change-overlay.js", type: "text/javascript; charset=utf-8" },
    "/change-presenter.js": { file: "change-presenter.js", type: "text/javascript; charset=utf-8" },
    "/change-session.js": { file: "change-session.js", type: "text/javascript; charset=utf-8" },
    "/layout-audit.js": { file: "layout-audit.js", type: "text/javascript; charset=utf-8" },
    "/message-validation.js": { file: "message-validation.js", type: "text/javascript; charset=utf-8" },
    "/revision-settling.js": { file: "revision-settling.js", type: "text/javascript; charset=utf-8" },
    "/shell.js": { file: "shell.js", type: "text/javascript; charset=utf-8" },
    "/shell.css": { file: "shell.css", type: "text/css; charset=utf-8" },
  }[pathname] ?? null;
}

function assertOptionalOrigin(origin, port) {
  if (origin) assertSameOrigin(origin, port);
}

function assertAgentToken(request, expectedToken) {
  if (!agentTokenMatches(request.headers[AGENT_TOKEN_HEADER], expectedToken)) {
    throw publicError(401, "invalid_agent_token", "Agent authentication is required");
  }
}

function missingSession() {
  return publicError(404, "session_not_found", "Review session was not found");
}
