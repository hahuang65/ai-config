// PROTOTYPE — NOT PRODUCTION. Minimal fixture protocol, not a general MCP implementation.
import { once } from "node:events";
import { createInterface } from "node:readline";

const address = process.env.REVIEW_CHANNEL_PROTOTYPE_URL;
const token = process.env.REVIEW_CHANNEL_PROTOTYPE_TOKEN;
if (!address || !/^http:\/\/127\.0\.0\.1:\d+$/.test(address) || !token || !/^[a-f0-9]{64}$/.test(token)) {
  throw Error("PROTOTYPE — NOT PRODUCTION: missing isolated controller configuration");
}
const abort = new AbortController();
let initialized = false;

async function request(path: string, body?: object) {
  const response = await fetch(`${address}${path}`, { method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(25_000)]),
  });
  if (!response.ok) throw Error("Prototype controller refused the request");
  return response.json();
}

async function emit(message: object) {
  if (!process.stdout.write(`${JSON.stringify(message)}\n`)) await once(process.stdout, "drain");
}

async function notifications() {
  await request("/connected", {});
  let cursor = 0;
  while (!abort.signal.aborted) {
    const page = await request(`/next?cursor=${cursor}`) as { events: { cursor: number; content: string }[] };
    for (const event of page.events) {
      if (!Number.isSafeInteger(event.cursor) || event.cursor <= cursor || typeof event.content !== "string" || event.content.length > 256) {
        throw Error("Invalid prototype notification");
      }
      await emit({ jsonrpc: "2.0", method: "notifications/claude/channel",
        params: { content: event.content, meta: { prototype: "true", event_id: String(event.cursor) } } });
      cursor = event.cursor;
      await request("/written", { cursor });
    }
  }
}

async function receive(line: string) {
  if (line.length > 65_536) throw Error("Prototype MCP request is too large");
  const message = JSON.parse(line);
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") throw Error("Invalid prototype MCP request");
  if (message.method === "notifications/initialized" && !initialized) {
    initialized = true;
    void notifications().catch(() => {
      if (!abort.signal.aborted) { console.error("PROTOTYPE — NOT PRODUCTION: channel transport stopped"); process.exit(1); }
    });
  }
  if (message.id === undefined) return;
  const result = message.method === "initialize" ? {
    protocolVersion: "2025-06-18", capabilities: { experimental: { "claude/channel": {} } },
    serverInfo: { name: "review-feedback-prototype", version: "0.0.0" },
    instructions: "PROTOTYPE — NOT PRODUCTION. These are synthetic local feedback events. No source edits or publication are requested.",
  } : message.method === "ping" ? {} : message.method === "tools/list" ? { tools: [] } : undefined;
  await emit(result === undefined ? { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Prototype method not implemented" } }
    : { jsonrpc: "2.0", id: message.id, result });
}

if (process.argv.includes("--observe-stop")) {
  const input = await Bun.stdin.json();
  if (typeof input.last_assistant_message !== "string" || !input.last_assistant_message.includes("PROTOTYPE_RESPONSE")) {
    throw Error("Stop observer received a non-fixture response");
  }
  await request("/settled", {});
} else {
  try {
    for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) await receive(line);
  } finally { abort.abort(); }
}
