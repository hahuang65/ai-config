// Native runtime fixture: deterministic responses and no network or real credentials.
export async function feedbackModel(sdk, aiFile, respond) {
  const ai = await import(aiFile);
  const model = { id: "fixture", name: "Offline feedback", provider: "feedback-fixture", api: "feedback-fixture",
    baseUrl: "http://unused.invalid", reasoning: false, input: ["text"], contextWindow: 128_000, maxTokens: 512,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  let count = 0;
  function stream(_model, context) {
    if (++count > 10) throw Error("Unexpected feedback response loop");
    const choice = respond(structuredClone(context), count);
    const events = ai.createAssistantMessageEventStream();
    const message = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "pending", timestamp: Date.now() };
    events.push({ type: "start", partial: structuredClone(message) });
    void (async () => {
      await choice.wait;
      const tool = choice.tool;
      const block = tool ? { type: "toolCall", id: `feedback-call-${count}`, ...tool } : { type: "text", text: choice.text };
      message.content.push(tool ? { ...block, arguments: {} } : { type: "text", text: "" });
      events.push({ type: tool ? "toolcall_start" : "text_start", contentIndex: 0, partial: structuredClone(message) });
      message.content[0] = block;
      events.push({ type: tool ? "toolcall_delta" : "text_delta", contentIndex: 0,
        delta: tool ? JSON.stringify(block.arguments) : block.text, partial: structuredClone(message) });
      events.push({ type: tool ? "toolcall_end" : "text_end", contentIndex: 0,
        ...(tool ? { toolCall: block } : { content: block.text }), partial: structuredClone(message) });
      message.stopReason = tool ? "toolUse" : "stop";
      events.push({ type: "done", reason: message.stopReason, message });
      events.end();
    })();
    return events;
  }
  const forbidden = async () => { throw Error("Credential mutation is forbidden"); };
  const credentials = { read: async () => undefined, list: async () => [], modify: forbidden, delete: forbidden };
  const modelRuntime = await sdk.ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  modelRuntime.registerNativeProvider({ id: model.provider, name: model.name, getModels: () => [model],
    auth: { apiKey: { name: "No credentials", resolve: async () => ({ auth: {} }) } }, stream, streamSimple: stream });
  await modelRuntime.refresh({ providers: [model.provider], allowNetwork: false });
  return { modelRuntime, model };
}
