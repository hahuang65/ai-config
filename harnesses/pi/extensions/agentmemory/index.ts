import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerAgentMemoryCommands } from "./commands.ts";
import { registerAgentMemoryEvents } from "./events.ts";
import { AgentMemoryRuntime } from "./runtime.ts";
import { registerAgentMemoryTools } from "./tools.ts";
import type { AdapterDependencies } from "./types.ts";

export { resolveMemoryPolicy, resolveProjectIdentity } from "./config.ts";
export type { AgentMemoryEnvironment } from "./types.ts";

export default function registerAgentMemory(
  pi: ExtensionAPI,
  dependencies: AdapterDependencies = {},
): void {
  const runtime = new AgentMemoryRuntime(dependencies);
  registerAgentMemoryCommands(pi, runtime);
  registerAgentMemoryTools(pi, runtime);
  registerAgentMemoryEvents(pi, runtime);
}
