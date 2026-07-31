import * as fs from "node:fs";
import * as path from "node:path";

import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

import { resolveAgentModel } from "./model-selection.ts";
import { parseAgentTools } from "./tool-names.ts";

export { resolveAgentModel } from "./model-selection.ts";
export { parseAgentTools } from "./tool-names.ts";

export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  source: "user" | "project";
  filePath: string;
}

export interface AgentDiscoveryResult {
  agents: AgentConfig[];
  projectAgentsDir: string | null;
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
  if (!fs.existsSync(dir)) return [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const agents: AgentConfig[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = path.join(dir, entry.name);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
    if (typeof frontmatter.name !== "string" || typeof frontmatter.description !== "string") continue;

    let tools: string[] | undefined;
    try {
      tools = parseAgentTools(frontmatter.tools);
    } catch {
      continue;
    }

    agents.push({
      name: frontmatter.name,
      description: frontmatter.description,
      tools,
      model: resolveAgentModel(
        frontmatter.name,
        typeof frontmatter.model === "string" ? frontmatter.model : undefined,
      ),
      systemPrompt: body,
      source,
      filePath,
    });
  }
  return agents;
}

function isDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function findNearestProjectAgentsDir(cwd: string): string | null {
  let currentDir = cwd;
  while (true) {
    const candidate = path.join(currentDir, CONFIG_DIR_NAME, "agents");
    if (isDirectory(candidate)) return candidate;

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
  const userDir = path.join(getAgentDir(), "agents");
  const projectAgentsDir = findNearestProjectAgentsDir(cwd);
  const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
  const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");
  const agentMap = new Map<string, AgentConfig>();

  if (scope === "both") {
    for (const agent of userAgents) agentMap.set(agent.name, agent);
    for (const agent of projectAgents) agentMap.set(agent.name, agent);
  } else {
    for (const agent of scope === "user" ? userAgents : projectAgents) agentMap.set(agent.name, agent);
  }

  return { agents: [...agentMap.values()], projectAgentsDir };
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
  if (agents.length === 0) return { text: "none", remaining: 0 };
  const listed = agents.slice(0, maxItems);
  return {
    text: listed.map((agent) => `${agent.name} (${agent.source}): ${agent.description}`).join("; "),
    remaining: agents.length - listed.length,
  };
}
