import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  registerReviewChangePublication as registerInstalledReviewChangePublication,
} from "../harnesses/pi/review-change-publication.bundle.ts";
import {
  registerReviewChangePublication,
  requestedPullRequestTarget,
} from "../harnesses/pi/extensions/review-change-publication.ts";
import {
  prepareFrozenPublicationScope,
  renderPublicationClaims,
} from "../skills/review-change/runtime/review-publication-boundary.mjs";
import { createReviewPublicationMetadata } from "../skills/review-change/runtime/review-publication-metadata.mjs";
import { resolveGitHubCliPath } from "../skills/review-change/runtime/review-publication-provider.mjs";

const baseOid = "a".repeat(40);
const headOid = "b".repeat(40);
const exactTarget = "https://github.com/Acme/Payments/pull/842";
const identity = {
  host: "github.com",
  signingKeyId: "review-publication-v1",
  commentTemplateVersion: 1,
  repository: { id: "R_456", nameWithOwner: "Acme/Payments" },
  pullRequest: { id: "PR_789", number: 842, url: exactTarget },
  scope: { baseOid, headOid },
};
const finding = {
  id: "RPC-037",
  title: "Keep the requested pull request",
  body: "Use the target selected at invocation.",
  path: "runtime/review.mjs",
  line: 37,
  side: "RIGHT",
};

