import { type Server } from "bun";

const MAX_REQUEST_BYTES = 2_000_000;

type Block = { type: string; id?: string; name?: string; input?: object; text?: string; is_error?: boolean };
type Event = { type: string; [key: string]: unknown };
type Message = { content?: Block[] | string };
export type ApiRequest = { model?: string; stream?: boolean; messages?: Message[] };
export type FixtureCall = { name: string; input: Record<string, string> };

export function toolResults(request: ApiRequest): Block[] {
  return (request.messages ?? []).flatMap((message) => Array.isArray(message.content) ? message.content : [])
    .filter((block) => block.type === "tool_result");
}

function events(blocks: Block[], stop: string, model: string): string {
  const message = { id: "msg_fixture", type: "message", role: "assistant", model,
    content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 20, output_tokens: 1 } };
  const stream: Event[] = [{ type: "message_start", message }];
  for (const [index, block] of blocks.entries()) {
    const start = block.type === "tool_use" ? { ...block, input: {} } : { ...block, text: "" };
    const delta = block.type === "tool_use"
      ? { type: "input_json_delta", partial_json: JSON.stringify(block.input) }
      : { type: "text_delta", text: block.text };
    stream.push({ type: "content_block_start", index, content_block: start });
    stream.push({ type: "content_block_delta", index, delta });
    stream.push({ type: "content_block_stop", index });
  }
  stream.push({ type: "message_delta", delta: { stop_reason: stop, stop_sequence: null },
    usage: { output_tokens: 10 } });
  stream.push({ type: "message_stop" });
  return stream.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

export function startFakeClaudeApi(calls: FixtureCall[], finalText = "FIXTURE_COMPLETE"): { server: Server<undefined>; requests: ApiRequest[] } {
  const requests: ApiRequest[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(input) {
    if (input.method !== "POST") return new Response(null, { status: 405 });
    const size = Number(input.headers.get("content-length") ?? 0);
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_REQUEST_BYTES) {
      return new Response(null, { status: 413 });
    }
    const pathname = new URL(input.url).pathname;
    if (pathname === "/v1/messages/count_tokens") {
      return Response.json({ input_tokens: 20 });
    }
    if (!pathname.startsWith("/v1/messages") || requests.length > calls.length + 1) {
      return new Response(null, { status: 404 });
    }
    let payload: unknown;
    try { payload = await input.json(); }
    catch { return new Response(null, { status: 400 }); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return new Response(null, { status: 400 });
    }
    const request = payload as ApiRequest;
    if (!Array.isArray(request.messages) ||
        request.messages.some((message) => !message || !(Array.isArray(message.content) || typeof message.content === "string")) ||
        (request.model !== undefined && typeof request.model !== "string")) {
      return new Response(null, { status: 400 });
    }
    requests.push(request);
    const completed = toolResults(request).length;
    const blocks: Block[] = completed < calls.length
      ? [{ type: "tool_use", id: `call_${completed}`, ...calls[completed] }]
      : [{ type: "text", text: finalText }];
    const stop = completed < calls.length ? "tool_use" : "end_turn";
    const model = request.model ?? "claude-sonnet-4-6";
    if (request.stream) {
      return new Response(events(blocks, stop, model), { headers: { "Content-Type": "text/event-stream" } });
    }
    return Response.json({ id: "msg_fixture", type: "message", role: "assistant", model,
      content: blocks, stop_reason: stop, stop_sequence: null,
      usage: { input_tokens: 20, output_tokens: 10 } });
  } });
  return { server, requests };
}
