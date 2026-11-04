// harnesses/pi/specialists.ts
import { Type } from "typebox";
import { realpathSync as realpathSync2 } from "node:fs";
import { dirname, join as join2, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// harnesses/pi/specialists/runtime.ts
import * as sdk from "@earendil-works/pi-coding-agent";
import * as core from "@earendil-works/pi-agent-core";
import * as ai from "@earendil-works/pi-ai";
import * as compat from "@earendil-works/pi-ai/compat";
import * as tui from "@earendil-works/pi-tui";
import * as typebox from "typebox";
import * as typeboxCompile from "typebox/compile";
import * as typeboxValue from "typebox/value";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
// harnesses/pi/specialists/policy.json
var policy_default = {
  toolActivation: "eager",
  toolDescriptionMode: "compact",
  pinToolDeclarations: false,
  disabledFeatures: [
    "agent-management",
    "watchdog",
    "panes",
    "missions",
    "lane-management",
    "spawn-budget-grants",
    "preflight",
    "lane-metadata",
    "gates",
    "usage-budgets",
    "tool-budgets",
    "control-overrides",
    "extension-bindings",
    "external-machines",
    "workflow-scripts"
  ],
  missions: { enabled: false, globalIndex: false },
  scheduledRuns: { enabled: false },
  enableSlashCommands: false,
  asyncByDefault: false,
  forceTopLevelAsync: false,
  autoResume: false,
  defaultSubagentContext: "fresh",
  fleetView: false,
  asyncWidget: false,
  programStatus: false,
  intercomBridge: { mode: "off", resultDelivery: false },
  maxSubagentDepth: 1,
  globalConcurrencyLimit: 2,
  maxSubagentSpawnsPerRun: 2,
  maxSubagentSpawnsPerSession: 20,
  timeoutMs: 120000,
  toolTimeoutMs: 30000,
  artifactDir: "session",
  resultScanLogging: "off"
};

// harnesses/pi/specialists/runtime.ts
var { getAgentDir, getPackageDir } = sdk;
var roles = ["api-designer", "database-reviewer", "fact-checker", "frontend-architect"];
var tools = ["read", "grep", "find", "ls"];
var runtimeName = (name) => `ai-config-${name}`;

class SpecialistRuntimeUnavailable extends Error {
}
function readBounded(path) {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > 65536)
    throw Error("Specialist support file is missing or oversized");
  return readFileSync(path, "utf8");
}
function requireOwnedPolicy() {
  let configured;
  try {
    configured = JSON.parse(readBounded(join(getAgentDir(), "extensions/subagent/config.json")));
  } catch {
    throw Error("Specialist read-only policy is missing, unreadable, or invalid; use the approved installer");
  }
  if (!isDeepStrictEqual(configured, policy_default))
    throw Error("Specialist configuration is not the owned read-only policy; use the approved installer");
}
function requireMatchingHost(root) {
  const override = process.env.PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT?.trim();
  if (!override)
    return;
  let matches = false;
  try {
    matches = realpathSync(override) === root;
  } catch {}
  if (!matches)
    throw Error("Specialist host override does not match the active Pi SDK; use a matching host and rebuild");
}
function checkRuntime(source) {
  const directory = join(source, "target/pi-subagents");
  let engine;
  try {
    engine = JSON.parse(readBounded(join(directory, "package/package.json")));
  } catch {}
  if (engine?.name !== "pi-subagents" || engine?.version !== "0.83.0") {
    throw new SpecialistRuntimeUnavailable("Run make build in the configuration source to restore the pinned engine");
  }
  let activeRoot;
  try {
    activeRoot = realpathSync(getPackageDir());
  } catch {
    throw new SpecialistRuntimeUnavailable("This Pi installation was removed; restart Pi and resume the saved conversation");
  }
  requireMatchingHost(activeRoot);
  requireOwnedPolicy();
  return directory;
}
async function loadRuntime(source) {
  const directory = checkRuntime(source);
  try {
    return await loadEngine(directory);
  } catch {
    throw new SpecialistRuntimeUnavailable("Run make build with the current Pi installation, then restart Pi and resume the saved conversation");
  }
}
async function loadEngine(directory) {
  const { createJiti } = await import(pathToFileURL(join(directory, "node_modules/jiti/lib/jiti.mjs")).href);
  const entry = join(getPackageDir(), "dist/index.js");
  const sdkModules = {
    "@earendil-works/pi-coding-agent": sdk,
    [entry]: sdk,
    [pathToFileURL(entry).href]: sdk
  };
  try {
    const retained = realpathSync(join(directory, "node_modules/@earendil-works/pi-coding-agent/dist/index.js"));
    sdkModules[retained] = sdk;
    sdkModules[pathToFileURL(retained).href] = sdk;
  } catch (error) {
    if (error.code !== "ENOENT")
      throw error;
  }
  const jiti = createJiti(import.meta.url, {
    tryNative: false,
    moduleCache: false,
    virtualModules: {
      ...sdkModules,
      "@earendil-works/pi-agent-core": core,
      "@earendil-works/pi-ai": ai,
      "@earendil-works/pi-ai/compat": compat,
      "@earendil-works/pi-tui": tui,
      typebox,
      "typebox/compile": typeboxCompile,
      "typebox/value": typeboxValue
    }
  });
  const load = (name) => jiti.import(join(directory, "package/bundle", `${name}.js`));
  const [engine, agents, required, ceiling] = await Promise.all([
    load("index"),
    load("agents"),
    load("required-child-extensions"),
    load("capability-ceiling")
  ]);
  const runtime = {
    register: engine.default,
    registerAgent: agents.registerAgent,
    required: required.registerRequiredChildExtensions,
    ceiling: ceiling.registerSubagentCapabilityCeiling
  };
  if (Object.values(runtime).some((value) => typeof value !== "function"))
    throw Error("Incompatible specialist engine");
  return runtime;
}
function roleDefinition(source, name) {
  const text = readBounded(join(source, "agents", `${name}.md`)).replace(/\r\n/g, `
`);
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const description = match?.[1].match(/^description:\s*(.+)$/m)?.[1];
  if (!match || !description || !match[2].trim())
    throw Error("Invalid owned specialist role");
  return {
    description,
    systemPrompt: match[2].trim(),
    tools,
    systemPromptMode: "append",
    inheritProjectContext: true,
    inheritGlobalContext: true,
    inheritSkills: true,
    defaultContext: "fresh",
    defaultAsync: false,
    defaultProgress: false,
    defaultReads: [],
    defaultTimeoutMs: 120000,
    defaultToolTimeoutMs: 30000,
    maxSubagentDepth: 1,
    allowNestedSubagents: false,
    acceptanceRole: "read-only",
    extensions: [],
    subagentOnlyExtensions: [],
    outputMode: "inline",
    interactive: false
  };
}

