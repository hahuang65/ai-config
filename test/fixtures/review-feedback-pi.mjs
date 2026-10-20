import assert from "node:assert/strict";
import { transitionModel } from "./worktree-pi-model.mjs";

const [sdkFile, aiFile, cwd] = process.argv.slice(2);
const sdk = await import(sdkFile);
let api;
let context;
const requests = [];
const events = [];
let injectWhileBusy = false;
function send(content) {
  api.sendMessage({ customType: "review-feedback-fixture", content, display: true,
    details: { conversation: session.sessionFile, workspace: cwd } },
  { triggerTurn: true, deliverAs: "followUp" });
}
const { modelRuntime, model } = await transitionModel(sdk, aiFile, request => {
  requests.push(request);
  events.push("request");
  if (injectWhileBusy) {
    injectWhileBusy = false;
    assert.equal(context.isIdle(), false);
    send("FEEDBACK_DURING_UNRELATED_WORK");
  }
});
const settingsManager = sdk.SettingsManager.inMemory({ cacheWarming: "off", retry: { enabled: false } });
settingsManager.setProjectTrusted(true);
const services = await sdk.createAgentSessionServices({ cwd, agentDir: process.env.PI_CODING_AGENT_DIR,
  settingsManager, modelRuntime, resourceLoaderOptions: { extensionFactories: [extension => {
    api = extension;
    api.on("session_start", (_event, ctx) => { context = ctx; });
    api.on("message_end", event => { if (event.message.role === "assistant") events.push("answered"); });
  }] } });
assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
const { session } = await sdk.createAgentSessionFromServices({ services,
  sessionManager: sdk.SessionManager.create(cwd), model, thinkingLevel: "off" });

async function until(condition) {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) throw Error(`Native Pi feedback timed out: ${JSON.stringify(events)}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

try {
  await session.bindExtensions({ mode: "rpc" });
  assert.equal(context.isIdle(), true);
  send("FEEDBACK_AFTER_IDLE");
  await until(() => events.filter(event => event === "answered").length === 1);
  await session.waitForIdle();
  assert.equal(requests.length, 1);
  assert.ok(JSON.stringify(requests[0]).includes("FEEDBACK_AFTER_IDLE"));
  injectWhileBusy = true;
  await session.prompt("FINISH_UNRELATED_WORK_FIRST");
  await session.waitForIdle();
  assert.equal(requests.length, 3);
  assert.equal(JSON.stringify(requests[1]).includes("FEEDBACK_DURING_UNRELATED_WORK"), false);
  assert.ok(JSON.stringify(requests[2]).includes("FEEDBACK_DURING_UNRELATED_WORK"));
  assert.deepEqual(events, ["request", "answered", "request", "answered", "request", "answered"]);
  const previousAnswers = requests[2].messages.filter(message => message.role === "assistant");
  assert.equal(previousAnswers.length, 2, "Both earlier responses must finish before feedback processing");
  console.log(JSON.stringify({ idleWake: true, busyQueued: true, sequentialResponses: true }));
} finally {
  session.dispose();
  await services.dispose?.();
}
