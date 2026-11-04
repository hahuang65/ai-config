// Exercise the actual adapter and native child SDK with a credential-free provider.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { transitionModel } from "./worktree-pi-model.mjs";
let [sdkFile, aiFile, source, cwd, mode = "normal"] = process.argv.slice(2);
if (["removed-build-host", "retained-build-host", "missing-runtime"].includes(mode)) {
  const copy = join(cwd, "configuration");
  for (const path of ["harnesses/pi", "agents", "guard/vendor", "target/pi-subagents"]) {
    cpSync(join(source, path), join(copy, path), { recursive: true });
  }
  source = copy;
  const runtime = join(source, "target/pi-subagents"), removed = join(cwd, "removed-pi/1.4.0");
  const host = JSON.parse(readFileSync(join(runtime, "host.json"), "utf8"));
  host.sdkRoot = host.packageRoot = removed;
  host.sdkVersion = "1.4.0";
  for (const name of Object.keys(host.peers)) {
    const peer = join(runtime, "node_modules", name);
    rmSync(peer);
    const oldPeer = join(removed, "node_modules", name);
    symlinkSync(oldPeer, peer, "dir");
    if (mode === "retained-build-host") {
      mkdirSync(join(oldPeer, "dist"), { recursive: true });
      writeFileSync(join(oldPeer, "package.json"), JSON.stringify({ name, version: "1.4.0",
        type: "module", exports: "./dist/index.js" }));
      writeFileSync(join(oldPeer, "dist/index.js"), "throw Error('OLD_HOST_MUST_NOT_LOAD');\n");
    }
  }
  writeFileSync(join(runtime, "host.json"), JSON.stringify(host));
  if (mode === "missing-runtime") rmSync(join(runtime, "package"), { recursive: true });
}
const adapter = join(source, "harnesses/pi/specialists.bundle.ts");
if (!existsSync(adapter)) {
  console.log(JSON.stringify({ registered: false }));
  process.exit(0);
}
const sdk = await import(sdkFile), ai = await import(aiFile);
const agentDir = process.env.PI_CODING_AGENT_DIR;
for (const path of [cwd, agentDir, join(agentDir, "extensions/subagent"), join(agentDir, "skills/specialist-test")]) {
  mkdirSync(path, { recursive: true });
}
writeFileSync(join(agentDir, "AGENTS.md"), "GLOBAL_SPECIALIST_TEST\n");
writeFileSync(join(cwd, "AGENTS.md"), "PROJECT_SPECIALIST_TEST\n");
writeFileSync(join(cwd, "README.md"), "PUBLIC_SPECIALIST_SOURCE\n");
mkdirSync(join(cwd, ".aws"), { recursive: true });
writeFileSync(join(cwd, ".aws/credentials"), "PRIVATE_CREDENTIAL_CANARY\n");
writeFileSync(join(agentDir, "skills/specialist-test/SKILL.md"),
  "---\nname: specialist-test\ndescription: SKILL_SPECIALIST_TEST\n---\nSynthetic skill.\n");
writeFileSync(join(agentDir, "extensions/subagent/config.json"), mode === "policy-invalid"
  ? "PRIVATE_POLICY_CANARY is not JSON" : readFileSync(join(source, "harnesses/pi/specialists/policy.json"), "utf8"));
const requests = [], errors = [];
const { modelRuntime, model } = await transitionModel(sdk, aiFile, request => {
  requests.push({ system: ai.getCurrentSystemPrompt(request.messages),
    tools: ai.getCurrentTools(request.messages).map(tool => tool.name), messages: request.messages });
  if (mode === "guard-probe" && requests.length <= 2) return { tool: "read",
    input: { path: requests.length === 1 ? "README.md" : ".aws/credentials" } };
});
const settingsManager = sdk.SettingsManager.inMemory({ cacheWarming: "off", retry: { enabled: false },
  compaction: { enabled: false } });
settingsManager.setProjectTrusted(true);
const services = await sdk.createAgentSessionServices({ cwd, agentDir, settingsManager, modelRuntime,
  resourceLoaderOptions: { additionalExtensionPaths: [adapter] } });
errors.push(...services.resourceLoader.getExtensions().errors);
const manager = sdk.SessionManager.inMemory(cwd);
manager.appendMessage({ role: "user", content: "Consult api-designer about this synthetic API. Do not edit.", timestamp: Date.now() });
const { session } = await sdk.createAgentSessionFromServices({ services, sessionManager: manager, model, thinkingLevel: "off" });
let collision;
if (mode === "floor-collision") {
  const { registerRequiredChildExtensions } = await import(join(source, "target/pi-subagents/package/bundle/required-child-extensions.js"));
  collision = registerRequiredChildExtensions({ sessionId: manager.getSessionId(), extensions: [] });
}
try {
  await session.bindExtensions({ mode: "print", onError: error => errors.push(error.error) });
  if (mode === "policy-changed") {
    const policy = JSON.parse(readFileSync(join(source, "harnesses/pi/specialists/policy.json"), "utf8"));
    writeFileSync(join(agentDir, "extensions/subagent/config.json"), JSON.stringify({ ...policy, timeoutMs: 120001 }));
  }
  const tool = session.agent.state.tools.find(tool => tool.name === "subagent");
  const input = { agent: mode === "forbidden-role" ? "change-reviewer" : "api-designer", task: "Propose a read-only contract." };
  if (mode === "forbidden-options") input.worktree = true;
  let result, error;
  try { result = tool && await tool.execute("specialist-test", input); }
  catch (failure) { error = failure.message; }
  console.log(JSON.stringify({ registered: !!tool, errors, requests, result, error,
    schema: tool?.parameters, executionMode: tool?.executionMode,
    tools: session.agent.state.tools.map(tool => tool.name) }));
} finally {
  if (session.extensionRunner) await session.extensionRunner.emit({ type: "session_shutdown" });
  session.dispose();
  collision?.dispose();
}
