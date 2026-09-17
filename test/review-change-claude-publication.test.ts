import { expect, test } from "bun:test";
import crypto from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  handleClaudeReviewPublicationHook,
} from "../harnesses/claude/hooks/review-change-publication.ts";
import {
  beginClaudePublicationInvocation,
  loadClaudePublicationSession,
  removeClaudePublicationSession,
  saveClaudePublicationSession,
} from "../skills/review-change/runtime/review-publication-session-state.mjs";

const exactTarget = "https://github.com/Acme/Payments/pull/842";
const generatedFragmentPath = path.join(tmpdir(), "form.review-fragment");
const secondTarget = "https://github.com/Acme/Payments/pull/843";
const prepared = {
  host: "github.com",
  signingKeyId: "review-publication-v1",
  commentTemplateVersion: 1,
  repository: { id: "R_456", nameWithOwner: "Acme/Payments" },
  pullRequest: { id: "PR_789", number: 842, url: exactTarget },
  scope: { baseOid: "a".repeat(40), headOid: "b".repeat(40) },
  frozenScope: "signed-frozen-scope",
};
const finding = {
  id: "RPC-052",
  title: "Bind rendering to the invocation",
  body: "Render only against the current trusted session scope.",
  path: "runtime/review.mjs",
  line: 52,
  side: "RIGHT",
};

test("Claude exposes bounded public scope and renders Finding-only writes", async () => {
  const targets: string[] = [];
  const renderedTargets: string[] = [];
  const dependencies = memoryDependencies({
    prepare: async (target: string) => {
      targets.push(target);
      return prepared;
    },
    render: async (active: typeof prepared, findings: typeof finding[]) => {
      renderedTargets.push(`${active.pullRequest.url}:${findings[0].id}`);
      return "<form>signed</form>";
    },
  });
  const output = await handleClaudeReviewPublicationHook({
    hook_event_name: "UserPromptSubmit",
    prompt: `/review-change ${exactTarget}/files?diff=split#discussion`,
    cwd: "/repo",
    session_id: "session-1",
  }, dependencies);
  const rendered = await handleClaudeReviewPublicationHook({
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: {
      file_path: generatedFragmentPath,
      content: JSON.stringify({ findings: [finding] }),
    },
    session_id: "session-1",
  }, dependencies);
  const context = output?.hookSpecificOutput?.additionalContext ?? "";

  expect({
    targets,
    event: output?.hookSpecificOutput?.hookEventName,
    publicScope: context.includes(exactTarget) && context.includes(prepared.scope.headOid),
    exposesAuthorization: context.includes("signed-frozen-scope"),
    findingOnlyInstruction: context.includes("Finding claims only"),
    renderedTargets,
    renderedContent: rendered?.hookSpecificOutput?.updatedInput?.content,
  }).toEqual({
    targets: [exactTarget],
    event: "UserPromptSubmit",
    publicScope: true,
    exposesAuthorization: false,
    findingOnlyInstruction: true,
    renderedTargets: [`${exactTarget}:RPC-052`],
    renderedContent: "<form>signed</form>",
  });
});

test("Claude rejects missing or invalid diff sides before rendering", async () => {
  let renderCalls = 0;
  const dependencies = memoryDependencies({
    prepare: async () => prepared,
    render: async () => {
      renderCalls += 1;
      return "<form>unexpected</form>";
    },
  });
  await handleClaudeReviewPublicationHook({
    hook_event_name: "UserPromptSubmit",
    prompt: `/review-change ${exactTarget}`,
    cwd: "/repo",
    session_id: "session-side-validation",
  }, dependencies);
  const { side: _missingSide, ...missingSide } = finding;
  const missing = await handleClaudeReviewPublicationHook({
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: {
      file_path: generatedFragmentPath,
      content: JSON.stringify({ findings: [missingSide] }),
    },
    session_id: "session-side-validation",
  }, dependencies);
  const invalid = await handleClaudeReviewPublicationHook({
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: {
      file_path: generatedFragmentPath,
      content: JSON.stringify({ findings: [{ ...finding, side: "MIDDLE" }] }),
    },
    session_id: "session-side-validation",
  }, dependencies);

  expect({
    missing: missing?.hookSpecificOutput?.permissionDecisionReason,
    invalid: invalid?.hookSpecificOutput?.permissionDecisionReason,
    renderCalls,
  }).toEqual({
    missing: expect.stringContaining("explicit LEFT or RIGHT diff side"),
    invalid: expect.stringContaining("explicit LEFT or RIGHT diff side"),
    renderCalls: 0,
  });
});

