import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);
const PROTOCOL_VERSION = 1;
const CLI_TIMEOUT_MS = 120_000;
const TRANSITION_TOKEN_TTL_MS = 10 * 60 * 1_000;
const STRING_SCHEMA = { type: "string", "~kind": "String" };
const ORCHARD_PARAMETERS = {
  type: "object",
  required: ["command", "args", "continuation"],
  properties: {
    command: {
      anyOf: ["new", "convert", "enter", "deliver"].map((command) => ({
        type: "string",
        const: command,
        "~kind": "Literal",
      })),
      "~kind": "Union",
    },
    args: { type: "array", items: STRING_SCHEMA, "~kind": "Array" },
    continuation: STRING_SCHEMA,
  },
  "~kind": "Object",
};

type OrchardCommand = "new" | "convert" | "enter" | "deliver" | "status";

interface WorktreeOutcome {
  path: string;
  intent: string;
  branch: string;
}

interface MachineOutcome {
  protocolVersion: number;
  command: OrchardCommand;
  project?: { name: string; root: string; trunk: string; slots?: WorktreeOutcome[] };
  projects?: Array<{ name: string; root: string; slots: Array<WorktreeOutcome & { lifecycle: string }> }>;
  worktree?: WorktreeOutcome;
  owner?: { token: string; pid: number };
  transition?: { kind: "enter-worktree" | "return-main" | "none"; operationId?: string; targetPath: string };
  delivery?: { status: "needs-commit" | "integrated" | "pr-form-opened" | "finalized"; strategy?: string };
  commit?: { status: string };
}

interface ActiveOwner {
  token: string;
  intent: string;
  projectRoot: string;
}

interface PendingTransition {
  outcome: MachineOutcome;
  continuation: string;
  owner?: ActiveOwner;
  createdAt: number;
}

interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
}

interface OrchardExtensionDependencies {
  randomToken: () => string;
  now: () => number;
  processId: number;
  forkSession: (sourceSession: string, targetCwd: string) => Promise<string> | string;
  executeCli: (args: string[], cwd: string, signal?: AbortSignal) => Promise<CliResult>;
}

