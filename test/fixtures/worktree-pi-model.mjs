// Local synthetic provider: no network, credentials, or model-selected actions.
export async function transitionModel(sdk, aiFile, onRequest) {
  const ai = await import(aiFile);
  const model = { id: "fixture", name: "Offline transitions", provider: "transition-fixture",
    api: "transition-fixture", baseUrl: "http://unused.invalid", reasoning: false,
    input: ["text"], contextWindow: 128_000, maxTokens: 256,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  let requests = 0;
  function stream(_model, context) {
    if (++requests > 20) throw Error("Unexpected continuation loop");
    onRequest(structuredClone(context));
    const events = ai.createAssistantMessageEventStream();
    const message = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "pending", timestamp: Date.now() };
    events.push({ type: "start", partial: structuredClone(message) });
    message.content.push({ type: "text", text: "" });
    events.push({ type: "text_start", contentIndex: 0, partial: structuredClone(message) });
    const text = "Continued in the verified destination.";
    message.content[0].text = text;
    events.push({ type: "text_delta", contentIndex: 0, delta: text, partial: structuredClone(message) });
    events.push({ type: "text_end", contentIndex: 0, content: text, partial: structuredClone(message) });
    message.stopReason = "stop";
    events.push({ type: "done", reason: "stop", message });
    events.end();
    return events;
  }
  const forbidden = async () => { throw Error("Credential mutation is forbidden"); };
  const credentials = { read: async () => undefined, list: async () => [], modify: forbidden, delete: forbidden };
  const modelRuntime = await sdk.ModelRuntime.create({ credentials, modelsPath: null,
    allowModelNetwork: false, refreshOnCreate: false });
  modelRuntime.registerNativeProvider({ id: model.provider, name: model.name, getModels: () => [model],
    auth: { apiKey: { name: "No credentials", resolve: async () => ({ auth: {} }) } }, stream, streamSimple: stream });
  await modelRuntime.refresh({ providers: [model.provider], allowNetwork: false });
  return { modelRuntime, model };
}
