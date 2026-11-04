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
import policy from "./policy.json";

const { getAgentDir, getPackageDir } = sdk;

export const roles = ["api-designer", "database-reviewer", "fact-checker", "frontend-architect"] as const;
export const tools = ["read", "grep", "find", "ls"];
export const runtimeName = (name: string) => `ai-config-${name}`;
export class SpecialistRuntimeUnavailable extends Error {}

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
  let engine: { name?: string; version?: string } | undefined;
  try { engine = JSON.parse(readBounded(join(directory, "package/package.json"))); }
  catch { /* Missing or damaged build outputs need an explicit rebuild. */ }
  if (engine?.name !== "pi-subagents" || engine?.version !== "0.83.0") {
    throw new SpecialistRuntimeUnavailable("Run make build in the configuration source to restore the pinned engine");
  }
  let activeRoot: string;
  try { activeRoot = realpathSync(getPackageDir()); }
  catch { throw new SpecialistRuntimeUnavailable("This Pi installation was removed; restart Pi and resume the saved conversation"); }
  requireMatchingHost(activeRoot);
  requireOwnedPolicy();
  return directory;
}

export async function loadRuntime(source: string) {
  const directory = checkRuntime(source);
  try { return await loadEngine(directory); }
  catch { throw new SpecialistRuntimeUnavailable("Run make build with the current Pi installation, then restart Pi and resume the saved conversation"); }
}

async function loadEngine(directory: string) {
  const { createJiti } = await import(pathToFileURL(join(directory, "node_modules/jiti/lib/jiti.mjs")).href);
  const entry = join(getPackageDir(), "dist/index.js");
  const sdkModules: Record<string, typeof sdk> = {
    "@earendil-works/pi-coding-agent": sdk, [entry]: sdk, [pathToFileURL(entry).href]: sdk,
  };
  // The engine can resolve a retained build-time SDK before importing its absolute entry.
  try {
    const retained = realpathSync(join(directory, "node_modules/@earendil-works/pi-coding-agent/dist/index.js"));
    sdkModules[retained] = sdk;
    sdkModules[pathToFileURL(retained).href] = sdk;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  // Use the running host's modules, never execute build-time peers from an older installation.
  const jiti = createJiti(import.meta.url, { tryNative: false, moduleCache: false,
    virtualModules: {
      ...sdkModules,
      "@earendil-works/pi-agent-core": core, "@earendil-works/pi-ai": ai,
      "@earendil-works/pi-ai/compat": compat, "@earendil-works/pi-tui": tui,
      typebox, "typebox/compile": typeboxCompile, "typebox/value": typeboxValue,
    } });
  const load = (name: string): Promise<any> => jiti.import(join(directory, "package/bundle", `${name}.js`));
  const [engine, agents, required, ceiling] = await Promise.all([
    load("index"), load("agents"), load("required-child-extensions"), load("capability-ceiling"),
  ]);
  const runtime = { register: engine.default, registerAgent: agents.registerAgent,
    required: required.registerRequiredChildExtensions, ceiling: ceiling.registerSubagentCapabilityCeiling };
  if (Object.values(runtime).some(value => typeof value !== "function")) throw Error("Incompatible specialist engine");
  return runtime;
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
