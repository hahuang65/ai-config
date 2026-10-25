import assert from "node:assert/strict";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { transitionModel } from "./worktree-pi-model.mjs";
const [sdkFile, cwd, extension, task = "feature", aiFile, checklistExtension] = process.argv.slice(2);
const sdk = await import(sdkFile);
const agentDir = process.env.PI_CODING_AGENT_DIR;
mkdirSync(agentDir, { recursive: true });
const turns = [];
let taskPath;
let failVerification = false;
let blockCleanup = false;
const { modelRuntime, model } = await transitionModel(sdk, aiFile, request => {
  turns.push({ cwd: runtime.session.sessionManager.getCwd(), file: runtime.session.sessionFile,
    request, taskExists: taskPath && existsSync(taskPath) });
});
function assertRequest(index, directory, notices, taskContext = false) {
  const request = turns[index]?.request;
  assert.ok(request?.messages, "Capture the actual provider request, not the selected runtime");
  const text = JSON.stringify(request.messages);
  const systems = request.messages.filter(message => message.role === "system");
  const sections = Object.assign({}, ...systems.map(message => message.sections));
  assert.equal(sections.cwd, `<cwd>\n${directory}\n</cwd>`, "Provider must receive the destination directory");
  assert.equal((sections.project_context ?? "").includes("TASK_CONTEXT_MARKER"), taskContext);
  assert.ok(systems.some(message => message.toolsAdded?.some(tool => tool.name === "bash")));
  assert.ok(text.includes("CARRY_THIS_HISTORY"));
  if (index > 0) assert.ok(text.includes("SAVED_TASK_HISTORY"));
  assert.equal(text.split("[WT continuation v1]").length - 1, notices, "One new notice beyond the destination's saved history");
}
let cancelSwitch = false;
const errors = [];
const initialChecklist = { version: 1, title: "Carry current task", items: [
  { id: "carry", text: "Carry the current checklist", status: "pending" },
] };
const taskChecklist = { ...initialChecklist, items: [{ ...initialChecklist.items[0], status: "completed" }] };
async function checkChecklist(expected) {
  if (!checklistExtension) return;
  const tool = runtime.session.agent.state.tools.find(tool => tool.name === "todo");
  assert.ok(tool, "The native destination must expose its checklist tool");
  const result = await tool.execute("verify-checklist", { action: "read" });
  assert.deepEqual(result.structuredContent.checklist, expected);
}
const factory = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const settingsManager = sdk.SettingsManager.inMemory({ cacheWarming: "off", retry: { enabled: false } });
  settingsManager.setProjectTrusted(true); // Disposable, deliberately trusted fixture only.
  const services = await sdk.createAgentSessionServices({ cwd, agentDir, settingsManager, modelRuntime,
    resourceLoaderOptions: { additionalExtensionPaths: [extension, ...(checklistExtension ? [checklistExtension] : [])], extensionFactories: [api => {
      api.on("session_before_switch", () => cancelSwitch ? { cancel: true } : undefined);
    }] } });
  const errors = services.resourceLoader.getExtensions().errors;
  if (errors.length) throw Error(JSON.stringify(errors));
  return { ...await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model, thinkingLevel: "off" }),
    services, diagnostics: services.diagnostics };
};
const manager = sdk.SessionManager.create(cwd);
manager.appendMessage({ role: "user", content: "CARRY_THIS_HISTORY", timestamp: Date.now() });
const original = manager.getSessionFile();
const runtime = await sdk.createAgentSessionRuntime(factory, { cwd, agentDir, sessionManager: manager });
const bind = async () => {
  await runtime.session.bindExtensions({ mode: "tui", onError: error => { errors.push(error.error); }, commandContextActions: {
    waitForIdle: () => runtime.session.waitForIdle(),
    switchSession: (file, options) => runtime.switchSession(file, { ...options, withSession: async fresh => {
      if (blockCleanup) writeFileSync(join(taskPath, "notes.txt"), "cleanup race fixture");
      await options?.withSession?.(failVerification ? { ...fresh, cwd: taskPath } : fresh);
    } }),
  } });
};
runtime.setRebindSession(bind);
try {
  await bind();
  if (checklistExtension) {
    const result = await runtime.session.agent.state.tools.find(tool => tool.name === "todo")
      .execute("initialize-checklist", { action: "write", title: initialChecklist.title, items: initialChecklist.items });
    assert.equal(result.structuredContent.status, "ok");
  }
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
  taskPath = target;
  if (turns.length !== 1 || turns[0].cwd !== target || turns[0].file !== file) {
    throw Error("Verified new-task entry must automatically start exactly one destination model turn");
  }
  assertRequest(0, target, 1);
  await checkChecklist(initialChecklist);
  if (checklistExtension) {
    await runtime.session.agent.state.tools.find(tool => tool.name === "todo")
      .execute("update-task-checklist", { action: "write", title: taskChecklist.title, items: taskChecklist.items });
  }
  if (/^locked/m.test(execFileSync("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8" }))) {
    throw Error("A Pi task transition must not lock the worktree");
  }
  writeFileSync(join(target, "AGENTS.md"), "TASK_CONTEXT_MARKER\n");
  runtime.session.sessionManager.appendMessage({ role: "user", content: "SAVED_TASK_HISTORY", timestamp: Date.now() });
  await runtime.switchSession(original);
  await checkChecklist(initialChecklist);
  if (turns.length !== 1) throw Error("Ordinary session restore must not replay a continuation");
  await runtime.session.prompt("/wt cancel");
  cancelSwitch = true;
  await runtime.session.prompt(`/wt enter ${task}`);
  if (turns.length !== 1 || runtime.session.sessionFile !== original) throw Error("Cancelled entry continued work");
  cancelSwitch = false;
  await runtime.session.prompt(`/wt enter ${task}`);
  if (turns.length !== 2 || turns[1].file !== file || turns[1].cwd !== target) throw Error("Saved task did not continue exactly once");
  assertRequest(1, target, 2, true);
  await checkChecklist(taskChecklist);
  const result = await runtime.session.agent.state.tools.find(t => t.name === "bash")
    .execute("fixture", { command: "pwd -P" });
  const evidence = { carried, resumed: runtime.session.sessionFile === file &&
    JSON.stringify(runtime.session.messages).includes("SAVED_TASK_HISTORY"), cwd: runtime.session.sessionManager.getCwd(),
    toolCwd: result.content.find(p => p.type === "text").text.trim(), context: runtime.session.systemPrompt };
  unlinkSync(join(target, "AGENTS.md"));
  await runtime.session.prompt("/wt leave");
  const left = runtime.session.sessionFile;
  if (runtime.session.sessionManager.getCwd() !== cwd || left === file ||
      !JSON.stringify(runtime.session.messages).includes("SAVED_TASK_HISTORY")) {
    throw Error("/wt leave did not carry the conversation back to the primary directory");
  }
  const primaryPwd = await runtime.session.agent.state.tools.find(t => t.name === "bash")
    .execute("leave-fixture", { command: "pwd -P" });
  if (primaryPwd.content.find(p => p.type === "text").text.trim() !== cwd) throw Error("Leave tools still target the task");
  if (!existsSync(target)) throw Error("Leave must not clean the task");
  if (turns.length !== 3 || turns[2].file !== left || turns[2].cwd !== cwd) throw Error("Leave did not continue at primary exactly once");
  assertRequest(2, cwd, 3);
  await checkChecklist(taskChecklist);
  await runtime.session.prompt("/wt leave");
  if (turns.length !== 3) throw Error("No-op leave must not continue again");
  await runtime.session.prompt(`/wt enter ${task}`);
  if (runtime.session.sessionFile !== file) throw Error("Leave replaced the saved task conversation");
  assertRequest(3, target, 3); // Re-entered saved branch has two previous notices, not the primary's three.
  await runtime.session.prompt("/wt leave");
  assertRequest(4, cwd, 4);
  const nested = join(target, "nested");
  mkdirSync(nested);
  const manual = sdk.SessionManager.create(nested);
  manual.appendMessage({ role: "user", content: "Manual work in a task subdirectory", timestamp: Date.now() });
  await runtime.switchSession(manual.getSessionFile());
  const verdict = await runtime.session.extensionRunner.emitToolCall({ type: "tool_call", toolCallId: "manual",
    toolName: "write", input: { path: "notes.txt", content: "manual work is allowed" } });
  if (verdict?.block) throw Error("Ordinary manual sessions must not require task ownership");
  await runtime.switchSession(file);
  writeFileSync(join(target, "notes.txt"), "keep dirty work");
  await runtime.session.prompt("/wt leave");
  if (runtime.session.sessionFile !== file || !errors.pop()?.includes("changes")) throw Error("Dirty leave was not blocked");
  unlinkSync(join(target, "notes.txt"));
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "unintegrated"], { cwd: target });
  await runtime.session.prompt(`/wt clean ${task}`);
  if (runtime.session.sessionFile !== file || !existsSync(target) || !errors.pop()?.includes("not integrated")) {
    throw Error("Unintegrated cleanup must stop before moving the session");
  }
  execFileSync("git", ["merge", "--ff-only", `tu/${task}`], { cwd });
  cancelSwitch = true;
  await runtime.session.prompt(`/wt clean ${task}`);
  if (runtime.session.sessionFile !== file || !existsSync(target) || !errors.pop()?.includes("cancelled")) {
    throw Error("Cancelled native return must retain the task and report incomplete cleanup");
  }
  cancelSwitch = false;
  if (turns.length !== 5) throw Error("A failed or cancelled transition continued work");
  failVerification = true;
  await runtime.session.prompt(`/wt clean ${task}`);
  failVerification = false;
  if (turns.length !== 5 || !existsSync(target) || !errors.pop()?.includes("did not return")) {
    throw Error("Failed destination verification must not continue or clean");
  }
  await runtime.switchSession(file);
  blockCleanup = true;
  await runtime.session.prompt(`/wt clean ${task}`);
  blockCleanup = false;
  const cleanupError = errors.pop();
  if (turns.length !== 5 || !existsSync(target) || !cleanupError?.includes("Save them before cleanup")) {
    throw Error(`Failed cleanup must not continue despite verified return to primary: ${JSON.stringify({ turns: turns.length, cleanupError })}`);
  }
  unlinkSync(join(target, "notes.txt"));
  await runtime.switchSession(file);
  await runtime.session.prompt(`/wt clean ${task}`);
  if (turns.length !== 6 || turns[5].cwd !== cwd || turns[5].taskExists !== false) {
    throw Error("Cleanup must finish before exactly one primary continuation");
  }
  assertRequest(5, cwd, 4); // Cleanup carries the task branch, not an older primary conversation.
  await checkChecklist(taskChecklist);
  if (runtime.session.sessionManager.getCwd() !== cwd || existsSync(target) ||
      !JSON.stringify(runtime.session.messages).includes("SAVED_TASK_HISTORY")) {
    throw Error("Native cleanup must carry the conversation to primary before removing the task");
  }
  if (execFileSync("git", ["branch", "--list", `tu/${task}`], { cwd, encoding: "utf8" }).trim()) {
    throw Error("Cleanup retained an integrated task branch");
  }
  if (errors.length) throw Error(`Unexpected command errors: ${JSON.stringify(errors)}`);
  console.log(JSON.stringify(evidence));
} finally { await runtime.dispose(); }
