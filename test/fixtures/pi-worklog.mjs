import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";

const [sdkFile, aiFile, root, scenario] = process.argv.slice(2);
const sdk = await import(sdkFile);
const ai = await import(aiFile);
const binary = join(root, "source/tools/worklog/target/release/wl");
const cwd = join(root, "project");
execFileSync("git", ["init", "-q", cwd]);
const model = { id: "fixture", name: "Worklog busy fixture", provider: "worklog-fixture", api: "worklog-fixture",
  baseUrl: "http://unused.invalid", reasoning: false, input: ["text"], contextWindow: 128_000, maxTokens: 256,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
let release, started;
const busy = new Promise(resolve => { started = resolve; });
const requests = [];
let aborted = false;
function stream(_model, context, options) {
  requests.push(structuredClone(context));
  assert.equal(requests.length, 1, "Reminder capture must not request another model response");
  const events = ai.createAssistantMessageEventStream();
  const message = { role: "assistant", content: [{ type: "text", text: "Working" }], api: model.api,
    provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: "stop",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  options?.signal?.addEventListener("abort", () => { aborted = true; });
  events.push({ type: "start", partial: structuredClone(message) });
  release = () => { events.push({ type: "done", reason: "stop", message }); events.end(); };
  started();
  return events;
}
const forbidden = async () => { throw Error("Credential mutation forbidden"); };
const modelRuntime = await sdk.ModelRuntime.create({ modelsPath: null, allowModelNetwork: false, refreshOnCreate: false,
  credentials: { read: async () => undefined, list: async () => [], modify: forbidden, delete: forbidden } });
modelRuntime.registerNativeProvider({ id: model.provider, name: model.name, getModels: () => [model],
  auth: { apiKey: { name: "No credentials", resolve: async () => ({ auth: {} }) } }, stream, streamSimple: stream });
await modelRuntime.refresh({ providers: [model.provider], allowNetwork: false });
const settingsManager = sdk.SettingsManager.inMemory({ cacheWarming: "off", retry: { enabled: false },
  compaction: { enabled: false } });
settingsManager.setProjectTrusted(true);
const loader = new sdk.DefaultResourceLoader({ cwd, agentDir: process.env.PI_CODING_AGENT_DIR, settingsManager });
await loader.reload();
assert.deepEqual(loader.getExtensions().errors, []);
assert.ok(loader.getExtensions().extensions.some(extension => extension.commands.has("worklog")),
  "The installed package must register /worklog");
const manager = sdk.SessionManager.inMemory(cwd);
const { session } = await sdk.createAgentSession({ cwd, agentDir: process.env.PI_CODING_AGENT_DIR,
  resourceLoader: loader, modelRuntime, model, settingsManager, sessionManager: manager, tools: [] });
const events = [], notices = [], errors = [];
session.subscribe(event => events.push(event.type));
try {
  await session.bindExtensions({ mode: scenario === "rpc" ? "rpc" : scenario === "headless" ? "print" : "tui",
    uiContext: scenario === "headless" ? undefined : { notify: (text, level) => {
      notices.push({ text, level });
      if (scenario === "notify-failure") throw new Error("PRIVATE_UI_FAILURE");
    } }, onError: error => errors.push(error) });
  const initial = structuredClone(manager.getBranch());
  if (scenario === "empty") {
    await session.prompt("/worklog");
    assert.deepEqual(notices, [{ text: "No incomplete Worklog tasks.", level: "info" }]);
    assert.equal(existsSync(process.env.WL_ROOT), false);
    assert.deepEqual(manager.getBranch(), initial);
    assert.equal(requests.length, 0);
    console.log(JSON.stringify({ empty: true, requests: 0 }));
  } else if (scenario === "headless") {
    await session.prompt("/worklog Not silently captured");
    assert.equal(errors.length, 1);
    assert.match(errors[0].error, /requires an interactive or RPC UI/);
    assert.equal(existsSync(process.env.WL_ROOT), false);
    assert.deepEqual(manager.getBranch(), initial);
    assert.equal(requests.length, 0);
    console.log(JSON.stringify({ headlessRejected: true, requests: 0 }));
  } else if (scenario === "failures") {
    for (const title of ["two\nlines", "x".repeat(2049), "界".repeat(683)]) await session.prompt(`/worklog ${title}`);
    renameSync(binary, `${binary}.saved`);
    try { await session.prompt("/worklog Cannot execute private source"); }
    finally { renameSync(`${binary}.saved`, binary); }
    assert.equal(notices.length, 4);
    assert.ok(notices.every(notice => notice.level === "error"));
    assert.ok(notices[3].text.includes("Inspect Worklog history before retrying"));
    assert.ok(!JSON.stringify(notices).includes(root));
    assert.equal(existsSync(process.env.WL_ROOT), false);
    assert.deepEqual(manager.getBranch(), initial);
    assert.equal(requests.length, 0);
    console.log(JSON.stringify({ rejected: notices.length, requests: 0 }));
  } else if (scenario === "list") {
    const cli = args => execFileSync(binary, args, { cwd, encoding: "utf8" });
    cli(["note", "Completed work"]);
    cli(["complete", "1"]);
    cli(["note", "Current reminder"]);
    const other = join(root, "other");
    execFileSync("git", ["init", "-q", other]);
    cli(["start", "Other active work", "--project-path", other]);
    cli(["note", "Unassigned", "--unassigned"]);
    const before = structuredClone(manager.getBranch());
    await session.prompt("/worklog");
    assert.deepEqual(manager.getBranch(), before);
    assert.equal(requests.length, 0);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].level, "info");
    assert.equal(notices[0].text,
      '#3 planned ["project"] "Current reminder"\n#4 active ["other"] "Other active work"\n#5 planned [unassigned] "Unassigned"');
    console.log(JSON.stringify({ listed: true, requests: requests.length }));
  } else {
  const running = session.prompt("Finish the authorized implementation.");
  await busy;
  assert.equal(session.isStreaming, true);
  const before = structuredClone(manager.getBranch());
  const title = "Fix shell quoting $(touch MUST_NOT_EXIST); preserve 'literal' text";
  await session.prompt(`/worklog ${title}`);
  assert.equal(session.isStreaming, true);
  assert.equal(aborted, false);
  assert.deepEqual(session.getSteeringMessages(), []);
  assert.deepEqual(session.getFollowUpMessages(), []);
  assert.deepEqual(manager.getBranch(), before, "Capture must not add conversation or custom entries");
  const history = JSON.parse(execFileSync(binary, ["history", "--all-projects", "--all", "--json"], { cwd, encoding: "utf8" }));
  assert.equal(history.total, 1);
  assert.equal(history.items[0].kind, "note");
  assert.equal(history.items[0].text, title);
  assert.equal(existsSync(join(cwd, "MUST_NOT_EXIST")), false);
  assert.equal(history.items[0].project.name, "project");
  assert.equal(notices.length, 1);
  assert.deepEqual(errors, []);
  assert.equal(notices[0].level, "info");
  assert.ok(notices[0].text.includes("#1") && notices[0].text.includes("project"));
  release();
  await running;
  await session.waitForIdle();
  const count = type => events.filter(event => event === type).length;
  console.log(JSON.stringify({ captured: true, requests: requests.length, starts: count("agent_start"),
    completions: count("agent_end"), settled: count("agent_settled") }));
  }
} finally { release?.(); session.dispose(); }