// harnesses/pi/specialists.ts
var source = resolve(dirname(realpathSync2(fileURLToPath(import.meta.url))), "../..");
var parameters = Type.Object({
  agent: Type.Union(roles.map((name) => Type.Literal(name))),
  task: Type.String({ minLength: 1, maxLength: 16384 })
}, { additionalProperties: false });
function validate(input) {
  if (!input || Array.isArray(input) || Object.keys(input).some((key) => key !== "agent" && key !== "task") || !roles.includes(input.agent) || typeof input.task !== "string" || !input.task.trim() || Buffer.byteLength(input.task, "utf8") > 16384) {
    throw Error("Specialists accept only an approved agent and a nonblank task of at most 16384 UTF-8 bytes");
  }
}
function proxyApi(pi, capture) {
  return new Proxy(pi, { get(target, key) {
    if (key === "registerTool")
      return (tool) => {
        if (tool.name === "subagent")
          capture(tool);
        else
          target.registerTool({ ...tool, exposure: "hidden" });
      };
    return Reflect.get(target, key, target);
  } });
}
function registerFloor(runtime, sessionId) {
  const required = runtime.required({
    sessionId,
    requireForAllRunners: true,
    extensions: ["guard-policies", "worktree", "review-feedback"].map((id) => ({
      id,
      path: join2(source, "harnesses/pi", `${id}.bundle.ts`)
    }))
  });
  try {
    const ceiling = runtime.ceiling({
      sessionId,
      source: "ai-config-read-only-specialists",
      ceiling: { allowedAgents: roles.map(runtimeName), allowedTools: tools }
    });
    return [required, ceiling];
  } catch (error) {
    required.dispose();
    throw error;
  }
}
async function specialists(pi) {
  let runtime;
  try {
    runtime = await loadRuntime(source);
  } catch (error) {
    if (!(error instanceof SpecialistRuntimeUnavailable))
      throw error;
    const warning = `Read-only specialists unavailable. ${error.message}`;
    pi.on("session_start", (_event, ctx) => {
      if (ctx.hasUI)
        ctx.ui.notify(warning, "warning");
      else
        console.error(warning);
    });
    return;
  }
  let native;
  const owner = proxyApi(pi, (tool) => {
    native = tool;
  });
  await runtime.register(owner);
  const profiles = roles.map((name) => runtime.registerAgent({
    pi: owner,
    name: runtimeName(name),
    definition: roleDefinition(source, name)
  }));
  let floor = [];
  let readySession;
  const disposeFloor = () => {
    readySession = undefined;
    for (const handle of floor.splice(0))
      handle.dispose();
  };
  pi.on("session_start", (_event, ctx) => {
    disposeFloor();
    const sessionId = ctx.sessionManager.getSessionId();
    floor = registerFloor(runtime, sessionId);
    readySession = sessionId;
  });
  pi.on("session_shutdown", () => {
    disposeFloor();
    for (const profile of profiles)
      profile.dispose();
  });
  pi.registerTool({
    name: "subagent",
    label: "Read-only specialist",
    exposure: "model-only",
    executionMode: "sequential",
    parameters,
    description: "Consult an approved read-only specialist with inherited instructions. No writing, shell execution, nested delegation, background work, or managed worktrees. This does not replace restricted change review or grant action authority.",
    async execute(id, input, signal, update, ctx) {
      validate(input);
      if (!readySession || readySession !== ctx.sessionManager.getSessionId())
        throw Error("Specialist guard floor is not ready for this session");
      if (!native)
        throw Error("The pinned specialist engine is unavailable");
      checkRuntime(source);
      return native.execute(id, {
        agent: runtimeName(input.agent),
        task: input.task,
        async: false,
        context: "fresh"
      }, signal, update, ctx);
    }
  });
}
export {
  specialists as default
};