describe("trusted in-session Review publication boundary", () => {
  test("freezes the user-requested pull request before the reviewer can render claims", async () => {
    const harness = createHarness();
    const lifecycle: string[] = [];
    registerReviewChangePublication(harness.pi as never, {
      prepare: async ({ target }) => {
        lifecycle.push(`prepare:${target}`);
        return { ...identity, frozenScope: "signed-frozen-scope" };
      },
      render: async ({ prepared, findings }) => {
        lifecycle.push(`render:${prepared.pullRequest.url}:${findings[0].id}`);
        return { fragmentPath: "/tmp/form.review-fragment", fragment: "<form>signed</form>" };
      },
    });

    await harness.input({ text: `/skill:review-change ${exactTarget}`, source: "interactive" });
    const scope = await harness.execute({ action: "scope" });
    const rendered = await harness.execute({ action: "render", findings: [finding] });

    expect({
      lifecycle,
      scope: JSON.parse(scope.content[0].text),
      scopeExposesAuthorization: scope.content[0].text.includes("signed-frozen-scope"),
      rendered: rendered.content[0].text,
    }).toEqual({
      lifecycle: [
        `prepare:${exactTarget}`,
        `render:${exactTarget}:RPC-037`,
      ],
      scope: identity,
      scopeExposesAuthorization: false,
      rendered: "<form>signed</form>",
    });
  });

  test("rejects missing or invalid diff sides before direct pi rendering", async () => {
    const harness = createHarness();
    let renderCalls = 0;
    registerReviewChangePublication(harness.pi as never, {
      prepare: async () => ({ ...identity, frozenScope: "signed-frozen-scope" }),
      render: async () => {
        renderCalls += 1;
        return { fragment: "<form>unexpected</form>" };
      },
    });

    await harness.input({ text: `/skill:review-change ${exactTarget}`, source: "interactive" });
    const { side: _missingSide, ...missingSide } = finding;
    await expect(harness.execute({ action: "render", findings: [missingSide] })).rejects.toThrow("explicit LEFT or RIGHT diff side");
    await expect(harness.execute({ action: "render", findings: [{ ...finding, side: "MIDDLE" }] })).rejects.toThrow("explicit LEFT or RIGHT diff side");

    expect(renderCalls).toBe(0);
  });

  test("carries explicit deleted and added diff sides into direct pi rendering", async () => {
    const harness = createHarness();
    const renderedSides: string[][] = [];
    registerReviewChangePublication(harness.pi as never, {
      prepare: async () => ({ ...identity, frozenScope: "signed-frozen-scope" }),
      render: async ({ findings }) => {
        renderedSides.push(findings.map((candidate) => candidate.side));
        return { fragment: "<form>signed</form>" };
      },
    });

    await harness.input({ text: `/skill:review-change ${exactTarget}`, source: "interactive" });
    await harness.execute({
      action: "render",
      findings: [
        { ...finding, id: "RPC-091-L", side: "LEFT" },
        { ...finding, id: "RPC-091-R", side: "RIGHT" },
      ],
    });

    expect(renderedSides).toEqual([["LEFT", "RIGHT"]]);
  });

  test("keeps the active scope across steering between preparation and rendering", async () => {
    const harness = createHarness();
    const renderedTargets: string[] = [];
    registerReviewChangePublication(harness.pi as never, {
      prepare: async () => ({ ...identity, frozenScope: "signed-frozen-scope" }),
      render: async ({ prepared }) => {
        renderedTargets.push(prepared.pullRequest.url);
        return { fragmentPath: "/tmp/form.review-fragment", fragment: "<form>signed</form>" };
      },
    });

    await harness.input({ text: `Review change ${exactTarget}`, source: "interactive" });
    await harness.input({ text: "Focus on the provider boundary next.", source: "interactive" });
    await harness.event("agent_settled", {});
    await harness.input({ text: "Also check stale review replay.", source: "queued" });
    await harness.execute({ action: "render", findings: [finding] });

    expect(renderedTargets).toEqual([exactTarget]);
  });

  test("binds wildcard-helper attempts and replay to the latest recognized invocation", async () => {
    const secondTarget = "https://github.com/Acme/Payments/pull/843";
    const harness = createHarness();
    const renderedTargets: string[] = [];
    registerReviewChangePublication(harness.pi as never, {
      prepare: async ({ target }) => ({
        ...identity,
        pullRequest: { ...identity.pullRequest, number: Number(target.split("/").at(-1)), url: target },
        frozenScope: `scope:${target}`,
      }),
      render: async ({ prepared }) => {
        renderedTargets.push(prepared.pullRequest.url);
        return { fragmentPath: "/tmp/form.review-fragment", fragment: "<form>signed</form>" };
      },
    });

    await harness.input({ text: `Review change ${exactTarget}`, source: "interactive" });
    await harness.input({ text: `Review change ${secondTarget}`, source: "interactive" });
    const wildcardVerdict = harness.toolCall({
      toolName: "bash",
      input: { command: "review-pub* --prepare gh:attacker/other/pull/1 /tmp/scope.review-scope.json" },
    });
    await harness.execute({ action: "render", findings: [finding] });

    expect({ wildcardVerdict, renderedTargets }).toEqual({
      wildcardVerdict: undefined,
      renderedTargets: [secondTarget],
    });
  });

  test("does not let reviewer tool arguments replace the frozen target", async () => {
    const harness = createHarness();
    let renderCalls = 0;
    registerReviewChangePublication(harness.pi as never, {
      prepare: async () => ({ ...identity, frozenScope: "signed-frozen-scope" }),
      render: async () => {
        renderCalls += 1;
        return { fragmentPath: "/tmp/form.review-fragment" };
      },
    });
    await harness.input({ text: `Review change ${exactTarget}`, source: "interactive" });

    await expect(harness.execute({
      action: "render",
      findings: [finding],
      repository: { id: "R_other", nameWithOwner: "attacker/other" },
      scope: { baseOid: "c".repeat(40), headOid: "d".repeat(40) },
    })).rejects.toThrow("only accepts Finding claims");
    expect(renderCalls).toBe(0);
  });

  test("gives non-pull-request reviews no publication capability", async () => {
    const harness = createHarness();
    let preparations = 0;
    registerReviewChangePublication(harness.pi as never, {
      prepare: async () => {
        preparations += 1;
        return { ...identity, frozenScope: "signed-frozen-scope" };
      },
      render: async () => ({ fragment: "<form>unused</form>" }),
    });

    await harness.input({ text: "/skill:review-change main...feature", source: "interactive" });

    await expect(harness.execute({ action: "scope" })).rejects.toThrow("not available");
    expect(preparations).toBe(0);
  });

  test("uses only the positional pi review target when intent text contains pull-request identifiers", async () => {
    const secondTarget = "https://github.com/Acme/Payments/pull/843";
    const invocations = [
      `/skill:review-change main...feature --intent "Compare with ${exactTarget}"`,
      `Review change feature/payments because the intent mentions gh:Acme/Payments/pull/842`,
      `/build --intent "After implementation, run Review change for ${exactTarget} and ${secondTarget}"`,
      `/skill:review-change https://github.com/Acme/Payments/tree/feature/payments --intent "Compare ${exactTarget} and ${secondTarget}"`,
      `/skill:review-change ${exactTarget} --intent "Compare ${secondTarget} and gh:Acme/Payments/pull/844"`,
    ];
    const preparedTargets: Array<{ invocation: number; target: string }> = [];
    let invocation = -1;
    const harness = createHarness();
    registerReviewChangePublication(harness.pi as never, {
      prepare: async ({ target }) => {
        preparedTargets.push({ invocation, target });
        return { ...identity, frozenScope: "scope" };
      },
      render: async () => ({ fragment: "<form>signed</form>" }),
    });

    for (const [index, text] of invocations.entries()) {
      invocation = index;
      await harness.input({ text, source: "interactive" });
    }

    expect(preparedTargets).toEqual([{ invocation: 4, target: exactTarget }]);
  });

  test("clears harness-owned scope when the session ends", async () => {
    const harness = createHarness();
    registerReviewChangePublication(harness.pi as never, {
      prepare: async () => ({ ...identity, frozenScope: "scope" }),
      render: async () => ({ fragment: "<form>signed</form>" }),
    });

    await harness.input({ text: `Review change ${exactTarget}`, source: "interactive" });
    await harness.event("session_shutdown", {});

    await expect(harness.execute({ action: "scope" })).rejects.toThrow("not available");
  });

  test("does not activate inside the standalone CLI gate", () => {
    const harness = createHarness();
    const registered = registerReviewChangePublication(harness.pi as never, {
      environment: { REVIEW_CHANGE_GATE: "1" },
      prepare: async () => ({ ...identity, frozenScope: "unused" }),
      render: async () => ({ fragment: "<form>unused</form>" }),
    });

    expect({ registered, tools: harness.tools.size, handlers: harness.handlers.size }).toEqual({
      registered: false,
      tools: 0,
      handlers: 0,
    });
  });
});