export function createOrchardExtension(
  dependencyOverrides: Partial<OrchardExtensionDependencies> = {},
) {
  const dependencies: OrchardExtensionDependencies = {
    randomToken: randomUUID,
    now: Date.now,
    processId: process.pid,
    forkSession: defaultForkSession,
    executeCli: defaultExecuteCli,
    ...dependencyOverrides,
  };

  return function registerOrchard(pi: ExtensionAPI): void {
    const pending = new Map<string, PendingTransition>();
    let transitioning = false;
    let activeOwner: ActiveOwner | undefined;

    pi.on("session_start", async (_event, ctx) => {
      activeOwner = await discoverActiveOwner(dependencies, ctx.cwd).catch(() => undefined);
    });

    pi.on("session_shutdown", async (_event, ctx) => {
      if (transitioning || !activeOwner) return;
      await releaseOwner(dependencies, activeOwner, ctx.cwd).catch(() => undefined);
      activeOwner = undefined;
    });

    pi.registerCommand("orchard-continue", {
      description: "Complete an authenticated Orchard worktree transition",
      handler: async (args, ctx) => {
        const token = args.trim();
        const request = pending.get(token);
        if (!request || dependencies.now() - request.createdAt > TRANSITION_TOKEN_TTL_MS) {
          pending.delete(token);
          ctx.ui.notify("Orchard transition request is missing or expired", "error");
          return;
        }
        pending.delete(token);
        if (ctx.mode !== "tui") {
          ctx.ui.notify("Orchard session transitions require pi TUI mode", "error");
          return;
        }
        const sourceSession = ctx.sessionManager.getSessionFile();
        if (!sourceSession) {
          ctx.ui.notify("Orchard cannot transition an unpersisted pi session", "error");
          return;
        }
        const targetPath = request.outcome.transition?.targetPath;
        if (!targetPath) {
          ctx.ui.notify("Orchard transition target is missing", "error");
          return;
        }
        try {
          const targetSession = await dependencies.forkSession(sourceSession, targetPath);
          transitioning = true;
          const result = await ctx.switchSession(targetSession, {
            withSession: async (replacementCtx) => {
              try {
                await completeReturnCleanup(dependencies, request, targetPath);
              } catch (error) {
                replacementCtx.ui.notify(
                  `Orchard cleanup failed; landed work remains preserved: ${errorMessage(error)}`,
                  "warning",
                );
              }
              await replacementCtx.sendUserMessage(request.continuation);
            },
          });
          if (result.cancelled) {
            transitioning = false;
            ctx.ui.notify(`Orchard transition was cancelled; work remains at ${targetPath}`, "warning");
          }
        } catch (error) {
          transitioning = false;
          ctx.ui.notify(`Orchard transition failed; work remains at ${targetPath}`, "error");
          throw error;
        }
      },
    });

    pi.registerTool({
      name: "orchard_transition",
      label: "Orchard Transition",
      description: "Run an interactive Orchard lifecycle command and continue this pi conversation in its target worktree.",
      promptSnippet: "Acquire, convert, enter, deliver, or return through Orchard in the same pi session",
      promptGuidelines: [
        "Use orchard_transition as the final action in a turn when an Orchard command must move the current pi conversation.",
        "After calling orchard_transition, do not emit another assistant response in the same turn.",
      ],
      parameters: ORCHARD_PARAMETERS as any,
      executionMode: "sequential",
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        if (pending.size > 0) {
          throw new Error("An Orchard transition is already awaiting confirmation");
        }
        if (ctx.ui.getEditorText().trim()) {
          throw new Error("Orchard will not overwrite the current editor draft");
        }
        const command = params.command as Exclude<OrchardCommand, "status">;
        const commandArgs = command === "enter"
          ? [command, ...params.args, "--owner-pid", String(dependencies.processId), "--json"]
          : [command, ...params.args, "--json"];
        const outcome = await runOrchard(dependencies, commandArgs, ctx.cwd, signal, true);
        if (outcome.transition?.kind === "none") {
          return {
            content: [{ type: "text", text: formatNonTransitionOutcome(outcome) }],
            details: {
              targetPath: outcome.transition.targetPath,
              deliveryStatus: outcome.delivery?.status,
              commitStatus: outcome.commit?.status,
            },
            terminate: false,
          };
        }
        const claimed = await claimAcquiredWorktree(dependencies, outcome, command, signal);
        if (claimed) activeOwner = claimed;
        const token = dependencies.randomToken();
        pending.set(token, {
          outcome,
          continuation: params.continuation,
          owner: claimed ?? activeOwner,
          createdAt: dependencies.now(),
        });
        ctx.ui.setEditorText(`/orchard-continue ${token}`);
        ctx.ui.notify("Press Enter to continue the Orchard transition", "info");
        return {
          content: [{ type: "text", text: `Queued Orchard transition to ${outcome.transition?.targetPath}.` }],
          details: { targetPath: outcome.transition?.targetPath },
          terminate: true,
        };
      },
    });
  };
}

async function discoverActiveOwner(
  dependencies: OrchardExtensionDependencies,
  cwd: string,
): Promise<ActiveOwner | undefined> {
  const status = await runOrchard(dependencies, ["status", "--json"], cwd, undefined, false);
  for (const project of status.projects ?? []) {
    const slot = project.slots.find((candidate) => candidate.lifecycle === "task"
      && path.resolve(candidate.path) === path.resolve(cwd));
    if (!slot) continue;
    const claimed = await runOrchard(dependencies, [
      "enter",
      slot.intent,
      "--owner-pid",
      String(dependencies.processId),
      "--json",
    ], project.root, undefined, true);
    if (!claimed.owner) return undefined;
    return { token: claimed.owner.token, intent: slot.intent, projectRoot: project.root };
  }
  return undefined;
}

