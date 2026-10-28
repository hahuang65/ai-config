// Synthetic native provider: no network, credentials, or model-selected actions.
import { createAssistantMessageEventStream, getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import { appendFileSync } from "node:fs";

export default function standaloneProvider(pi: any) {
  const model = { id: "fixture", name: "Standalone SDK fixture", provider: "standalone-fixture",
    api: "standalone-fixture", baseUrl: "http://unused.invalid", reasoning: false,
    input: ["text"], contextWindow: 128000, maxTokens: 256,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  let parentRequests = 0;
  function stream(_model: any, context: any) {
    const tools = getCurrentTools(context.messages).map((tool: any) => tool.name);
    const parent = tools.includes("subagent");
    appendFileSync(process.env.STANDALONE_EVIDENCE!, JSON.stringify({ tools,
      system: getCurrentSystemPrompt(context.messages) }) + "\n");
    const events = createAssistantMessageEventStream();
    const message: any = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "pending", timestamp: Date.now() };
    events.push({ type: "start", partial: structuredClone(message) });
    if (parent && ++parentRequests === 1) {
      const toolCall = { type: "toolCall", id: "standalone-specialist", name: "subagent",
        arguments: { agent: "api-designer", task: "Propose a read-only API contract." } };
      message.content.push(toolCall);
      events.push({ type: "toolcall_start", contentIndex: 0, partial: structuredClone(message) });
      events.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: structuredClone(message) });
      message.stopReason = "toolUse";
    } else {
      message.content.push({ type: "text", text: "STANDALONE_SDK_OK" });
      events.push({ type: "text_start", contentIndex: 0, partial: structuredClone(message) });
      events.push({ type: "text_delta", contentIndex: 0, delta: "STANDALONE_SDK_OK", partial: structuredClone(message) });
      events.push({ type: "text_end", contentIndex: 0, content: "STANDALONE_SDK_OK", partial: structuredClone(message) });
      message.stopReason = "stop";
    }
    events.push({ type: "done", reason: message.stopReason, message });
    events.end();
    return events;
  }
  pi.registerProvider({ id: model.provider, name: model.name, getModels: () => [model],
    auth: { apiKey: { name: "No credentials", resolve: async () => ({ auth: {} }) } }, stream, streamSimple: stream });
}
