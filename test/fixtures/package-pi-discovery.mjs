import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { projectPiPeer } from "../../tools/project-pi.mjs";

const [sdkFile, agentDir, cwd] = process.argv.slice(2);
if (![sdkFile, agentDir, cwd].every((value) => value && path.isAbsolute(value))) {
  throw new Error("Expected absolute disposable resource paths");
}

const sdk = await import(sdkFile);
const ai = await import(path.join(projectPiPeer(path.dirname(path.dirname(sdkFile)), "@earendil-works/pi-ai"), "dist/index.js"));
const settingsManager = sdk.SettingsManager.inMemory({ retry: { enabled: false }, cacheWarming: "off" });
settingsManager.setProjectTrusted(true); // Simulate a user-approved project, not an automatic trust grant.
const loader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager });
await loader.reload();
const loaded = loader.getExtensions();
const skillCatalog = loader.getSkills();
const promptCatalog = loader.getPrompts();
const themeCatalog = loader.getThemes();
const home = path.resolve(agentDir, "../..");
const privatePath = path.join(home, ".aws/credentials");
const marker = "DISPOSABLE_PRIVATE_MARKER";
mkdirSync(path.dirname(privatePath), { recursive: true });
writeFileSync(privatePath, marker);
const model = { id: "fixture", name: "Offline fixture", provider: "native-guard-fixture",
  api: "native-guard-fixture", baseUrl: "http://unused.invalid", reasoning: false,
  input: ["text"], contextWindow: 128_000, maxTokens: 1024,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
let requests = 0;
function localStream() {
  requests += 1;
  if (requests > 2) throw new Error("Unexpected synthetic provider request");
  const events = ai.createAssistantMessageEventStream();
  const message = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "pending", timestamp: Date.now() };
  events.push({ type: "start", partial: structuredClone(message) });
  const tool = requests === 1;
  const block = tool
    ? { type: "toolCall", id: "native-call", name: "read", arguments: { path: privatePath } }
    : { type: "text", text: "Finished local check." };
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
  return events;
}
const forbidden = async () => { throw new Error("Credential mutation is forbidden"); };
const credentials = { read: async (id) => {
  if (id !== model.provider) throw new Error("Real providers are disabled");
  return undefined;
}, list: async () => [], modify: forbidden, delete: forbidden };
const modelRuntime = await sdk.ModelRuntime.create({ credentials, modelsPath: null,
  allowModelNetwork: false, refreshOnCreate: false });
modelRuntime.registerNativeProvider({ id: model.provider, name: "Offline fixture", getModels: () => [model],
  auth: { apiKey: { name: "No credentials", resolve: async () => ({ auth: {} }) } },
  stream: localStream, streamSimple: localStream });
await modelRuntime.refresh({ providers: [model.provider], allowNetwork: false });
const { session } = await sdk.createAgentSession({ cwd, agentDir, resourceLoader: loader,
  modelRuntime, model, thinkingLevel: "off", tools: ["read"],
  sessionManager: sdk.SessionManager.inMemory(),
  settingsManager });
try {
  await session.bindExtensions({ mode: "text" });
  await session.prompt("Make the local fixture read call.");
  const toolResult = session.messages.find((message) => message.role === "toolResult");
  console.log(JSON.stringify({
    paths: loaded.extensions.map((extension) => extension.path),
    errorCount: loaded.errors.length,
    skills: skillCatalog.skills.map((skill) => skill.name),
    skillErrors: skillCatalog.diagnostics.length,
    prompts: promptCatalog.prompts.map((prompt) => prompt.name),
    promptErrors: promptCatalog.diagnostics.length,
    themes: themeCatalog.themes.map((theme) => theme.name),
    themeErrors: themeCatalog.diagnostics.length,
    denied: toolResult?.isError === true &&
      toolResult.content.some((part) => part.type === "text" && part.text.includes("credential file read")),
    leaked: JSON.stringify(session.messages).includes(marker),
  }));
} finally {
  if (session.extensionRunner) await session.extensionRunner.emit({ type: "session_shutdown" });
  session.dispose();
}