test("Claude allows a generated report fragment under the canonical temporary root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "claude-fragment-path-"));
  const reportRoot = path.join(root, "review-change-report");
  await mkdir(reportRoot);
  try {
    const verdict = await renderWriteVerdict(path.join(reportRoot, "publication.review-fragment"), {
      temporaryRoot: root,
      cwd: process.cwd(),
    });

    expect(verdict?.hookSpecificOutput).toMatchObject({
      permissionDecision: "allow",
      updatedInput: { content: "<form>signed</form>" },
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Claude preserves a temporary-root alias that resolves to the canonical temporary root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "claude-fragment-alias-"));
  const canonicalRoot = path.join(root, "canonical");
  const aliasRoot = path.join(root, "alias");
  await mkdir(path.join(canonicalRoot, "report"), { recursive: true });
  await symlink(canonicalRoot, aliasRoot);
  try {
    const verdict = await renderWriteVerdict(path.join(aliasRoot, "report", "publication.review-fragment"), {
      temporaryRoot: aliasRoot,
      cwd: process.cwd(),
    });

    expect({
      decision: verdict?.hookSpecificOutput?.permissionDecision,
      canonicalPath: verdict?.hookSpecificOutput?.updatedInput?.file_path,
    }).toEqual({
      decision: "allow",
      canonicalPath: path.join(await realpath(canonicalRoot), "report", "publication.review-fragment"),
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

for (const fixture of [
  { name: "a relative fragment path", candidate: (root: string) => "publication.review-fragment" },
  { name: "a path outside the temporary root", candidate: (root: string) => path.join(path.dirname(root), "outside.review-fragment") },
  { name: "path traversal", candidate: (root: string) => `${root}/report/../publication.review-fragment` },
  { name: "nonexistent ancestry", candidate: (root: string) => path.join(root, "missing", "publication.review-fragment") },
] as const) {
  test(`Claude denies ${fixture.name} before rendering`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "claude-fragment-rejection-"));
    await mkdir(path.join(root, "report"));
    let renderCalls = 0;
    try {
      const verdict = await renderWriteVerdict(fixture.candidate(root), {
        temporaryRoot: root,
        cwd: process.cwd(),
        render: async () => { renderCalls += 1; return "<form>unsafe</form>"; },
      });

      expect({ decision: verdict?.hookSpecificOutput?.permissionDecision, renderCalls }).toEqual({
        decision: "deny",
        renderCalls: 0,
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
}

test("Claude denies a repository fragment path before rendering", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "claude-fragment-repository-"));
  const repository = path.join(root, "repository");
  await mkdir(repository);
  try {
    const verdict = await renderWriteVerdict(path.join(repository, "publication.review-fragment"), {
      temporaryRoot: root,
      cwd: repository,
    });

    expect(verdict?.hookSpecificOutput?.permissionDecision).toBe("deny");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Claude denies a symlink fragment destination before rendering", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "claude-fragment-destination-link-"));
  const reportRoot = path.join(root, "report");
  const destination = path.join(reportRoot, "publication.review-fragment");
  await mkdir(reportRoot);
  await symlink(path.join(root, "target"), destination);
  try {
    const verdict = await renderWriteVerdict(destination, { temporaryRoot: root, cwd: process.cwd() });

    expect(verdict?.hookSpecificOutput?.permissionDecision).toBe("deny");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Claude denies a symlink fragment ancestor even when it stays in the temporary root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "claude-fragment-ancestor-link-"));
  const reportRoot = path.join(root, "report");
  const linkedReportRoot = path.join(root, "linked-report");
  await mkdir(reportRoot);
  await symlink(reportRoot, linkedReportRoot);
  try {
    const verdict = await renderWriteVerdict(path.join(linkedReportRoot, "publication.review-fragment"), {
      temporaryRoot: root,
      cwd: process.cwd(),
    });

    expect(verdict?.hookSpecificOutput?.permissionDecision).toBe("deny");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Claude carries trusted scope between separate hook processes for one session", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "claude-publication-session-"));
  const sessionDependencies = {
    prepare: async () => prepared,
    beginInvocation: (sessionId: string, marker: string) => (
      beginClaudePublicationInvocation(sessionId, marker, { home })
    ),
    savePrepared: (sessionId: string, active: typeof prepared, marker: string) => (
      saveClaudePublicationSession(sessionId, active, { home, invocationMarker: marker })
    ),
    loadPrepared: (sessionId: string) => loadClaudePublicationSession(sessionId, { home }),
    removePrepared: (sessionId: string, marker?: string) => removeClaudePublicationSession(
      sessionId,
      { home, currentInvocationMarker: marker },
    ),
  };
  try {
    await handleClaudeReviewPublicationHook({
      hook_event_name: "UserPromptSubmit",
      prompt: `/review-change ${exactTarget}`,
      session_id: "session-across-processes",
    }, sessionDependencies);
    const rendered = await handleClaudeReviewPublicationHook({
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: {
        file_path: generatedFragmentPath,
        content: JSON.stringify({ findings: [finding] }),
      },
      session_id: "session-across-processes",
    }, {
      ...sessionDependencies,
      render: async (active) => `<form data-target="${active.pullRequest.number}">signed</form>`,
    });

    expect(rendered?.hookSpecificOutput?.updatedInput?.content).toBe(
      "<form data-target=\"842\">signed</form>",
    );
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("Claude session state rejects a valid saved scope copied to another session", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "claude-publication-session-binding-"));
  try {
    await beginClaudePublicationInvocation("source-session", "source-invocation", { home });
    await saveClaudePublicationSession("source-session", prepared, {
      home,
      invocationMarker: "source-invocation",
    });
    await copySavedSession(home, "source-session", "substituted-session");

    await expect(loadClaudePublicationSession("substituted-session", { home })).rejects.toThrow(
      "does not belong to this Claude Code session",
    );
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("Claude hook rejects cross-session substitution before rendering", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "claude-publication-hook-binding-"));
  let renderCalls = 0;
  try {
    await beginClaudePublicationInvocation("source-session", "source-invocation", { home });
    await saveClaudePublicationSession("source-session", prepared, {
      home,
      invocationMarker: "source-invocation",
    });
    await copySavedSession(home, "source-session", "substituted-session");
    const verdict = await handleClaudeReviewPublicationHook({
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: {
        file_path: generatedFragmentPath,
        content: JSON.stringify({ findings: [finding] }),
      },
      session_id: "substituted-session",
    }, {
      loadPrepared: (sessionId: string) => loadClaudePublicationSession(sessionId, { home }),
      render: async () => {
        renderCalls += 1;
        return "<form>unsafe</form>";
      },
    });

    expect({
      decision: verdict?.hookSpecificOutput?.permissionDecision,
      reason: verdict?.hookSpecificOutput?.permissionDecisionReason,
      renderCalls,
    }).toEqual({
      decision: "deny",
      reason: "Review publication could not render the Finding claims: Review publication session state does not belong to this Claude Code session",
      renderCalls: 0,
    });
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("Claude installed defaults resolve gh without REVIEW_PUBLICATION_GH for preparation and rendering", async () => {
  const fixture = await createGitHubCliFixture();
  const states = new Map<string, typeof prepared>();
  const markers = new Map<string, string>();
  const dependencies = {
    environment: { PATH: fixture.root, REVIEW_PUBLICATION_GH: undefined },
    keyLoader: async () => Buffer.alloc(32, 7),
    beginInvocation: async (sessionId: string, marker: string) => {
      markers.set(sessionId, marker);
      states.delete(sessionId);
    },
    loadPrepared: async (sessionId: string) => states.get(sessionId),
    savePrepared: async (sessionId: string, active: typeof prepared, marker: string) => {
      if (markers.get(sessionId) === marker) states.set(sessionId, active);
    },
    removePrepared: async () => {},
  };
  try {
    const output = await handleClaudeReviewPublicationHook({
      hook_event_name: "UserPromptSubmit",
      prompt: `/review-change ${exactTarget}`,
      session_id: "session-installed-default",
    }, dependencies);
    const rendered = await handleClaudeReviewPublicationHook({
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: {
        file_path: generatedFragmentPath,
        content: JSON.stringify({ findings: [finding] }),
      },
      session_id: "session-installed-default",
    }, dependencies);

    expect({
      prepared: output?.hookSpecificOutput?.additionalContext?.includes(exactTarget),
      form: rendered?.hookSpecificOutput?.updatedInput?.content.includes("<form"),
      calls: await fixture.calls(),
    }).toEqual({
      prepared: true,
      form: true,
      calls: ["api", "pr", "pr", "repo", "repo"],
    });
  } finally {
    await fixture.remove();
  }
});

test("Claude keeps non-pull-request prompts presentation-only", async () => {
  let preparations = 0;
  const dependencies = memoryDependencies({
    prepare: async () => {
      preparations += 1;
      return prepared;
    },
  });
  const output = await handleClaudeReviewPublicationHook({
    hook_event_name: "UserPromptSubmit",
    prompt: "/review-change main...feature",
    cwd: "/repo",
    session_id: "session-2",
  }, dependencies);

  expect({ output, preparations }).toEqual({ output: undefined, preparations: 0 });
});

test("Claude uses only the positional review target when intent text contains pull-request identifiers", async () => {
  const prompts = [
    `/review-change main...feature --intent "Compare with ${exactTarget}"`,
    `Review change feature/payments because the intent mentions gh:Acme/Payments/pull/842`,
    `/build --intent "After implementation, run Review change for ${exactTarget} and ${secondTarget}"`,
    `/review-change https://github.com/Acme/Payments/tree/feature/payments --intent "Compare ${exactTarget} and ${secondTarget}"`,
    `/review-change ${exactTarget} --intent "Compare ${secondTarget} and gh:Acme/Payments/pull/844"`,
  ];
  const preparedTargets: Array<{ invocation: number; target: string }> = [];
  let invocation = -1;
  const dependencies = memoryDependencies({
    prepare: async (target: string) => {
      preparedTargets.push({ invocation, target });
      return prepared;
    },
  });

  for (const [index, prompt] of prompts.entries()) {
    invocation = index;
    await handleClaudeReviewPublicationHook({
      hook_event_name: "UserPromptSubmit",
      prompt,
      session_id: `intent-session-${index}`,
    }, dependencies);
  }

  expect(preparedTargets).toEqual([{ invocation: 4, target: exactTarget }]);
});

test("Claude binds wildcard-helper attempts and replay to the latest invocation", async () => {
  const renderedTargets: string[] = [];
  const dependencies = memoryDependencies({
    prepare: async (target: string) => ({
      ...prepared,
      pullRequest: { ...prepared.pullRequest, number: Number(target.split("/").at(-1)), url: target },
      frozenScope: `scope:${target}`,
    }),
    render: async (active: typeof prepared) => {
      renderedTargets.push(active.pullRequest.url);
      return "<form>latest</form>";
    },
  });
  await handleClaudeReviewPublicationHook({
    hook_event_name: "UserPromptSubmit",
    prompt: `/review-change ${exactTarget}`,
    session_id: "session-3",
  }, dependencies);
  await handleClaudeReviewPublicationHook({
    hook_event_name: "UserPromptSubmit",
    prompt: `/review-change ${secondTarget}`,
    session_id: "session-3",
  }, dependencies);
  const wildcardVerdict = await handleClaudeReviewPublicationHook({
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "review-pub* --prepare gh:attacker/other/pull/1 /tmp/scope.review-scope.json" },
    session_id: "session-3",
  }, dependencies);
  await handleClaudeReviewPublicationHook({
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: {
      file_path: generatedFragmentPath,
      content: JSON.stringify({ findings: [finding] }),
    },
    session_id: "session-3",
  }, dependencies);

  expect({ wildcardVerdict, renderedTargets }).toEqual({
    wildcardVerdict: undefined,
    renderedTargets: [secondTarget],
  });
});

test("Claude installs its own trusted Review publication hook boundary", async () => {
  const [settingsSource, manifestSource, readmeSource] = await Promise.all([
    readFile(new URL("../harnesses/claude/settings.json", import.meta.url), "utf8"),
    readFile(new URL("../harnesses/claude/manifest.sh", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);
  const settings = JSON.parse(settingsSource);
  const commands = ["UserPromptSubmit", "PreToolUse"]
    .flatMap((event) => settings.hooks[event])
    .flatMap((entry: any) => entry.hooks)
    .map((hook: any) => hook.command);
  const publicationMatcher = settings.hooks.PreToolUse.find((entry: any) => (
    entry.hooks.some((hook: any) => hook.command === "bun ~/.claude/hooks/review-change-publication.ts")
  ))?.matcher;
  const sessionEndCommands = settings.hooks.SessionEnd
    .flatMap((entry: any) => entry.hooks)
    .map((hook: any) => hook.command);

  expect({
    promptBoundary: commands.includes("bun ~/.claude/hooks/review-change-publication.ts"),
    findingBoundary: publicationMatcher,
    installedByClaudeManifest: manifestSource.includes("review-change-publication.ts"),
    noPiPath: !manifestSource.includes("harnesses/pi"),
    sessionEndHandlers: sessionEndCommands,
    readmeNamesBothBoundaries:
      readmeSource.includes("Claude Code `UserPromptSubmit` hook")
      && readmeSource.includes("pi `review_change_publication` tool"),
  }).toEqual({
    promptBoundary: true,
    findingBoundary: "Write",
    installedByClaudeManifest: true,
    noPiPath: true,
    sessionEndHandlers: [
      "bun ~/.claude/hooks/review-change-publication.ts",
      "bun ~/.dotfiles/ai/harnesses/claude/hooks/agentmemory-capture.ts",
    ],
    readmeNamesBothBoundaries: true,
  });
});

async function renderWriteVerdict(
  filePath: string,
  options: {
    temporaryRoot: string;
    cwd: string;
    render?: () => Promise<string>;
  },
) {
  return handleClaudeReviewPublicationHook({
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: {
      file_path: filePath,
      content: JSON.stringify({ findings: [finding] }),
    },
    cwd: options.cwd,
    session_id: "fragment-path-session",
  }, {
    temporaryRoot: options.temporaryRoot,
    loadPrepared: async () => prepared,
    render: options.render ?? (async () => "<form>signed</form>"),
  });
}

async function copySavedSession(home: string, sourceSessionId: string, targetSessionId: string) {
  const root = path.join(home, ".claude", "review-publication-sessions");
  const sourceBinding = crypto.createHash("sha256").update(sourceSessionId).digest("hex");
  const targetBinding = crypto.createHash("sha256").update(targetSessionId).digest("hex");
  for (const name of await readdir(root)) {
    if (!name.startsWith(sourceBinding)) continue;
    await copyFile(path.join(root, name), path.join(root, `${targetBinding}${name.slice(sourceBinding.length)}`));
  }
}

async function createGitHubCliFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "claude-review-gh-default-"));
  const executable = path.join(root, "gh");
  const log = path.join(root, "calls");
  const script = `#!/bin/sh
printf '%s\\n' "$1" >> '${log}'
case "$1" in
  repo) printf '%s\\n' '${JSON.stringify(prepared.repository)}' ;;
  pr) printf '%s\\n' '${JSON.stringify({
    ...prepared.pullRequest,
    baseRefOid: prepared.scope.baseOid,
    headRefOid: prepared.scope.headOid,
  })}' ;;
  api) printf '%s\\n' '{"node_id":"U_1","login":"reviewer"}' ;;
  *) exit 2 ;;
esac
`;
  await writeFile(executable, script);
  await chmod(executable, 0o755);
  return {
    root,
    calls: async () => (await readFile(log, "utf8")).trim().split("\n").sort(),
    remove: () => rm(root, { force: true, recursive: true }),
  };
}

function memoryDependencies({
  prepare = async () => prepared,
  render = async () => "<form>signed</form>",
}: {
  prepare?: (target: string) => Promise<typeof prepared>;
  render?: (preparedScope: typeof prepared, findings: typeof finding[]) => Promise<string>;
} = {}) {
  const states = new Map<string, typeof prepared>();
  const markers = new Map<string, string>();
  return {
    prepare,
    render,
    beginInvocation: async (sessionId: string, marker: string) => {
      markers.set(sessionId, marker);
      states.delete(sessionId);
    },
    loadPrepared: async (sessionId: string) => states.get(sessionId),
    savePrepared: async (sessionId: string, active: typeof prepared, marker: string) => {
      if (markers.get(sessionId) === marker) states.set(sessionId, active);
    },
    removePrepared: async () => {},
  };
}
