import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { transitionModel } from "./worktree-pi-model.mjs";
const [sdkFile, aiFile, root, scenarioFile] = process.argv.slice(2);
const sdk = await import(sdkFile);
const { Check } = await import(createRequire(sdkFile).resolve("typebox/value"));
const { visibleWidth } = await import(createRequire(sdkFile).resolve("@earendil-works/pi-tui"));
const { formatToolCallWithArgs } = await import(new URL("./core/tools/render-utils.js", pathToFileURL(sdkFile)));
const scenario = JSON.parse(readFileSync(scenarioFile, "utf8"));
const agentDir = join(root, "home/.pi/agent");
const { modelRuntime, model } = await transitionModel(sdk, aiFile, () => {});
const settingsManager = sdk.SettingsManager.inMemory({ cacheWarming: "off", retry: { enabled: false },
  compaction: { enabled: false, keepRecentTokens: 1, reserveTokens: 128 } });
async function open(manager) {
  const loader = new sdk.DefaultResourceLoader({ cwd: root, agentDir, settingsManager });
  await loader.reload();
  const loaded = loader.getExtensions();
  if (loaded.errors.length) throw new Error(JSON.stringify(loaded.errors));
  const { session } = await sdk.createAgentSession({ cwd: root, agentDir, resourceLoader: loader,
    modelRuntime, model, thinkingLevel: "off", tools: ["todo"], sessionManager: manager, settingsManager });
  return { session, loader };
}
let manager = scenario.persistent ? sdk.SessionManager.create(root) : sdk.SessionManager.inMemory(root);
let { session, loader } = await open(manager);
const widgets = [], notifications = [], errors = [], deferredRenders = [], renderErrors = [];
let retainedWidget, failTheme = false;
const theme = { fg: (_color, text) => {
  if (failTheme) throw new Error("PRIVATE_DEFERRED_RENDER_FAILURE");
  return text;
}, bold: text => text };
const ui = {
  theme,
  setWidget(key, content) {
    if (scenario.failWidget) throw new Error("PRIVATE_WIDGET_ERROR");
    const component = typeof content === "function" ? content({}, theme) : null;
    retainedWidget = component;
    const rows = component ? (scenario.deferRender ? null : component.render(scenario.width ?? 60)) : content ?? null;
    widgets.push({ key, rows, widths: rows?.map(visibleWidth), factory: typeof content === "function" });
  },
  notify(text, level) {
    notifications.push({ text, level });
    if (scenario.failNotify === "always" || (scenario.failNotify === "once" && notifications.length === 1)) {
      throw new Error("PRIVATE_NOTIFY_FAILURE");
    }
  },
};
const results = [], captions = [], leaves = new Map();
let restoreAppend, restoreRead;
const bindings = { mode: scenario.mode ?? "tui", uiContext: scenario.headless ? undefined : ui,
  onError: error => errors.push(error.error) };
try {
  await session.bindExtensions(bindings);
  const definition = loader.getExtensions().extensions.flatMap(e => [...e.tools.values()])
    .find(t => t.definition.name === "todo")?.definition;
  for (const action of scenario.actions) {
    if (action.command) { await session.prompt(`/${action.command}`); continue; }
    if (action.render) {
      failTheme = action.failTheme ?? false;
      try { deferredRenders.push(retainedWidget.render(scenario.width ?? 60)); }
      catch (error) { renderErrors.push(error.message); }
      finally { failTheme = false; }
      continue;
    }
    if (action.custom) { manager.appendCustomEntry(action.custom.type, action.custom.data); continue; }
    if (action.failAppend) {
      const append = manager.appendCustomEntry;
      restoreAppend = () => { manager.appendCustomEntry = append; };
      manager.appendCustomEntry = () => { throw new Error("PRIVATE_APPEND_FAILURE"); };
      continue;
    }
    if (action.restoreAppend) { restoreAppend(); continue; }
    if (action.failRead) {
      const getBranch = manager.getBranch;
      restoreRead = () => { manager.getBranch = getBranch; };
      manager.getBranch = () => { throw new Error("PRIVATE_READ_FAILURE"); };
      continue;
    }
    if (action.restoreRead) { restoreRead(); continue; }
    if (action.reload) { widgets.length = 0; await session.reload(); continue; }
    if (action.resume) {
      await session.prompt("Persist this isolated native session.");
      const file = session.sessionFile;
      session.dispose();
      manager = sdk.SessionManager.open(file);
      ({ session, loader } = await open(manager));
      widgets.length = 0;
      await session.bindExtensions(bindings);
      continue;
    }
    if (action.checkpoint) { leaves.set(action.checkpoint, manager.getLeafId()); continue; }
    if (action.tree) { await session.navigateTree(leaves.get(action.tree), { summarize: false }); continue; }
    if (action.compact) {
      await session.prompt("Initialize the first synthetic turn.");
      await session.prompt("Initialize the retained synthetic turn.");
      await session.compact();
      continue;
    }
    const tool = session.agent.state.tools.find(t => t.name === "todo");
    if (!tool) { results.push(null); continue; }
    const input = action.call ?? action;
    if (scenario.inspectCall) {
      const component = definition.renderCall?.(input, theme, {});
      captions.push(component ? component.render(60) : [formatToolCallWithArgs("todo", input, theme, true)]);
    }
    if (!Check(definition.parameters, input)) { results.push({ validationError: true }); continue; }
    const controller = new AbortController();
    if (action.aborted) controller.abort();
    const result = await tool.execute("fixture", input, controller.signal);
    if (!Check(definition.outputSchema, result.structuredContent)) throw new Error("Invalid checklist output");
    results.push(result);
  }
  console.log(JSON.stringify({ found: !!definition, exposure: definition?.exposure,
    executionMode: definition?.executionMode, results, widgets, notifications, captions, errors, deferredRenders, renderErrors,
    compactions: manager.getBranch().filter(entry => entry.type === "compaction").length,
    customEntries: manager.getBranch().filter(entry => entry.type === "custom") }));
} finally { session.dispose(); }
