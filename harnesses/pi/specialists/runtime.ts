import * as sdk from "@earendil-works/pi-coding-agent";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import policy from "./policy.json";

const { getAgentDir, getPackageDir, VERSION } = sdk;

export const roles = ["api-designer", "database-reviewer", "fact-checker", "frontend-architect"] as const;
export const tools = ["read", "grep", "find", "ls"];
export const runtimeName = (name: string) => `ai-config-${name}`;

function readBounded(path: string) {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > 65536) throw Error("Specialist support file is missing or oversized");
  return readFileSync(path, "utf8");
}

function requireOwnedPolicy() {
  let configured: unknown;
  try { configured = JSON.parse(readBounded(join(getAgentDir(), "extensions/subagent/config.json"))); }
  catch { throw Error("Specialist read-only policy is missing, unreadable, or invalid; use the approved installer"); }
  if (!isDeepStrictEqual(configured, policy)) throw Error("Specialist configuration is not the owned read-only policy; use the approved installer");
}

function requireMatchingHost(root: string) {
  const override = process.env.PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT?.trim();
  if (!override) return;
  let matches = false;
  try { matches = realpathSync(override) === root; } catch { /* Invalid overrides fail closed without quoting their value. */ }
  if (!matches) throw Error("Specialist host override does not match the active Pi SDK; use a matching host and rebuild");
}

export function checkRuntime(source: string) {
  const directory = join(source, "target/pi-subagents");
  const host = JSON.parse(readBounded(join(directory, "host.json")));
  const activeRoot = realpathSync(getPackageDir());
  const matchesBinary = host.standalone === true && host.packageRoot === activeRoot
    && host.executable === realpathSync(process.execPath);
  const sdk = JSON.parse(readBounded(join(host.sdkRoot, "package.json")));
  if (host.engineVersion !== "0.83.0" || (!matchesBinary && host.sdkRoot !== activeRoot)
    || host.sdkVersion !== VERSION || sdk.name !== "@earendil-works/pi-coding-agent" || sdk.version !== VERSION) {
    throw Error("Specialist runtime does not match this Pi host; rebuild this configuration with the current Pi installation");
  }
  requireMatchingHost(host.sdkRoot);
  requireOwnedPolicy();
  return directory;
}

export async function loadRuntime(source: string) {
  const directory = checkRuntime(source);
  const host = JSON.parse(readBounded(join(directory, "host.json")));
  let load = (name: string): Promise<any> => import(pathToFileURL(join(directory, "package/bundle", `${name}.js`)).href);
  if (host.standalone && host.executable === realpathSync(process.execPath)) {
    const { createJiti } = await import(pathToFileURL(join(directory, "node_modules/jiti/lib/jiti.mjs")).href);
    const entry = join(host.sdkRoot, "dist/index.js");
    // Native Bun imports bypass Pi's embedded SDK. Keep foreground children on the host SDK.
    const jiti = createJiti(import.meta.url, { tryNative: false, moduleCache: false,
      virtualModules: { "@earendil-works/pi-coding-agent": sdk, [entry]: sdk, [pathToFileURL(entry).href]: sdk } });
    load = (name: string) => jiti.import(join(directory, "package/bundle", `${name}.js`));
  }
  const [engine, agents, required, ceiling] = await Promise.all([
    load("index"), load("agents"), load("required-child-extensions"), load("capability-ceiling"),
  ]);
  return { register: engine.default, registerAgent: agents.registerAgent,
    required: required.registerRequiredChildExtensions, ceiling: ceiling.registerSubagentCapabilityCeiling };
}

export function roleDefinition(source: string, name: string) {
  const text = readBounded(join(source, "agents", `${name}.md`)).replace(/\r\n/g, "\n");
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const description = match?.[1].match(/^description:\s*(.+)$/m)?.[1];
  if (!match || !description || !match[2].trim()) throw Error("Invalid owned specialist role");
  return { description, systemPrompt: match[2].trim(), tools,
    systemPromptMode: "append", inheritProjectContext: true, inheritGlobalContext: true, inheritSkills: true,
    defaultContext: "fresh", defaultAsync: false, defaultProgress: false, defaultReads: [],
    defaultTimeoutMs: 120000, defaultToolTimeoutMs: 30000, maxSubagentDepth: 1,
    allowNestedSubagents: false, acceptanceRole: "read-only", extensions: [], subagentOnlyExtensions: [],
    outputMode: "inline", interactive: false };
}
