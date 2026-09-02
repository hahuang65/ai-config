import crypto from "node:crypto";
import path from "node:path";

import { AgentMemoryClient } from "./client.ts";
import { installAgentMemoryFooter } from "./footer.ts";
import { resolveMemoryPolicy, resolveProjectIdentity } from "./config.ts";
import {
  displayField,
  formatSearchResults,
  lastAssistantText,
  MAX_OBSERVATION_CHARS,
  parseList,
  safeSerialize,
  SESSION_END_REASONS,
  wildcardMatch,
} from "./support.ts";
import type {
  AdapterDependencies,
  AgentMemoryEnvironment,
  CaptureMode,
  JsonRecord,
  RecallMode,
} from "./types.ts";

export class AgentMemoryRuntime {
  captureMode: CaptureMode;
  recallMode: RecallMode;
  private currentCwd = process.cwd();
  private currentProject: string;
  private currentPrompt = "";
  private readonly client: AgentMemoryClient;
  private excludedTools: string[];
  private readonly environment: AgentMemoryEnvironment;
  private readonly now: () => Date;
  private readonly projectIdentity: (cwd: string) => string;
  private readonly randomUUID: () => string;
  private serverAvailable = false;
  private sessionId: string;
  private sessionStarted = false;

  constructor(dependencies: AdapterDependencies = {}) {
    const environment = dependencies.environment ?? process.env;
    this.environment = environment;
    this.now = dependencies.now ?? (() => new Date());
    this.randomUUID = dependencies.randomUUID ?? crypto.randomUUID;
    this.projectIdentity = dependencies.projectIdentity ?? ((cwd) =>
      resolveProjectIdentity(cwd, { environment, git: dependencies.git }));
    this.currentProject = this.projectIdentity(this.currentCwd);
    const policy = resolveMemoryPolicy(this.currentProject, { environment });
    this.captureMode = policy.capture;
    this.recallMode = policy.recall;
    this.excludedTools = policy.excludedTools;
    this.sessionId = `ephemeral-${this.randomUUID().slice(0, 8)}`;
    this.client = new AgentMemoryClient(
      dependencies.fetch ?? globalThis.fetch,
      environment.AGENTMEMORY_URL,
      environment.AGENTMEMORY_SECRET,
    );
  }

  statusText(context?: any): string {
    const icon = this.serverAvailable ? "🧠" : "⚠️";
    const color = this.serverAvailable ? "success" : "error";
    const label = context?.ui?.theme?.fg?.(color, "agentmemory") ?? "agentmemory";
    return `${icon} ${label} · recall ${this.recallMode} · capture ${this.captureMode}`;
  }

  updateStatus(context: any): void {
    context?.ui?.setStatus?.("agentmemory", this.statusText(context));
  }

  async initializeSession(context: any): Promise<void> {
    this.currentCwd = context.cwd ?? process.cwd();
    this.currentProject = this.projectIdentity(this.currentCwd);
    const policy = resolveMemoryPolicy(this.currentProject, { environment: this.environment });
    this.captureMode = policy.capture;
    this.recallMode = policy.recall;
    this.excludedTools = policy.excludedTools;
    const sessionFile = context.sessionManager.getSessionFile();
    this.sessionId = sessionFile
      ? path.basename(sessionFile).replace(/\.[^.]+$/, "")
      : `ephemeral-${this.randomUUID().slice(0, 8)}`;
    this.serverAvailable = await this.client.call("health", { method: "GET" }) !== null;
    await this.startSession();
    this.updateStatus(context);
    installAgentMemoryFooter(context);
  }

  async startSession(): Promise<void> {
    if (!this.serverAvailable || this.sessionStarted || this.captureMode === "off") return;
    const response = await this.client.call("session/start", {
      body: { sessionId: this.sessionId, project: this.currentProject, cwd: this.currentCwd },
    });
    this.sessionStarted = response !== null;
  }

  async endSession(): Promise<void> {
    if (!this.sessionStarted) return;
    await this.client.call("session/end", { body: { sessionId: this.sessionId } });
    this.sessionStarted = false;
  }

  async shutdown(reason: string): Promise<void> {
    if (SESSION_END_REASONS.has(reason)) await this.endSession();
  }