test("pi installed defaults resolve gh without REVIEW_PUBLICATION_GH for preparation and rendering", async () => {
  const fixture = await createGitHubCliFixture();
  try {
    const harness = createHarness();
    registerInstalledReviewChangePublication(harness.pi as never, {
      environment: { PATH: fixture.root, REVIEW_PUBLICATION_GH: undefined },
      keyLoader: async () => Buffer.alloc(32, 7),
    });

    await harness.input({ text: `/skill:review-change ${exactTarget}`, source: "interactive" });
    const scope = await harness.execute({ action: "scope" });
    const rendered = await harness.execute({ action: "render", findings: [finding] });

    expect({
      scope: JSON.parse(scope.content[0].text),
      form: rendered.content[0].text.includes("<form"),
      calls: await fixture.calls(),
    }).toEqual({
      scope: identity,
      form: true,
      calls: ["api", "pr", "pr", "repo", "repo"],
    });
  } finally {
    await fixture.remove();
  }
});

test("the direct gh resolver rejects missing, relative, non-file, non-executable, and unsafe paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-gh-resolver-"));
  const directory = path.join(root, "directory");
  const nonExecutable = path.join(root, "non-executable");
  const unsafe = path.join(root, "unsafe");
  try {
    await mkdir(directory);
    await writeFile(nonExecutable, "#!/bin/sh\n");
    await writeFile(unsafe, "#!/bin/sh\n");
    await chmod(unsafe, 0o777);

    expect(() => resolveGitHubCliPath({ environment: { PATH: "" } })).toThrow("could not be resolved");
    expect(() => resolveGitHubCliPath({ candidate: "gh" })).toThrow("absolute executable path");
    expect(() => resolveGitHubCliPath({ candidate: directory })).toThrow("executable file");
    expect(() => resolveGitHubCliPath({ candidate: nonExecutable })).toThrow("executable file");
    expect(() => resolveGitHubCliPath({ candidate: unsafe })).toThrow("unsafe");
  } finally {
    await chmod(unsafe, 0o700).catch(() => {});
    await rm(root, { force: true, recursive: true });
  }
});

test("the standalone CLI parent still freezes its exact pull-request scope", async () => {
  const metadata = await createReviewPublicationMetadata({
    kind: "pull-request",
    target: exactTarget,
    pullRequestId: identity.pullRequest.id,
    immutableRange: `${baseOid}...${headOid}`,
  }, {
    details: {
      providerRepository: { id: identity.repository.id, owner: "Acme", repository: "Payments" },
    },
  }, {
    keyLoader: async () => Buffer.alloc(32, 7),
    randomBytes: () => Buffer.alloc(16, 9),
    signerPath: "/Users/reviewer/.local/bin/review-publication",
  });

  expect({
    repository: metadata?.repository,
    pullRequest: metadata?.pullRequest,
    scope: metadata?.scope,
    signerPath: metadata?.signerPath,
  }).toEqual({
    repository: identity.repository,
    pullRequest: identity.pullRequest,
    scope: identity.scope,
    signerPath: "/Users/reviewer/.local/bin/review-publication",
  });
});

