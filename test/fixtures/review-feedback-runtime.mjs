import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { feedbackModel } from "./review-feedback-model.mjs";
const [sdkFile, aiFile, cwd, extension, cli, shellOutcome] = process.argv.slice(2);
const sdk = await import(sdkFile);
const file = join(cwd, "artifact.html");
writeFileSync(file, "<h1>Review feedback fixture</h1>");
const quote = text => `'${text.replaceAll("'", "'\\''")}'`;
const command = args => JSON.parse(execFileSync(cli, args, { cwd, encoding: "utf8", timeout: 10_000 }));
const status = () => command(["poll", file, "--timeout", "0"]);
const priorLauncher = process.env.AI_REVIEW_AGENT_LAUNCHED;
const busy = Promise.withResolvers();
let requests = 0;
const { modelRuntime, model } = await feedbackModel(sdk, aiFile, (request, count) => {
  requests = count;
  if (count === 1) return { tool: { name: "bash", arguments: { command: `${quote(cli)} open ${quote(file)} --no-browser; printf '%s\\n' 'DONE Open browser' 'TOTAL Review complete' >&2; ${shellOutcome === "failed" ? "false" : "true"}` } } };
  if (count === 2) return { text: "Review is ready; the agent is free for other prompts." };
  if (count === 3) {
    assert.equal(status().processing.state, "working");
    return { text: "Explained the idle feedback." };
  }
  if (count === 4) return { wait: busy.promise, text: "OTHER_TASK_FINISHED" };
  if (count === 5) {
    assert.equal(status().processing.state, "working");
    assert.ok(JSON.stringify(request.messages).includes("OTHER_TASK_FINISHED"));
    return { text: "Explained the queued feedback." };
  }
  throw Error("Unexpected provider request");
});
const settingsManager = sdk.SettingsManager.inMemory({ cacheWarming: "off", retry: { enabled: false } });
settingsManager.setProjectTrusted(true);
const services = await sdk.createAgentSessionServices({ cwd, agentDir: process.env.PI_CODING_AGENT_DIR,
  settingsManager, modelRuntime, resourceLoaderOptions: { additionalExtensionPaths: [extension] } });
assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
const runtime = await sdk.createAgentSessionRuntime(async ({ sessionManager, sessionStartEvent }) => ({
  ...await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model, thinkingLevel: "off" }),
  services, diagnostics: services.diagnostics,
}), { cwd, agentDir: process.env.PI_CODING_AGENT_DIR, sessionManager: sdk.SessionManager.create(cwd) });
const session = runtime.session;
const errors = [];
async function until(condition) {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) throw Error(`Feedback adapter timed out: requests=${requests}; errors=${JSON.stringify(errors)}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
async function submit(id, message) {
  const hash = createHash("sha256").update(file).digest("hex");
  const descriptor = JSON.parse(readFileSync(join(process.env.AR_ROOT, hash, "server.json"), "utf8"));
  const origin = `http://127.0.0.1:${descriptor.port}`;
  const response = await fetch(`${origin}/submit`, { method: "POST", headers: {
    authorization: `Bearer ${descriptor.capability}`, origin, "content-type": "application/json",
  }, body: JSON.stringify({ id, action: "feedback", revision: status().current_revision, message, annotations: [] }) });
  assert.equal(response.status, 200);
}

try {
  const obsolete = join(cwd, "a-obsolete.html");
  writeFileSync(obsolete, "<h1>Obsolete review</h1>");
  command(["open", obsolete, "--no-browser"]);
  command(["attach", obsolete, "--harness", "pi", "--conversation", session.sessionFile, "--workspace", cwd]);
  command(["stop", obsolete]);
  await session.bindExtensions({ mode: "rpc", onError: error => errors.push(error.error) });
  assert.equal(process.env.AI_REVIEW_AGENT_LAUNCHED, "pi", "Native shell commands need the agent-launch marker");
  await session.prompt("Open the synthetic artifact review.");
  assert.equal(requests, 2);
  assert.equal(session.messages.find(message => message.role === "toolResult" && message.toolName === "bash")?.isError,
    shellOutcome === "failed", "The receipt must survive a later command's failure in the same shell call");
  const attached = command(["attached", "--harness", "pi", "--conversation", session.sessionFile, "--workspace", cwd]);
  assert.deepEqual(attached.artifacts, [obsolete, file], "Opening through a native tool result must attach the originating conversation");
  await submit("native-idle-feedback-0001", "Explain the idle feedback.");
  await until(() => status().processing.state === "answered");
  await session.waitForIdle();
  assert.equal(requests, 3);
  const unrelated = session.prompt("Do unrelated work first.");
  await until(() => requests === 4);
  await submit("native-busy-feedback-0002", "Explain this after the unrelated work.");
  await new Promise(resolve => setTimeout(resolve, 650));
  assert.equal(status().processing.state, "queued");
  assert.equal(requests, 4);
  busy.resolve();
  await unrelated;
  await until(() => requests === 5 && status().processing.state === "answered");
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.equal(status().events.filter(event => event.action === "reply").length, 2);
  const obsoleteKey = createHash("sha256").update(obsolete).digest("hex");
  assert.equal(existsSync(join(process.env.AR_ROOT, obsoleteKey, "server.json")), false, "Never reopen the obsolete server");
  console.log(JSON.stringify({ attached: true, idleAnswered: true, busyQueued: true, replies: 2 }));
} finally {
  busy.resolve();
  await runtime.dispose();
  assert.equal(process.env.AI_REVIEW_AGENT_LAUNCHED, priorLauncher, "Shutdown must restore the prior process environment");
  try { command(["stop", file]); } catch {}
}
