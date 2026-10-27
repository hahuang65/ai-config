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
const routed = ["operation", "uncertain", "low-confidence", "malformed", "classifier-error", "classifier-missing", "classifier-timeout", "idle-operation"].includes(scenario);
let classificationStarted;
const classifying = new Promise(resolve => { classificationStarted = resolve; });
let aborted = false;
function stream(_model, context, options) {
  requests.push(structuredClone(context));
  assert.ok(requests.length <= (routed ? 2 : 1), "Unexpected model response");
  const events = ai.createAssistantMessageEventStream();
  const message = { role: "assistant", content: [{ type: "text", text: "Working" }], api: model.api,
    provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: "stop",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  options?.signal?.addEventListener("abort", () => { aborted = true; });
  events.push({ type: "start", partial: structuredClone(message) });
  const finish = () => { events.push({ type: "done", reason: "stop", message }); events.end(); };
  if (requests.length > 1 || scenario === "idle-operation") finish();
  else release = finish;
  started();
  return events;
}
const forbidden = async () => { throw Error("Credential mutation forbidden"); };
const modelRuntime = await sdk.ModelRuntime.create({ modelsPath: null, allowModelNetwork: false, refreshOnCreate: false,
  credentials: { read: async () => undefined, list: async () => [], modify: forbidden, delete: forbidden } });
modelRuntime.registerNativeProvider({ id: model.provider, name: model.name, getModels: () => [model],
  auth: { apiKey: { name: "No credentials", resolve: async () => ({ auth: {} }) } }, stream, streamSimple: stream });
const classifications = [];
const jev = { type: "classifier", provider: "typesafe", id: "jev-latest", name: "Synthetic Jev",
  api: "typesafe-system-one", baseUrl: "http://unused.invalid", input: ["text"], contextWindow: 8192 };
modelRuntime.registerNativeProvider({ id: "typesafe", name: "Synthetic TypeSafe", getModels: () => [],
  getAllModels: () => scenario === "classifier-missing" ? [] : [jev],
  auth: { apiKey: { name: "No credentials", resolve: async () => ({ auth: {} }) } },
  classify: async (_model, context, options) => {
    classifications.push(structuredClone(context));
    classificationStarted();
    if (["classifier-timeout", "reload"].includes(scenario)) {
      await new Promise(resolve => {
        const guard = setTimeout(() => { throw Error("Classification was not cancelled"); }, 10_000);
        options.signal.addEventListener("abort", () => { clearTimeout(guard); resolve(); }, { once: true });
      });
      // A provider finishing after cancellation cannot authorize a write.
      return { provider: jev.provider, model: jev.id, stopReason: "stop", answers: {
        intent: { type: "choice", choice: "reminder", confidence: 1, probabilities: { reminder: 1, operation: 0, uncertain: 0 } },
      } };
    }
    if (scenario === "classifier-error") throw new Error("PRIVATE_CLASSIFIER_FAILURE");
    const choice = scenario === "uncertain" ? "uncertain" : routed && !["low-confidence", "malformed"].includes(scenario) ? "operation" : "reminder";
    return { provider: jev.provider, model: jev.id, stopReason: "stop", answers: {
      intent: { type: "choice", choice, confidence: scenario === "low-confidence" ? 0.2 : 1,
        probabilities: scenario === "malformed" ? { reminder: 1 } : {
          reminder: choice === "reminder" ? 1 : 0, operation: choice === "operation" ? 1 : 0, uncertain: choice === "uncertain" ? 1 : 0 }, },
    } };
  },
});
await modelRuntime.refresh({ providers: [model.provider, "typesafe"], allowNetwork: false });
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
  } else if (scenario === "reload") {
    const pending = session.prompt("/worklog Capture only in this session");
    await classifying;
    await session.reload();
    await pending;
    assert.equal(existsSync(process.env.WL_ROOT), false);
    assert.equal(requests.length, 0);
    assert.deepEqual(notices, []);
    console.log(JSON.stringify({ cancelled: true, requests: 0 }));
  } else if (scenario === "idle-operation") {
    await session.prompt("/worklog complete 600");
    await busy;
    await session.waitForIdle();
    assert.equal(existsSync(process.env.WL_ROOT), false);
    assert.equal(classifications.length, 1);
    assert.equal(requests.length, 1);
    assert.ok(JSON.stringify(requests[0].messages).includes("complete 600"));
    console.log(JSON.stringify({ routed: true, classifications: 1, requests: 1 }));
  } else if (routed) {
    const running = session.prompt("Finish the authorized implementation.");
    await busy;
    await session.prompt("/worklog let's do 600");
    assert.equal(existsSync(process.env.WL_ROOT), false, "An existing-task request must not create a reminder");
    const expectedClassifications = scenario === "classifier-missing" ? 0 : 1;
    assert.equal(classifications.length, expectedClassifications);
    if (expectedClassifications) assert.deepEqual(classifications[0].state, { request: "let's do 600" });
    assert.ok(!JSON.stringify(notices).includes("PRIVATE_CLASSIFIER_FAILURE"));
    assert.deepEqual(session.getSteeringMessages(), []);
    assert.equal(aborted, false);
    assert.equal(requests.length, 1, "Operations wait for the current response");
    assert.equal(session.getFollowUpMessages().length, 1);
    assert.match(session.getFollowUpMessages()[0], /work-log/);
    assert.ok(session.getFollowUpMessages()[0].includes("let's do 600"));
    release();
    await running;
    await session.waitForIdle();
    assert.equal(requests.length, 2);
    assert.equal(existsSync(process.env.WL_ROOT), false);
    console.log(JSON.stringify({ routed: true, classifications: classifications.length, requests: requests.length }));
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
  assert.equal(classifications.length, 1);
  assert.deepEqual(classifications[0].state, { request: title });
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