test("the installation-owned signer rejects stale base or head claims", async () => {
  const key = Buffer.alloc(32, 7);
  const prepared = await prepareFrozenPublicationScope(exactTarget, {
    keyLoader: async () => key,
    randomBytes: () => Buffer.alloc(16, 9),
    provider: {
      preparePullRequest: async () => ({
        repository: identity.repository,
        pullRequest: identity.pullRequest,
        scope: identity.scope,
      }),
    },
  });

  const { frozenScope, ...preparedIdentity } = prepared;
  await expect(renderPublicationClaims({
    ...preparedIdentity,
    findings: [finding],
  }, {
    frozenScope,
    keyLoader: async () => key,
    provider: {
      getActor: async () => ({ id: "U_1", login: "reviewer" }),
      preparePullRequest: async () => ({
        repository: identity.repository,
        pullRequest: identity.pullRequest,
        scope: { baseOid, headOid: "c".repeat(40) },
      }),
    },
  })).rejects.toMatchObject({ code: "pull_request_scope_changed" });
});

test("extracts and validates the complete pull-request target token", () => {
  expect(requestedPullRequestTarget(`/skill:review-change ${exactTarget}/changes?diff=split#discussion`)).toBe(exactTarget);
  expect(requestedPullRequestTarget("Review change gh:Acme/Payments/pull/842")).toBe(exactTarget);
  expect(requestedPullRequestTarget("Review change https://github.com/Acme/Payments/tree/main")).toBeNull();
  expect(requestedPullRequestTarget(`Compare ${exactTarget} with https://github.com/Acme/Payments/pull/843`)).toBeNull();
  expect(requestedPullRequestTarget(`Review change ${exactTarget} gh:Acme/Payments/pull/842extra`)).toBeNull();
  for (const invalid of [
    "gh:Acme/Payments/pull/842/files",
    "gh:Acme/Payments/pull/842?diff=split",
    "gh:Acme/Payments/pull/842#discussion",
    "gh:Acme/Payments/pull/2147483648",
    "gh:Acme/Payments/pull/842extra",
    "gh:Acme/Payments/pull/842\u0000ignored",
    "gh:Acme/Payments/pull/842\nignored",
    "gh:Acme/Payments/pull/842\tignored",
  ]) {
    expect(requestedPullRequestTarget(`Review change ${invalid}`)).toBeNull();
  }
});

async function createGitHubCliFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "review-gh-default-"));
  const executable = path.join(root, "gh");
  const log = path.join(root, "calls");
  const script = `#!/bin/sh
printf '%s\\n' "$1" >> '${log}'
case "$1" in
  repo) printf '%s\\n' '${JSON.stringify(identity.repository)}' ;;
  pr) printf '%s\\n' '${JSON.stringify({
    ...identity.pullRequest,
    baseRefOid: baseOid,
    headRefOid: headOid,
  })}' ;;
  api) printf '%s\\n' '{"node_id":"U_1","login":"reviewer"}' ;;
  *) exit 2 ;;
esac
`;
  await writeFile(executable, script);
  await chmod(executable, 0o755);
  return {
    root,
    calls: async () => (await Bun.file(log).text()).trim().split("\n").sort(),
    remove: () => rm(root, { force: true, recursive: true }),
  };
}

function createHarness() {
  const handlers = new Map<string, (event: Record<string, unknown>, context: Record<string, unknown>) => unknown>();
  const tools = new Map<string, { execute: (...arguments_: any[]) => Promise<any> }>();
  const pi = {
    on(name: string, handler: (event: Record<string, unknown>, context: Record<string, unknown>) => unknown) {
      handlers.set(name, handler);
    },
    registerTool(tool: { name: string; execute: (...arguments_: any[]) => Promise<any> }) {
      tools.set(tool.name, tool);
    },
  };
  return {
    pi,
    handlers,
    tools,
    input: (event: Record<string, unknown>) => handlers.get("input")?.(event, { cwd: "/repo" }),
    toolCall: (event: Record<string, unknown>) => handlers.get("tool_call")?.(event, { cwd: "/repo" }),
    event: (name: string, event: Record<string, unknown>) => handlers.get(name)?.(event, { cwd: "/repo" }),
    execute: (params: Record<string, unknown>) => tools.get("review_change_publication")
      ?.execute("call-1", params, undefined, undefined, { cwd: "/repo" }),
  };
}
