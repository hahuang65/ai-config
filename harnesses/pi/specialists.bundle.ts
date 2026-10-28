// harnesses/pi/specialists.ts
import { Type } from "typebox";
import { realpathSync as realpathSync2 } from "node:fs";
import { dirname, join as join2, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// harnesses/pi/specialists/runtime.ts
import * as sdk from "@earendil-works/pi-coding-agent";
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
var { getAgentDir, getPackageDir, VERSION } = sdk;
var roles = ["api-designer", "database-reviewer", "fact-checker", "frontend-architect"];
var tools = ["read", "grep", "find", "ls"];
var runtimeName = (name) => `ai-config-${name}`;
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
  const host = JSON.parse(readBounded(join(directory, "host.json")));
  const activeRoot = realpathSync(getPackageDir());
  const matchesBinary = host.standalone === true && host.packageRoot === activeRoot && host.executable === realpathSync(process.execPath);
  const sdk2 = JSON.parse(readBounded(join(host.sdkRoot, "package.json")));
  if (host.engineVersion !== "0.83.0" || !matchesBinary && host.sdkRoot !== activeRoot || host.sdkVersion !== VERSION || sdk2.name !== "@earendil-works/pi-coding-agent" || sdk2.version !== VERSION) {
    throw Error("Specialist runtime does not match this Pi host; rebuild this configuration with the current Pi installation");
  }
  requireMatchingHost(host.sdkRoot);
  requireOwnedPolicy();
  return directory;
}
async function loadRuntime(source) {
  const directory = checkRuntime(source);
  const host = JSON.parse(readBounded(join(directory, "host.json")));
  let load = (name) => import(pathToFileURL(join(directory, "package/bundle", `${name}.js`)).href);
  if (host.standalone && host.executable === realpathSync(process.execPath)) {
    const { createJiti } = await import(pathToFileURL(join(directory, "node_modules/jiti/lib/jiti.mjs")).href);
    const entry = join(host.sdkRoot, "dist/index.js");
    const jiti = createJiti(import.meta.url, {
      tryNative: false,
      moduleCache: false,
      virtualModules: { "@earendil-works/pi-coding-agent": sdk, [entry]: sdk, [pathToFileURL(entry).href]: sdk }
    });
    load = (name) => jiti.import(join(directory, "package/bundle", `${name}.js`));
  }
  const [engine, agents, required, ceiling] = await Promise.all([
    load("index"),
    load("agents"),
    load("required-child-extensions"),
    load("capability-ceiling")
  ]);
  return {
    register: engine.default,
    registerAgent: agents.registerAgent,
    required: required.registerRequiredChildExtensions,
    ceiling: ceiling.registerSubagentCapabilityCeiling
  };
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
  const runtime = await loadRuntime(source);
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
