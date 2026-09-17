import { expect, test } from "bun:test";

import { CLAUDE_PUBLICATION_HOOK_MARGIN_MS } from "../harnesses/claude/hooks/review-change-publication.ts";
import {
  prepareFrozenPublicationScope,
  RENDER_PUBLICATION_PROVIDER_ROUNDS,
  renderPublicationClaims,
} from "../skills/review-change/runtime/review-publication-boundary.mjs";
import { DEFAULT_PROVIDER_TIMEOUT_MS } from "../skills/review-change/runtime/review-publication-provider.mjs";

const exactTarget = "https://github.com/Acme/Payments/pull/842";
const identity = {
  host: "github.com",
  signingKeyId: "review-publication-v1",
  commentTemplateVersion: 1,
  repository: { id: "R_456", nameWithOwner: "Acme/Payments" },
  pullRequest: { id: "PR_789", number: 842, url: exactTarget },
  scope: { baseOid: "a".repeat(40), headOid: "b".repeat(40) },
};
const finding = {
  id: "RPC-068",
  title: "Bound the rendering hook",
  body: "Keep the hook timeout above the complete provider budget.",
  path: "runtime/review-publication-boundary.mjs",
  line: 1,
  side: "RIGHT",
};

test("starts independent actor and pull-request reads in the same provider round", async () => {
  const key = Buffer.alloc(32, 7);
  const prepared = await prepareFrozenPublicationScope(exactTarget, {
    keyLoader: async () => key,
    provider: { preparePullRequest: async () => identity },
  });
  const bothStarted = deferred();
  const operations: string[] = [];
  let overlapped = false;
  const noteStarted = (operation: string) => {
    operations.push(operation);
    if (operations.length === 2) {
      overlapped = true;
      bothStarted.resolve();
    }
  };

  await renderPublicationClaims({ ...identity, findings: [finding] }, {
    frozenScope: prepared.frozenScope,
    keyLoader: async () => key,
    provider: {
      getActor: async () => {
        noteStarted("actor");
        await Promise.race([bothStarted.promise, Bun.sleep(30)]);
        return { id: "U_1", login: "reviewer" };
      },
      preparePullRequest: async () => {
        noteStarted("pull-request");
        bothStarted.resolve();
        return identity;
      },
    },
  });

  expect({ operations, overlapped }).toEqual({ operations: ["actor", "pull-request"], overlapped: true });
});

test("Claude rendering timeout covers the complete provider budget plus hook margin", async () => {
  const settings = JSON.parse(await Bun.file(new URL("../harnesses/claude/settings.json", import.meta.url)).text());
  const publicationHook = settings.hooks.PreToolUse
    .flatMap((entry: any) => entry.hooks)
    .find((hook: any) => hook.command === "bun ~/.claude/hooks/review-change-publication.ts");
  const runtimeWorstCaseMs = DEFAULT_PROVIDER_TIMEOUT_MS * RENDER_PUBLICATION_PROVIDER_ROUNDS;

  expect(publicationHook.timeout * 1_000).toBeGreaterThanOrEqual(
    runtimeWorstCaseMs + CLAUDE_PUBLICATION_HOOK_MARGIN_MS,
  );
});

function deferred() {
  let resolvePromise!: () => void;
  return {
    promise: new Promise<void>((resolve) => { resolvePromise = resolve; }),
    resolve: () => resolvePromise(),
  };
}
