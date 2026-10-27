// Curated read-only delegation. The pinned package remains the execution engine.
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRuntime, loadRuntime, roleDefinition, roles, runtimeName, tools } from "./specialists/runtime";

type Registration = { dispose(): void };
const source = resolve(dirname(realpathSync(fileURLToPath(import.meta.url))), "../..");
const parameters = Type.Object({
  agent: Type.Union(roles.map(name => Type.Literal(name))),
  task: Type.String({ minLength: 1, maxLength: 16384 }),
}, { additionalProperties: false });

function validate(input: { agent: string; task: string }) {
  if (!input || Array.isArray(input) || Object.keys(input).some(key => key !== "agent" && key !== "task") ||
      !roles.includes(input.agent as typeof roles[number]) || typeof input.task !== "string" ||
      !input.task.trim() || Buffer.byteLength(input.task, "utf8") > 16384) {
    throw Error("Specialists accept only an approved agent and a nonblank task of at most 16384 UTF-8 bytes");
  }
}

function proxyApi(pi: ExtensionAPI, capture: (tool: ToolDefinition) => void) {
  return new Proxy(pi, { get(target, key) {
    if (key === "registerTool") return (tool: ToolDefinition) => {
      if (tool.name === "subagent") capture(tool);
      else target.registerTool({ ...tool, exposure: "hidden" });
    };
    return Reflect.get(target, key, target);
  } });
}

function registerFloor(runtime: Awaited<ReturnType<typeof loadRuntime>>, sessionId: string) {
  const required = runtime.required({ sessionId, requireForAllRunners: true,
    extensions: ["guard-policies", "worktree", "review-feedback"].map(id => ({
      id, path: join(source, "harnesses/pi", `${id}.bundle.ts`),
    })) });
  try {
    const ceiling = runtime.ceiling({ sessionId, source: "ai-config-read-only-specialists",
      ceiling: { allowedAgents: roles.map(runtimeName), allowedTools: tools } });
    return [required, ceiling];
  } catch (error) { required.dispose(); throw error; }
}

export default async function specialists(pi: ExtensionAPI) {
  const runtime = await loadRuntime(source);
  let native: ToolDefinition | undefined;
  const owner = proxyApi(pi, tool => { native = tool; });
  await runtime.register(owner);
  const profiles: Registration[] = roles.map(name => runtime.registerAgent({ pi: owner,
    name: runtimeName(name), definition: roleDefinition(source, name) }));
  let floor: Registration[] = [];
  let readySession: string | undefined;
  const disposeFloor = () => { readySession = undefined; for (const handle of floor.splice(0)) handle.dispose(); };
  pi.on("session_start", (_event, ctx) => {
    disposeFloor();
    const sessionId = ctx.sessionManager.getSessionId();
    floor = registerFloor(runtime, sessionId);
    readySession = sessionId;
  });
  pi.on("session_shutdown", () => { disposeFloor(); for (const profile of profiles) profile.dispose(); });
  pi.registerTool({ name: "subagent", label: "Read-only specialist", exposure: "model-only", executionMode: "sequential", parameters,
    description: "Consult an approved read-only specialist with inherited instructions. No writing, shell execution, nested delegation, background work, or managed worktrees. This does not replace restricted change review or grant action authority.",
    async execute(id, input, signal, update, ctx) {
      validate(input);
      if (!readySession || readySession !== ctx.sessionManager.getSessionId()) throw Error("Specialist guard floor is not ready for this session");
      if (!native) throw Error("The pinned specialist engine is unavailable");
      checkRuntime(source);
      return native.execute(id, { agent: runtimeName(input.agent), task: input.task,
        async: false, context: "fresh" }, signal, update, ctx);
    },
  });
}
