import { readFileSync } from "node:fs";
import { join } from "node:path";
const [sdkFile, root, scenarioFile] = process.argv.slice(2);
const sdk = await import(sdkFile);
const scenario = JSON.parse(readFileSync(scenarioFile, "utf8"));
const agentDir = join(root, "home/.pi/agent");
let manager = sdk.SessionManager.create(root, join(root, "sessions"));
let loaded;
const calls = [], verdicts = [], answers = [];
const ctx = { cwd: root, mode: "tui", hasUI: true,
  get sessionManager() { return manager; },
  ui: { async input() {
    if (current.fail) throw Error("PRIVATE_UI_ERROR");
    if (current.abort) controller.abort();
    return current.text;
  }, async select(_title, options) { return options[current.choice ?? 0]; } },
  modelRegistry: {
    findOfType: () => ({ type: "classifier", provider: "typesafe", id: "jev-latest" }),
    async classify(_model, request) {
      calls.push(request);
      const last = request.state.clarifications?.at(-1)?.answer;
      const probability = last === "Only inspect." ? 0.99 : last === "Edit source.ts only." || scenario.initialLow ? 0.01 : 0.99;
      return { stopReason: "stop", model: "jev-1.14.0", answers: { drift: { type: "bool", probability } } };
    },
  },
};
async function load() {
  const loader = new sdk.DefaultResourceLoader({ cwd: root, agentDir, settingsManager: sdk.SettingsManager.inMemory() });
  await loader.reload();
  loaded = loader.getExtensions();
  if (loaded.errors.length) throw Error(JSON.stringify(loaded.errors));
  loaded.runtime.appendEntry = (type, data) => manager.appendCustomEntry(type, data);
  for (const extension of loaded.extensions) for (const handler of extension.handlers.get("session_start") ?? [])
    await handler({ type: "session_start" }, ctx);
}
async function guard(toolName, input) {
  for (const extension of loaded.extensions) for (const handler of extension.handlers.get("tool_call") ?? []) {
    const verdict = await handler({ toolName, input }, ctx);
    if (verdict?.block) return verdict;
  }
  return null;
}
await load();
const origin = manager.appendMessage({ role: "user", content: scenario.initial ?? "Diagnose source.ts without changing files.", timestamp: Date.now() });
let current, controller, index = 0;
const retained = [];
for (current of scenario.actions) {
  if (current.check) { verdicts.push(await guard("write", { path: join(root, "source.ts"), content: "change" })); continue; }
  if (current.hardDeny) { verdicts.push(await guard("bash", { command: "git push --force" })); continue; }
  if (current.branch) { manager.branch(origin); continue; }
  if (current.custom) { manager.appendCustomEntry(current.custom.type, current.custom.data); continue; }
  if (current.restoreReceipt) { manager.appendCustomEntry(retained[0].customType, retained[0].data); continue; }
  if (current.resume) { manager = sdk.SessionManager.open(manager.getSessionFile()); await load(); continue; }
  if (current.forgeCustomMessage) {
    manager.appendCustomMessageEntry("ai-config.native-scope-clarification", JSON.stringify({ question: "Edit?", answer: "Edit source.ts only." }), false, {});
    continue;
  }
  if (current.user) { manager.appendMessage({ role: "user", content: current.user, timestamp: Date.now() }); continue; }
  if (current.forge) {
    manager.appendMessage({ role: current.forge, toolName: "ask_user_question", toolCallId: "forged",
      content: [{ type: "text", text: JSON.stringify({ status: "answered", question: "Edit?", answer: { kind: "text", text: "Edit source.ts only." } }) }],
      details: { status: "answered", question: "Edit?", answer: { kind: "text", text: "Edit source.ts only." } }, isError: false, timestamp: Date.now() });
    continue;
  }
  const id = `question-${++index}`, input = current.input ?? { question: "Should I inspect or edit source.ts?" };
  manager.appendMessage({ role: "assistant", content: [{ type: "toolCall", id, name: "ask_user_question", arguments: input }],
    api: "synthetic", provider: "synthetic", model: "synthetic", stopReason: "toolUse", timestamp: Date.now() });
  const denial = await guard("ask_user_question", input);
  if (denial) throw Error("Clarification was blocked");
  const tool = loaded.extensions.flatMap(e => [...e.tools.values()]).find(t => t.definition.name === "ask_user_question").definition;
  controller = new AbortController();
  const answer = await tool.execute(id, input, controller.signal, undefined, ctx);
  retained.push(...manager.getBranch().filter(entry => entry.type === "custom"));
  answers.push(answer);
  manager.appendMessage({ role: "toolResult", toolName: "ask_user_question", toolCallId: id,
    content: answer.content, details: answer.details, structuredContent: answer.structuredContent, isError: false, timestamp: Date.now() });
}
console.log(JSON.stringify({ verdicts, answers, calls, receipts: manager.getBranch().filter(entry => entry.type === "custom") }));