  async setCaptureMode(mode: CaptureMode, context: any): Promise<string> {
    if (mode === "off") await this.endSession();
    this.captureMode = mode;
    if (mode !== "off") await this.startSession();
    this.updateStatus(context);
    return `agentmemory capture ${this.captureMode}; recall ${this.recallMode}.`;
  }

  async capturePrompt(event: any): Promise<void> {
    this.currentCwd = event.systemPromptOptions?.cwd ?? this.currentCwd;
    this.currentProject = this.projectIdentity(this.currentCwd);
    this.currentPrompt = event.prompt?.trim() ?? "";
    if (this.captureMode !== "full" || !this.currentPrompt) return;
    await this.observe("prompt_submit", { prompt: this.currentPrompt });
  }

  async captureTool(event: any): Promise<void> {
    const excluded = this.excludedTools.some((pattern) => wildcardMatch(event.toolName ?? "", pattern));
    if (this.captureMode === "off" || excluded) return;
    if (this.captureMode === "metadata") {
      await this.observe("post_tool_use", {
        tool_name: event.toolName,
        tool_error: Boolean(event.isError),
      });
      return;
    }
    await this.observe("post_tool_use", {
      tool_name: event.toolName,
      tool_input: safeSerialize(event.input),
      tool_output: safeSerialize(event.content),
      tool_error: Boolean(event.isError),
    });
  }

  async captureConversation(event: any): Promise<void> {
    if (this.captureMode !== "full" || !this.currentPrompt) return;
    const assistant = lastAssistantText(event.messages ?? []);
    if (!assistant) return;
    await this.observe("post_tool_use", {
      tool_name: "conversation",
      tool_input: this.currentPrompt.slice(0, MAX_OBSERVATION_CHARS),
      tool_output: assistant.slice(0, MAX_OBSERVATION_CHARS),
    });
  }

  async health(): Promise<JsonRecord | null> {
    const health = await this.client.call("health", { method: "GET" });
    this.serverAvailable = health !== null;
    return health;
  }

  async search(query: string, limit: number): Promise<{ text: string; results: unknown[] }> {
    if (this.recallMode === "off") {
      return { text: "Recall is off; continue with current canonical sources.", results: [] };
    }
    const payload = await this.client.call("search", {
      body: { query, limit, format: "compact", project: this.currentProject },
    });
    const results = Array.isArray(payload?.results) ? payload.results : [];
    const text = payload ? formatSearchResults(results) : "agentmemory is unavailable; continue without it.";
    return { text, results };
  }

  async save(parameters: JsonRecord): Promise<JsonRecord | null> {
    return this.client.call("remember", {
      body: {
        content: parameters.content,
        type: parameters.type ?? "fact",
        concepts: parseList(parameters.concepts),
        files: parseList(parameters.files),
        project: this.currentProject,
      },
    });
  }

  async sessions(limit: number): Promise<JsonRecord | null> {
    if (this.recallMode === "off") return null;
    const query = new URLSearchParams({ limit: String(limit), project: this.currentProject });
    return this.client.call(`sessions?${query}`, { method: "GET" });
  }

  async verify(id: string): Promise<JsonRecord | null> {
    return this.client.call("verify", { body: { id } });
  }

  async delete(memoryIds: string, reason?: string): Promise<JsonRecord | null> {
    return this.client.call("governance/memories", {
      method: "DELETE",
      body: {
        memoryIds: parseList(memoryIds),
        reason: reason ?? "confirmed stale memory",
      },
    });
  }

  savedText(saved: JsonRecord | null): string {
    if (!saved) return "agentmemory is unavailable; memory was not saved.";
    return `Saved historical memory ${displayField(saved, "id") ?? "without an id"}.`;
  }

  private async observe(hookType: string, observation: JsonRecord): Promise<void> {
    if (!this.serverAvailable || this.captureMode === "off") return;
    await this.client.call("observe", {
      body: {
        hookType,
        sessionId: this.sessionId,
        project: this.currentProject,
        cwd: this.currentCwd,
        timestamp: this.now().toISOString(),
        data: observation,
      },
    });
  }
}
