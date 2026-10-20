import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { feedbackModel } from "./review-feedback-model.mjs";
const [sdkFile, aiFile, cwd, extension, cli] = process.argv.slice(2);
const sdk = await import(sdkFile);
const file = join(cwd, "artifact.html");
writeFileSync(file, "<h1>Saved feedback fixture</h1>");
const command = args => JSON.parse(execFileSync(cli, args, { cwd, encoding: "utf8", timeout: 10_000 }));
const status = () => command(["poll", file, "--timeout", "0"]);
const manager = sdk.SessionManager.create(cwd);
manager.appendMessage({ role: "user", content: "Resume the saved review conversation.", timestamp: Date.now() });
const origin = ["--harness", "pi", "--conversation", manager.getSessionFile(), "--workspace", cwd];
command(["open", file, "--no-browser"]);
command(["attach", file, ...origin]);
const descriptor = JSON.parse(readFileSync(join(process.env.AR_ROOT, createHash("sha256").update(file).digest("hex"), "server.json"), "utf8"));
const server = `http://127.0.0.1:${descriptor.port}`;
const sent = await fetch(`${server}/submit`, { method: "POST", headers: {
  authorization: `Bearer ${descriptor.capability}`, origin: server, "content-type": "application/json",
}, body: JSON.stringify({ id: "orphaned-feedback-0001", action: "feedback", revision: status().current_revision, message: "Explain the saved feedback", annotations: [] }) });
assert.equal(sent.status, 200);
const orphaned = command(["claim", file, ...origin]);
assert.equal(status().processing.state, "working");
let requests = 0;
const { modelRuntime, model } = await feedbackModel(sdk, aiFile, request => {
  requests++;
  assert.ok(JSON.stringify(request.messages).includes('\\"interrupted\\":true'));
  assert.equal(status().processing.state, "working");
  return { text: "Recovered the saved feedback without repeating any prior edits." };
});
const settingsManager = sdk.SettingsManager.inMemory({ cacheWarming: "off", retry: { enabled: false } });
settingsManager.setProjectTrusted(true);
const services = await sdk.createAgentSessionServices({ cwd, agentDir: process.env.PI_CODING_AGENT_DIR,
  settingsManager, modelRuntime, resourceLoaderOptions: { additionalExtensionPaths: [extension] } });
const runtime = await sdk.createAgentSessionRuntime(async ({ sessionManager, sessionStartEvent }) => ({
  ...await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model, thinkingLevel: "off" }),
  services, diagnostics: services.diagnostics,
}), { cwd, agentDir: process.env.PI_CODING_AGENT_DIR, sessionManager: manager });
const errors = [];
try {
  await runtime.session.bindExtensions({ mode: "rpc", onError: error => errors.push(error.error) });
  const deadline = Date.now() + 10_000;
  while (status().processing.state !== "answered") {
    if (Date.now() > deadline) throw Error(`Saved feedback did not recover: requests=${requests}, state=${status().processing.state}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(requests, 1);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  const stale = await fetch(`${server}/feedback/finish`, { method: "POST", headers: {
    authorization: `Bearer ${descriptor.capability}`, origin: server, "content-type": "application/json",
  }, body: JSON.stringify({ cursor: orphaned.cursor, attempt: orphaned.attempt, message: "Old process returned" }) });
  assert.equal(stale.status, 409);
  console.log(JSON.stringify({ recovered: true, staleRejected: true }));
} finally { await runtime.dispose(); command(["stop", file]); }
