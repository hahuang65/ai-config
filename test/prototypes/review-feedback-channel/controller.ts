// PROTOTYPE — NOT PRODUCTION. Local synthetic provider and observable transport checks only.
import { randomBytes } from "node:crypto";
import { startFakeClaudeApi, type ApiMetadata, type ApiRequest } from "../../fixtures/claude-api";

export const MARKERS = ["PROTOTYPE_IDLE_PUSH", "PROTOTYPE_BUSY_START", "PROTOTYPE_BUSY_PUSH_A", "PROTOTYPE_BUSY_PUSH_B", "PROTOTYPE_LATE_IDLE_PUSH"];
const FINAL_TEXT = "PROTOTYPE_RESPONSE — NOT PRODUCTION: synthetic response completed.";
type Outcome = { passed: boolean; detail: string };

export class ChannelPrototype {
  readonly token = randomBytes(32).toString("hex");
  readonly completed = Promise.withResolvers<Outcome>();
  readonly server;
  readonly api;
  readonly events: { cursor: number; content: string }[] = [];
  readonly written = new Set<number>();
  readonly scheduled = new Set<number>();
  readonly timers = new Set<ReturnType<typeof setTimeout>>();
  changed = Promise.withResolvers<void>();
  connected = false;
  released = false;
  finished = false;
  observed = 0;
  mainRequests = 0;
  auxiliaryRequests = 0;
  readonly requestFacts: { request: number; kind: ApiMetadata["requestClass"]; stream: boolean; markers: string[] }[] = [];

  constructor(readonly report: (message: string) => void = console.log) {
    this.server = Bun.serve({ hostname: "127.0.0.1", port: 0, maxRequestBodySize: 8192,
      fetch: request => this.route(request).catch(() => new Response("Prototype request failed", { status: 400 })) });
    this.api = startFakeClaudeApi([], FINAL_TEXT, { additionalTurns: 12,
      onRequest: (request, count, metadata) => this.observeRequest(request, count, metadata).catch(error => {
        this.finish(false, error instanceof Error ? error.message : "Prototype request sequence failed");
        return "PROTOTYPE_FAILED — native delivery has not been confirmed.";
      }) });
  }

  get url() { return `http://127.0.0.1:${this.server.port}`; }
  log(message: string) { this.report(`PROTOTYPE — NOT PRODUCTION: ${message}`); }

  publish(content: string) {
    if (!MARKERS.includes(content) || this.events.length >= MARKERS.length) throw Error("Unexpected prototype event");
    this.events.push({ cursor: this.events.length + 1, content });
    this.changed.resolve();
    this.changed = Promise.withResolvers<void>();
  }

  async route(request: Request): Promise<Response> {
    if (request.headers.get("authorization") !== `Bearer ${this.token}` || request.headers.has("origin") || new URL(request.url).origin !== this.url) {
      return new Response("Unauthorized prototype request", { status: 403 });
    }
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/next") {
      const cursor = Number(url.searchParams.get("cursor"));
      if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > this.events.length) return new Response(null, { status: 400 });
      if (cursor === this.events.length) await this.waitForEvents(request.signal);
      return Response.json({ events: this.events.filter(event => event.cursor > cursor) });
    }
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const body = await request.json();
    if (url.pathname === "/connected") { this.connected = true; this.log("MCP connected; channel acceptance is not yet proven"); }
    else if (url.pathname === "/written" && Number.isSafeInteger(body.cursor) && body.cursor > 0 && body.cursor <= this.events.length) {
      this.written.add(body.cursor);
    } else if (url.pathname === "/settled") this.settled();
    else return new Response(null, { status: 400 });
    return Response.json({ ok: true });
  }

  async waitForEvents(signal: AbortSignal) {
    const timer = Promise.withResolvers<void>();
    const timeout = setTimeout(() => timer.resolve(), 20_000);
    const abort = () => timer.resolve();
    signal.addEventListener("abort", abort, { once: true });
    try { await Promise.race([this.changed.promise, timer.promise]); }
    finally { clearTimeout(timeout); signal.removeEventListener("abort", abort); }
  }

  async observeRequest(request: ApiRequest, count: number, metadata: ApiMetadata) {
    const text = JSON.stringify(request.messages);
    this.requestFacts.push({ request: count, kind: metadata.requestClass, stream: request.stream === true,
      markers: MARKERS.filter(marker => text.includes(marker)) });
    if (metadata.requestClass === "auxiliary") {
      if (++this.auxiliaryRequests > 8) throw Error("Auxiliary UI request budget exceeded");
      return "PROTOTYPE_AUXILIARY";
    }
    if (metadata.requestClass !== "main") throw Error("Unexpected or missing native request-class metadata");
    await this.modelRequest(request, ++this.mainRequests);
  }

  async modelRequest(request: ApiRequest, count: number) {
    const text = JSON.stringify(request.messages);
    if (count === 1) {
      if (!text.includes("PROTOTYPE_START")) throw Error("Missing fixture start");
      this.log("Synthetic model connected; no real provider or credentials are in use");
    } else if (count === 2) {
      if (!text.includes(MARKERS[0])) throw Error("Idle push did not reach the model");
      this.log("PASS: idle channel event reached the native model request");
    } else if (count === 3) {
      if (!text.includes(MARKERS[1])) throw Error("Busy phase did not start through the channel");
      this.publish(MARKERS[2]);
      this.publish(MARKERS[3]);
      const deadline = Date.now() + 5000;
      while (!this.written.has(4)) {
        if (Date.now() > deadline) throw Error("Busy-phase notifications were not written");
        await Bun.sleep(25);
      }
      await Bun.sleep(2000);
      this.released = true;
    } else if (count === 4) {
      const answers = request.messages?.filter(message => "role" in message && message.role === "assistant"
        && JSON.stringify(message.content).includes("PROTOTYPE_RESPONSE"));
      if (!this.released || !text.includes(MARKERS[2]) || !text.includes(MARKERS[3]) || answers?.length !== 3) {
        throw Error("Busy native response was interrupted or feedback was lost");
      }
      this.log("PASS: both busy-session events followed the completed response");
    } else if (count === 5) {
      if (!text.includes(MARKERS[4])) throw Error("Later idle push did not reach the model");
      this.log("PASS: the same channel delivered another event after returning to idle");
    } else throw Error("Unexpected additional model request");
    this.observed = count;
  }

  settled() {
    if (this.scheduled.has(this.observed)) return;
    this.scheduled.add(this.observed);
    if (this.observed === 1) this.schedule(MARKERS[0], 1000);
    if (this.observed === 2) this.schedule(MARKERS[1], 1000);
    if (this.observed === 4) this.schedule(MARKERS[4], 2000);
    if (this.observed === 5) this.finish(true, "Native idle push, busy queuing, and repeated idle delivery passed");
  }

  schedule(content: string, delay: number) {
    const timer = setTimeout(() => { this.timers.delete(timer); this.publish(content); }, delay);
    this.timers.add(timer);
    const guard = setTimeout(() => this.finish(false,
      this.connected ? "Channel connected, but delivery was not confirmed; check native channel consent or policy"
        : "Native channel did not connect"), 30_000);
    this.timers.add(guard);
  }

  finish(passed: boolean, detail: string) {
    if (this.finished) return;
    this.finished = true;
    this.log(`${passed ? "PASS" : "FAIL"}: ${detail}`);
    this.completed.resolve({ passed, detail });
  }

  stop() {
    for (const timer of this.timers) clearTimeout(timer);
    this.changed.resolve();
    this.server.stop(true);
    this.api.server.stop(true);
  }
}
