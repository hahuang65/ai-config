import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
const [sdkFile, cwd, extension, task = "feature"] = process.argv.slice(2);
const sdk = await import(sdkFile);
const agentDir = process.env.PI_CODING_AGENT_DIR;
mkdirSync(agentDir, { recursive: true });
const credentials = { read: async () => undefined, list: async () => [],
  modify: async () => { throw Error("No credentials"); }, delete: async () => { throw Error("No credentials"); } };
const modelRuntime = await sdk.ModelRuntime.create({ credentials, modelsPath: null,
  allowModelNetwork: false, refreshOnCreate: false });
const factory = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const settingsManager = sdk.SettingsManager.inMemory({ cacheWarming: "off" });
  settingsManager.setProjectTrusted(true); // Disposable, deliberately trusted fixture only.
  const services = await sdk.createAgentSessionServices({ cwd, agentDir, settingsManager, modelRuntime,
    resourceLoaderOptions: { additionalExtensionPaths: [extension] } });
  const errors = services.resourceLoader.getExtensions().errors;
  if (errors.length) throw Error(JSON.stringify(errors));
  return { ...await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent }),
    services, diagnostics: services.diagnostics };
};
const manager = sdk.SessionManager.create(cwd);
manager.appendMessage({ role: "user", content: "CARRY_THIS_HISTORY", timestamp: Date.now() });
const original = manager.getSessionFile();
const runtime = await sdk.createAgentSessionRuntime(factory, { cwd, agentDir, sessionManager: manager });
const bind = async () => {
  await runtime.session.bindExtensions({ mode: "tui", onError: error => { console.error(error); }, commandContextActions: {
    waitForIdle: () => runtime.session.waitForIdle(),
    switchSession: (file, options) => runtime.switchSession(file, options),
  } });
};
runtime.setRebindSession(bind);
try {
  await bind();
  const prepare = runtime.session.agent.state.tools.find(t => t.name === "worktree_transition");
  if (!prepare) throw Error("The model cannot request a native task transition");
  const nameSchema = prepare.parameters.properties.task;
  const validName = name => new RegExp(nameSchema.pattern).test(name) &&
    name.length >= (nameSchema.minLength ?? 0) && name.length <= (nameSchema.maxLength ?? Infinity);
  if (!validName(task)) throw Error(`The transition tool rejects valid WT task ${task}`);
  for (const invalid of ["", "_start", "-start", "a/b", "a.b", "é", "valid\n", "valid\t", "x".repeat(65)]) {
    if (validName(invalid)) throw Error(`The transition tool accepts invalid WT task ${invalid}`);
  }
  await runtime.session.prompt(`/wt new ${task} --local`);
  const file = runtime.session.sessionFile;
  const carried = file !== original && JSON.stringify(runtime.session.messages).includes("CARRY_THIS_HISTORY");
  if (!carried) throw Error("/wt new did not carry the current conversation into a task session");
  const target = runtime.session.sessionManager.getCwd();
  if (/^locked/m.test(execFileSync("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8" }))) {
    throw Error("A Pi task transition must not lock the worktree");
  }
  writeFileSync(join(target, "AGENTS.md"), "TASK_CONTEXT_MARKER\n");
  runtime.session.sessionManager.appendMessage({ role: "user", content: "SAVED_TASK_HISTORY", timestamp: Date.now() });
  await runtime.switchSession(original);
  await runtime.session.prompt(`/wt enter ${task}`);
  const result = await runtime.session.agent.state.tools.find(t => t.name === "bash")
    .execute("fixture", { command: "pwd -P" });
  const evidence = { carried, resumed: runtime.session.sessionFile === file &&
    JSON.stringify(runtime.session.messages).includes("SAVED_TASK_HISTORY"), cwd: runtime.session.sessionManager.getCwd(),
    toolCwd: result.content.find(p => p.type === "text").text.trim(), context: runtime.session.systemPrompt };
  await runtime.switchSession(original);
  const nested = join(target, "nested");
  mkdirSync(nested);
  const manual = sdk.SessionManager.create(nested);
  manual.appendMessage({ role: "user", content: "Manual work in a task subdirectory", timestamp: Date.now() });
  await runtime.switchSession(manual.getSessionFile());
  const verdict = await runtime.session.extensionRunner.emitToolCall({ type: "tool_call", toolCallId: "manual",
    toolName: "write", input: { path: "notes.txt", content: "manual work is allowed" } });
  if (verdict?.block) throw Error("Ordinary manual sessions must not require task ownership");
  console.log(JSON.stringify(evidence));
} finally { await runtime.dispose(); }
