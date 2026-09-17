#!/usr/bin/env bun

import crypto from "node:crypto";

import {
  prepareFrozenPublicationScope,
  renderPreparedPublication,
} from "../../../skills/review-change/runtime/review-publication-boundary.mjs";
import { validateReviewFragmentDestination } from "../../../skills/review-change/runtime/review-fragment-path.mjs";
import { renderPublicationFragment } from "../../../skills/review-change/runtime/review-publication-html.mjs";
import { normalizePublicationFindings } from "../../../skills/review-change/runtime/review-publication-protocol.mjs";
import {
  isReviewChangeInvocation,
  requestedPullRequestTarget,
} from "../../../skills/review-change/runtime/review-publication-invocation.mjs";
import {
  createGitHubProvider,
  resolveGitHubCliPath,
} from "../../../skills/review-change/runtime/review-publication-provider.mjs";
import {
  beginClaudePublicationInvocation,
  loadClaudePublicationSession,
  removeClaudePublicationSession,
  saveClaudePublicationSession,
} from "../../../skills/review-change/runtime/review-publication-session-state.mjs";

type HookPayload = Record<string, any>;
type PreparedPublication = Record<string, any>;
type PublicationFinding = Record<string, any>;
const MAX_FINDING_CLAIMS_BYTES = 1024 * 1024;
export const CLAUDE_PUBLICATION_HOOK_MARGIN_MS = 5_000;
const PROVIDER_EXECUTABLE_FIELD = "reviewPublicationGitHubCli";
const invocationAvailability = new Map<string, { available: boolean; marker: string }>();

type PublicationProvider = ReturnType<typeof createGitHubProvider>;

type HookDependencies = {
  environment?: Record<string, string | undefined>;
  beginInvocation?: (sessionId: string, invocationMarker: string) => Promise<void>;
  invocationMarker?: () => string;
  keyLoader?: (...arguments_: any[]) => Promise<Buffer>;
  provider?: PublicationProvider;
  prepare?: (target: string) => Promise<PreparedPublication>;
  render?: (prepared: PreparedPublication, findings: PublicationFinding[]) => Promise<string>;
  loadPrepared?: (sessionId: string) => Promise<PreparedPublication | undefined>;
  savePrepared?: (sessionId: string, prepared: PreparedPublication, invocationMarker: string) => Promise<void>;
  removePrepared?: (sessionId: string, currentInvocationMarker?: string) => Promise<void>;
  temporaryRoot?: string;
};

export async function handleClaudeReviewPublicationHook(
  payload: HookPayload,
  dependencies: HookDependencies = {},
): Promise<HookPayload | undefined> {
  const eventName = String(payload.hook_event_name ?? "");
  if (eventName === "SessionEnd") return removeSession(payload, dependencies);
  if (eventName === "PreToolUse") return renderFindingWrite(payload, dependencies);
  if (eventName !== "UserPromptSubmit" || typeof payload.prompt !== "string") return;
  return prepareInvocation(payload, dependencies);
}

async function prepareInvocation(payload: HookPayload, dependencies: HookDependencies) {
  const sessionId = requiredSessionId(payload);
  const target = requestedPullRequestTarget(payload.prompt);
  if (!target && !isReviewChangeInvocation(payload.prompt)) return;
  const invocationMarker = (dependencies.invocationMarker ?? crypto.randomUUID)();
  const beginInvocation = dependencies.beginInvocation ?? beginClaudePublicationInvocation;
  const removePrepared = dependencies.removePrepared
    ?? ((activeSessionId, marker) => removeClaudePublicationSession(
      activeSessionId,
      { currentInvocationMarker: marker },
    ));
  const savePrepared = dependencies.savePrepared
    ?? ((activeSessionId, prepared, marker) => saveClaudePublicationSession(
      activeSessionId,
      prepared,
      { invocationMarker: marker },
    ));
  invocationAvailability.set(sessionId, { available: false, marker: invocationMarker });
  try {
    await beginInvocation(sessionId, invocationMarker);
  } catch (error) {
    return blockPrompt(error);
  }
  try {
    await removePrepared(sessionId, invocationMarker);
    if (!target) return;
    const prepared = dependencies.prepare
      ? await dependencies.prepare(target)
      : await prepareWithInstalledGitHubCli(target, dependencies);
    await savePrepared(sessionId, prepared, invocationMarker);
    markInvocationAvailable(sessionId, invocationMarker);
    return promptContext(target, prepared);
  } catch (error) {
    return promptFailure(error);
  }
}

async function renderFindingWrite(payload: HookPayload, dependencies: HookDependencies) {
  if (payload.tool_name !== "Write") return;
  const input = payload.tool_input;
  const outputPath = input?.file_path ?? input?.path;
  if (typeof outputPath !== "string" || !outputPath.endsWith(".review-fragment")) return;
  try {
    const validatedOutputPath = await validateReviewFragmentDestination(outputPath, {
      repositoryRoot: typeof payload.cwd === "string" ? payload.cwd : process.cwd(),
      ...(dependencies.temporaryRoot ? { temporaryRoot: dependencies.temporaryRoot } : {}),
    });
    const sessionId = requiredSessionId(payload);
    if (invocationAvailability.get(sessionId)?.available === false) {
      throw new Error("Review publication is unavailable for the current invocation");
    }
    const loadPrepared = dependencies.loadPrepared ?? loadClaudePublicationSession;
    const prepared = await loadPrepared(sessionId);
    if (!prepared) throw new Error("Review publication is unavailable for the current invocation");
    const findings = findingClaims(input.content);
    const fragment = dependencies.render
      ? await dependencies.render(prepared, findings)
      : await renderFragment(prepared, findings, dependencies);
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: canonicalWriteInput(input, validatedOutputPath, fragment),
      },
    };
  } catch (error) {
    return denyRender(error);
  }
}