async function claimAcquiredWorktree(
  dependencies: OrchardExtensionDependencies,
  outcome: MachineOutcome,
  command: Exclude<OrchardCommand, "status">,
  signal?: AbortSignal,
): Promise<ActiveOwner | undefined> {
  if (outcome.transition?.kind !== "enter-worktree" || !outcome.worktree) return undefined;
  if (command === "enter") {
    if (!outcome.owner || !outcome.project) throw new Error("Orchard enter did not return an ownership claim");
    return { token: outcome.owner.token, intent: outcome.worktree.intent, projectRoot: outcome.project.root };
  }
  const projectRoot = outcome.project?.root ?? outcome.worktree.path;
  const claimed = await runOrchard(dependencies, [
    "enter",
    outcome.worktree.intent,
    "--owner-pid",
    String(dependencies.processId),
    "--json",
  ], projectRoot, signal, true);
  if (!claimed.owner) throw new Error("Orchard did not return an ownership claim");
  return { token: claimed.owner.token, intent: outcome.worktree.intent, projectRoot };
}

async function completeReturnCleanup(
  dependencies: OrchardExtensionDependencies,
  request: PendingTransition,
  targetPath: string,
): Promise<void> {
  if (request.outcome.transition?.kind !== "return-main") return;
  if (request.owner) await releaseOwner(dependencies, request.owner, targetPath);
  const operationId = request.outcome.transition.operationId;
  if (!operationId) throw new Error("Orchard delivery did not return a cleanup operation");
  await runOrchard(dependencies, [
    "deliver",
    "--finalize-operation",
    operationId,
    "--json",
  ], targetPath, undefined, false);
}

async function releaseOwner(
  dependencies: OrchardExtensionDependencies,
  owner: ActiveOwner,
  cwd: string,
): Promise<void> {
  await runOrchard(dependencies, [
    "enter",
    owner.intent,
    "--release-owner",
    owner.token,
    "--json",
  ], cwd || owner.projectRoot, undefined, false);
}

async function runOrchard(
  dependencies: OrchardExtensionDependencies,
  args: string[],
  cwd: string,
  signal: AbortSignal | undefined,
  requireTransition: boolean,
): Promise<MachineOutcome> {
  const result = await dependencies.executeCli(args, cwd, signal);
  if (result.code !== 0) throw new Error(result.stderr.trim() || `orchard exited with status ${result.code}`);
  let outcome: MachineOutcome;
  try {
    outcome = JSON.parse(result.stdout) as MachineOutcome;
  } catch {
    throw new Error("Orchard returned malformed JSON");
  }
  if (outcome.protocolVersion !== PROTOCOL_VERSION) {
    const preservedPath = outcome.transition?.targetPath ? `; work remains at ${outcome.transition.targetPath}` : "";
    throw new Error(`Unsupported Orchard protocol version ${outcome.protocolVersion}${preservedPath}`);
  }
  if (requireTransition && (!outcome.transition || !path.isAbsolute(outcome.transition.targetPath))) {
    throw new Error("Orchard did not return a safe absolute transition target");
  }
  return outcome;
}

async function defaultExecuteCli(
  args: string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync("orchard", args, {
      cwd,
      encoding: "utf8",
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      signal,
    });
    return { stdout, stderr, code: 0, killed: false };
  } catch (error: any) {
    return {
      stdout: String(error?.stdout ?? ""),
      stderr: String(error?.stderr ?? errorMessage(error)),
      code: Number(error?.code) || 1,
      killed: Boolean(error?.killed),
    };
  }
}

function formatNonTransitionOutcome(outcome: MachineOutcome): string {
  const status = outcome.delivery?.status ?? "completed";
  const worktree = outcome.worktree?.path ?? outcome.transition?.targetPath ?? "unknown worktree";
  const commit = outcome.commit?.status ? `\n${outcome.commit.status}` : "";
  return `Orchard ${outcome.command} ${status} for ${worktree}.${commit}`;
}

async function defaultForkSession(sourceSession: string, targetCwd: string): Promise<string> {
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const fork = SessionManager.forkFrom(sourceSession, targetCwd);
  const sessionFile = fork.getSessionFile();
  if (!sessionFile) throw new Error("Orchard could not persist the replacement pi session");
  return sessionFile;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default createOrchardExtension();
