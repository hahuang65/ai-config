import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
const [sdkPath, root, scenarioFile] = process.argv.slice(2);
const sdk = await import(sdkPath);
const { Check } = await import(createRequire(sdkPath).resolve("typebox/value"));
const scenario = JSON.parse(readFileSync(scenarioFile, "utf8"));
const agentDir = join(root, "home/.pi/agent");
const eventBus = sdk.createEventBus();
const statusEvents = [];
if (scenario.observer !== false) eventBus.on("herdr:blocked", data => statusEvents.push({ type: "blocked", ...data }));
const loader = new sdk.DefaultResourceLoader({ cwd: root, agentDir, eventBus, settingsManager: sdk.SettingsManager.inMemory() });
await loader.reload();
const { extensions, errors } = loader.getExtensions();
if (errors.length) throw new Error(JSON.stringify(errors));
const controller = new AbortController();
const dialogs = [];
const ui = {
  async select(title, options, opts) {
    statusEvents.push({ type: "dialog", method: "select" });
    dialogs.push({ method: "select", title, options, hasSignal: opts?.signal === controller.signal });
    if (scenario.abort === "select") controller.abort();
    if (scenario.failure === "select") throw new Error("PRIVATE_UI_FAILURE");
    return Object.hasOwn(scenario, "selection") ? scenario.selection : options[scenario.choice ?? 0];
  },
  async input(title, placeholder, opts) {
    statusEvents.push({ type: "dialog", method: "input" });
    dialogs.push({ method: "input", title, hasSignal: opts?.signal === controller.signal });
    if (scenario.abort === "input") controller.abort();
    if (scenario.failure === "input") throw new Error("PRIVATE_UI_FAILURE");
    return scenario.text;
  },
};
const ctx = { cwd: root, mode: scenario.mode ?? "tui", hasUI: scenario.hasUI ?? true, ui };
for (const extension of extensions) {
  for (const handler of extension.handlers.get("session_start") ?? []) await handler({ type: "session_start" }, ctx);
}
const tool = extensions.flatMap(e => [...e.tools.values()]).find(t => t.definition.name === "ask_user_question")?.definition;
if (scenario.abort === "before") controller.abort();
let result = null;
if (tool) {
  result = Check(tool.parameters, scenario.input)
    ? await tool.execute("fixture", scenario.input, controller.signal, undefined, ctx)
    : { validationError: true };
  if (result.structuredContent && !Check(tool.outputSchema, result.structuredContent)) throw new Error("Invalid output schema");
}
console.log(JSON.stringify({ found: !!tool, exposure: tool?.exposure, executionMode: tool?.executionMode, dialogs, statusEvents, result }));