function canonicalWriteInput(input: HookPayload, outputPath: string, content: string) {
  if (typeof input.file_path === "string") return { ...input, file_path: outputPath, content };
  return { ...input, path: outputPath, content };
}

async function removeSession(payload: HookPayload, dependencies: HookDependencies) {
  const sessionId = requiredSessionId(payload);
  const removePrepared = dependencies.removePrepared ?? removeClaudePublicationSession;
  await removePrepared(sessionId);
  invocationAvailability.delete(sessionId);
}

async function prepareWithInstalledGitHubCli(
  target: string,
  dependencies: HookDependencies,
): Promise<PreparedPublication> {
  const { executable, provider } = directProvider(dependencies);
  const prepared = await prepareFrozenPublicationScope(target, {
    provider,
    ...(dependencies.keyLoader ? { keyLoader: dependencies.keyLoader } : {}),
  });
  return { ...prepared, [PROVIDER_EXECUTABLE_FIELD]: executable };
}

async function renderFragment(
  prepared: PreparedPublication,
  findings: PublicationFinding[],
  dependencies: HookDependencies,
) {
  const { [PROVIDER_EXECUTABLE_FIELD]: executable, ...publicationScope } = prepared;
  const { provider } = directProvider(dependencies, executable);
  const rendered = await renderPreparedPublication(publicationScope, findings, {
    provider,
    ...(dependencies.keyLoader ? { keyLoader: dependencies.keyLoader } : {}),
  });
  return renderPublicationFragment({
    publicationToken: rendered.publicationToken,
    findings,
    review: rendered.review,
  });
}

function directProvider(dependencies: HookDependencies, candidate?: unknown) {
  if (dependencies.provider) return { executable: candidate, provider: dependencies.provider };
  const environment = dependencies.environment ?? process.env;
  const executable = resolveGitHubCliPath({
    ...(typeof candidate === "string" ? { candidate } : {}),
    environment,
  });
  return {
    executable,
    provider: createGitHubProvider({ ghPath: executable, environment }),
  };
}

function promptContext(target: string, prepared: PreparedPublication): HookPayload {
  const additionalContext = [
    `The Claude Code prompt hook froze the exact Review publication scope for ${target} before model work.`,
    `Public scope: ${JSON.stringify(publicIdentity(prepared))}`,
    "For this pull-request review only, submit Finding claims only by writing JSON shaped as {\"findings\":[...]} to the intended .review-fragment path with the Write tool.",
    "The trusted Write hook replaces those claims with the signed form bound to this current invocation. Embed that fragment unchanged.",
    "Do not submit a frozen scope or call a publication helper. Non-pull-request reviews stay presentation-only.",
  ].join("\n");
  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext,
    },
  };
}

function markInvocationAvailable(sessionId: string, invocationMarker: string) {
  if (invocationAvailability.get(sessionId)?.marker === invocationMarker) {
    invocationAvailability.set(sessionId, { available: true, marker: invocationMarker });
  }
}

function blockPrompt(error: unknown): HookPayload {
  const message = error instanceof Error ? error.message : String(error);
  return {
    decision: "block",
    reason: `Review publication could not begin the current invocation: ${message}`,
  };
}

function promptFailure(error: unknown): HookPayload {
  const message = error instanceof Error ? error.message : String(error);
  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: `Review publication could not freeze the requested pull request: ${message}. Keep this report presentation-only.`,
    },
  };
}

function denyRender(error: unknown): HookPayload {
  const message = error instanceof Error ? error.message : String(error);
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `Review publication could not render the Finding claims: ${message}`,
    },
  };
}

function findingClaims(source: unknown): PublicationFinding[] {
  if (typeof source !== "string") throw new Error("Finding claims must be JSON text");
  if (Buffer.byteLength(source, "utf8") > MAX_FINDING_CLAIMS_BYTES) {
    throw new Error("Finding claims exceed the size limit");
  }
  const submitted = JSON.parse(source);
  if (!submitted || typeof submitted !== "object" || Array.isArray(submitted)) {
    throw new Error("Finding claims must be one object");
  }
  if (Object.keys(submitted).length !== 1 || !Array.isArray(submitted.findings)) {
    throw new Error("Only Finding claims are accepted");
  }
  try {
    return normalizePublicationFindings(submitted.findings);
  } catch {
    throw new Error("Every inline Finding must include an explicit LEFT or RIGHT diff side");
  }
}

function publicIdentity(prepared: PreparedPublication) {
  return {
    host: prepared.host,
    signingKeyId: prepared.signingKeyId,
    commentTemplateVersion: prepared.commentTemplateVersion,
    repository: prepared.repository,
    pullRequest: prepared.pullRequest,
    scope: prepared.scope,
  };
}

function requiredSessionId(payload: HookPayload): string {
  const sessionId = payload.session_id;
  if (typeof sessionId !== "string" || !sessionId) {
    throw new Error("Review publication requires the current Claude Code session");
  }
  return sessionId;
}

async function main(): Promise<void> {
  try {
    const payload = JSON.parse(await Bun.stdin.text());
    const output = await handleClaudeReviewPublicationHook(payload);
    if (output) process.stdout.write(JSON.stringify(output));
  } catch {
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
