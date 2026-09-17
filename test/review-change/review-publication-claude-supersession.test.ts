import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { handleClaudeReviewPublicationHook } from "../../harnesses/claude/hooks/review-change-publication.ts";
import {
  beginClaudePublicationInvocation,
  loadClaudePublicationSession,
  removeClaudePublicationSession,
  saveClaudePublicationSession,
} from "../../skills/review-change/runtime/review-publication-session-state.mjs";

const firstTarget = "https://github.com/acme/payments/pull/842";
const secondTarget = "https://github.com/acme/payments/pull/843";
const fragmentPath = path.join(tmpdir(), "claude-supersession.review-fragment");
const findingClaims = JSON.stringify({
  findings: [{
    id: "RPC-081",
    title: "Stale publication scope",
    body: "Do not render an earlier invocation.",
    path: "runtime/publication.mjs",
    line: 81,
    side: "RIGHT",
  }],
});

function prepared(target: string) {
  return {
    host: "github.com",
    signingKeyId: "review-publication-v1",
    commentTemplateVersion: 1,
    repository: { id: "R_1", nameWithOwner: "acme/payments" },
    pullRequest: { id: `PR_${target.split("/").at(-1)}`, number: Number(target.split("/").at(-1)), url: target },
    scope: { baseOid: "a".repeat(40), headOid: "b".repeat(40) },
    frozenScope: `scope:${target}`,
  };
}

test("a removal failure leaves the new Claude invocation unable to publish the previous scope", async () => {
  const fixture = await sessionFixture();
  try {
    await invokeReview(fixture.dependencies, firstTarget);
    fixture.failRemoval = true;
    const preparation = await invokeReview(fixture.dependencies, secondTarget);
    const write = await renderWrite(fixture.dependencies);

    expect({
      preparationOnly: preparation?.hookSpecificOutput?.additionalContext.includes("presentation-only"),
      decision: write?.hookSpecificOutput?.permissionDecision,
      renderedTargets: fixture.renderedTargets,
    }).toEqual({ preparationOnly: true, decision: "deny", renderedTargets: [] });
  } finally {
    await fixture.remove();
  }
});

test("a preparation failure disables publication instead of falling back to the previous scope", async () => {
  const fixture = await sessionFixture();
  try {
    await invokeReview(fixture.dependencies, firstTarget);
    fixture.failPreparation = true;
    await invokeReview(fixture.dependencies, secondTarget);
    const write = await renderWrite(fixture.dependencies);

    expect({
      decision: write?.hookSpecificOutput?.permissionDecision,
      renderedTargets: fixture.renderedTargets,
    }).toEqual({ decision: "deny", renderedTargets: [] });
  } finally {
    await fixture.remove();
  }
});

test("a later Write after failed cleanup cannot render a superseded Claude scope", async () => {
  const fixture = await sessionFixture();
  try {
    await invokeReview(fixture.dependencies, firstTarget);
    fixture.failRemoval = true;
    await invokeReview(fixture.dependencies, secondTarget);
    fixture.failRemoval = false;

    const write = await renderWrite(fixture.dependencies);

    expect(write?.hookSpecificOutput).toMatchObject({ permissionDecision: "deny" });
    expect(fixture.renderedTargets).toEqual([]);
  } finally {
    await fixture.remove();
  }
});

test("a failed durable begin blocks model work and later Writes until a valid invocation recovers", async () => {
  const fixture = await sessionFixture();
  try {
    await invokeReview(fixture.dependencies, firstTarget);
    fixture.failBegin = true;

    const failed = await invokeReview(fixture.dependencies, secondTarget);
    const denied = await renderWrite(fixture.dependencies);

    fixture.failBegin = false;
    const recovered = await invokeReview(fixture.dependencies, secondTarget);
    const allowed = await renderWrite(fixture.dependencies);

    expect({
      failedDecision: failed?.decision,
      failedReason: failed?.reason,
      deniedDecision: denied?.hookSpecificOutput?.permissionDecision,
      recoveredContext: recovered?.hookSpecificOutput?.additionalContext.includes(secondTarget),
      allowedDecision: allowed?.hookSpecificOutput?.permissionDecision,
      preparedTargets: fixture.preparedTargets,
      renderedTargets: fixture.renderedTargets,
    }).toEqual({
      failedDecision: "block",
      failedReason: "Review publication could not begin the current invocation: simulated invocation marker failure",
      deniedDecision: "deny",
      recoveredContext: true,
      allowedDecision: "allow",
      preparedTargets: [firstTarget, secondTarget],
      renderedTargets: [secondTarget],
    });
  } finally {
    await fixture.remove();
  }
});

test("a normal supersession renders only the exact current Claude invocation marker", async () => {
  const fixture = await sessionFixture();
  try {
    await invokeReview(fixture.dependencies, firstTarget);
    await invokeReview(fixture.dependencies, secondTarget);
    const write = await renderWrite(fixture.dependencies);

    expect({
      decision: write?.hookSpecificOutput?.permissionDecision,
      renderedContent: write?.hookSpecificOutput?.updatedInput?.content,
      renderedTargets: fixture.renderedTargets,
    }).toEqual({
      decision: "allow",
      renderedContent: "<form>843</form>",
      renderedTargets: [secondTarget],
    });
  } finally {
    await fixture.remove();
  }
});

async function sessionFixture() {
  const home = await mkdtemp(path.join(tmpdir(), "claude-publication-supersession-"));
  const fixture = {
    failBegin: false,
    failRemoval: false,
    failPreparation: false,
    preparedTargets: [] as string[],
    renderedTargets: [] as string[],
    dependencies: {} as Record<string, unknown>,
    remove: () => rm(home, { force: true, recursive: true }),
  };
  fixture.dependencies = {
    invocationMarker: (() => {
      let marker = 0;
      return () => `invocation-${++marker}`;
    })(),
    beginInvocation: (sessionId: string, marker: string) => {
      if (fixture.failBegin) throw new Error("simulated invocation marker failure");
      return beginClaudePublicationInvocation(sessionId, marker, { home });
    },
    removePrepared: async (sessionId: string, marker?: string) => {
      if (fixture.failRemoval) throw new Error("simulated stale-state removal failure");
      await removeClaudePublicationSession(sessionId, { home, currentInvocationMarker: marker });
    },
    prepare: async (target: string) => {
      if (fixture.failPreparation) throw new Error("simulated preparation failure");
      fixture.preparedTargets.push(target);
      return prepared(target);
    },
    savePrepared: (sessionId: string, active: Record<string, unknown>, marker: string) => (
      saveClaudePublicationSession(sessionId, active, { home, invocationMarker: marker })
    ),
    loadPrepared: (sessionId: string) => loadClaudePublicationSession(sessionId, { home }),
    render: async (active: ReturnType<typeof prepared>) => {
      fixture.renderedTargets.push(active.pullRequest.url);
      return `<form>${active.pullRequest.number}</form>`;
    },
  };
  return fixture;
}

function invokeReview(dependencies: Record<string, unknown>, target: string) {
  return handleClaudeReviewPublicationHook({
    hook_event_name: "UserPromptSubmit",
    prompt: `/review-change ${target}`,
    session_id: "same-session",
  }, dependencies as any);
}

function renderWrite(dependencies: Record<string, unknown>) {
  return handleClaudeReviewPublicationHook({
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: fragmentPath, content: findingClaims },
    session_id: "same-session",
  }, dependencies as any);
}
