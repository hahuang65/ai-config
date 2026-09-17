import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { createGitHubReviewPublisher } from "../../skills/review-change/runtime/review-publication-github.mjs";
import {
  createOperatingSystemConfirmation,
  createOperatingSystemPromptRunner,
} from "../../skills/review-change/runtime/review-publication-os-confirmation.mjs";
import { createConfirmationToken } from "../../skills/review-change/runtime/review-publication-protocol.mjs";
import { createGitHubProvider } from "../../skills/review-change/runtime/review-publication-provider.mjs";
import { createReviewPublicationServer } from "../../skills/review-change/runtime/review-publication-server.mjs";
import { currentPullRequest, derivePublication, publicationClaims } from "./review-publication-fixtures";

const servers: Array<{ close(): Promise<void> }> = [];
afterEach(async () => Promise.all(servers.splice(0).map((server) => server.close())));

describe("operating-system Review publication confirmation", () => {
  test("shows the exact plain-language publication identity immediately before the provider stage", async () => {
    const events: string[] = [];
    let shownPrompt = "";
    const response = await publishWithPrompt(async ({ prompt }: { prompt: string }) => {
      events.push("operating-system confirmation");
      shownPrompt = prompt;
      return { outcome: "approved" };
    }, events);

    expect({
      status: response.status,
      events,
      actor: shownPrompt.includes("GitHub actor: @reviewer (ID U_123)"),
      repository: shownPrompt.includes("Repository: acme/payments (ID R_456)"),
      pullRequest: shownPrompt.includes("Pull request: #842 (ID PR_789)"),
      base: shownPrompt.includes(`Base commit: ${"a".repeat(40)}`),
      head: shownPrompt.includes(`Head commit: ${"b".repeat(40)}`),
      count: shownPrompt.includes("Selected Findings: 1"),
      inline: shownPrompt.includes("Inline comments included: Yes"),
    }).toEqual({
      status: 201,
      events: ["provider validation", "operating-system confirmation", "provider publication"],
      actor: true,
      repository: true,
      pullRequest: true,
      base: true,
      head: true,
      count: true,
      inline: true,
    });
  });

  for (const scenario of [
    ["denied", "os_confirmation_denied", 403],
    ["dismissed", "os_confirmation_dismissed", 403],
    ["timeout", "os_confirmation_timeout", 504],
    ["unavailable", "os_confirmation_unavailable", 503],
    ["malformed", "os_confirmation_invalid_response", 502],
    ["failed", "os_confirmation_failed", 503],
  ] as const) {
    test(`${scenario[0]} confirmation fails closed without calling the provider`, async () => {
      const events: string[] = [];
      const response = await publishWithPrompt(async () => ({ outcome: scenario[0] }), events);
      const body = await response.text();

      expect({
        status: response.status,
        code: /data-publication-error="([^"]+)"/.exec(body)?.[1],
        noMutationMessage: body.includes("Nothing was posted"),
        events,
      }).toEqual({
        status: scenario[2],
        code: scenario[1],
        noMutationMessage: true,
        events: ["provider validation"],
      });
    });
  }

  test("an environment-supplied confirmation executable cannot authorize provider publication", async () => {
    const substitute = "/tmp/model-supplied-confirmation";
    const installed = process.platform === "darwin" ? "/usr/bin/osascript" : "/usr/bin/zenity";
    const previous = process.env.REVIEW_PUBLICATION_CONFIRMATION_EXECUTABLE;
    process.env.REVIEW_PUBLICATION_CONFIRMATION_EXECUTABLE = substitute;
    const invocations: string[] = [];
    try {
      const runner = createOperatingSystemPromptRunner({
        platform: process.platform === "darwin" ? "macos" : "linux",
        executable: installed,
        spawnProcess: (executable: string) => {
          invocations.push(executable);
          const child = fakePromptChild();
          queueMicrotask(() => child.complete(1, "", process.platform === "darwin" ? "User canceled (-128)" : ""));
          return child;
        },
      });
      const events: string[] = [];
      const response = await publishWithPrompt(runner, events);

      expect({ status: response.status, invocations, substituteUsed: invocations.includes(substitute), events }).toEqual({
        status: 403,
        invocations: [installed],
        substituteUsed: false,
        events: ["provider validation"],
      });
    } finally {
      if (previous === undefined) delete process.env.REVIEW_PUBLICATION_CONFIRMATION_EXECUTABLE;
      else process.env.REVIEW_PUBLICATION_CONFIRMATION_EXECUTABLE = previous;
    }
  });

  for (const scenario of [
    {
      name: "actor",
      code: "github_actor_changed",
      status: 403,
      actor: { node_id: "U_999", login: "other-reviewer" },
      headOid: "b".repeat(40),
    },
    {
      name: "head",
      code: "pull_request_scope_changed",
      status: 409,
      actor: { node_id: "U_123", login: "reviewer" },
      headOid: "c".repeat(40),
    },
  ] as const) {
    test(`rejects a matching existing review when the ${scenario.name} changes during operating-system confirmation`, async () => {
      const key = Buffer.alloc(32, 8);
      const claims = publicationClaims();
      const publication = derivePublication(claims);
      const expectedRequest = await captureReviewRequest(publication);
      let changedDuringConfirmation = false;
      let mutations = 0;
      const provider = createGitHubProvider({
        execute: async (args: string[]) => {
          const endpoint = String(args.at(-1));
          if (args.join(" ") === "api user") {
            const actor = changedDuringConfirmation
              ? scenario.actor
              : { node_id: claims.actor.id, login: claims.actor.login };
            return JSON.stringify(actor);
          }
          if (args[0] === "repo") return JSON.stringify(claims.repository);
          if (args[0] === "pr") return JSON.stringify({
            id: claims.pullRequest.id,
            number: claims.pullRequest.number,
            state: "OPEN",
            baseRefOid: claims.scope.baseOid,
            headRefOid: changedDuringConfirmation ? scenario.headOid : claims.scope.headOid,
          });
          if (endpoint.includes("/files?")) return JSON.stringify([[
            { filename: claims.findings[0].path, patch: "@@ -84,1 +84,1 @@\n-old\n+new" },
          ]]);
          if (endpoint.endsWith("/comments")) return JSON.stringify([expectedRequest.comments]);
          if (endpoint.endsWith("/reviews")) return JSON.stringify([[providerReview(expectedRequest, claims)]]);
          if (args.includes("POST")) mutations += 1;
          throw new Error(`Unexpected provider request: ${args.join(" ")}`);
        },
      });
      const server = await createReviewPublicationServer({
        key,
        ...provider,
        confirmPublication: async () => { changedDuringConfirmation = true; },
      });
      servers.push(server);
      const token = createConfirmationToken({ claims, selectedFindingIds: ["RC-001"] }, { key });

      const response = await fetch(`${server.url}/api/v1/review-publications`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ confirmation_token: token }),
      });
      const body = await response.text();

      expect({
        status: response.status,
        code: /data-publication-error="([^"]+)"/.exec(body)?.[1],
        mutations,
      }).toEqual({ status: scenario.status, code: scenario.code, mutations: 0 });
    });
  }

  test("rejects an approval response supplied through the HTTP request", async () => {
    const key = Buffer.alloc(32, 4);
    const claims = publicationClaims();
    let prompts = 0;
    let publications = 0;
    const server = await createReviewPublicationServer({
      key,
      inspectPullRequest: async () => currentPullRequest(claims),
      confirmPublication: async () => { prompts += 1; },
      publishReview: async () => { publications += 1; },
    });
    servers.push(server);
    const token = createConfirmationToken({ claims, selectedFindingIds: ["RC-001"] }, { key });

    const response = await fetch(`${server.url}/api/v1/review-publications`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ confirmation_token: token, approval: "Post review" }),
    });

    expect({ status: response.status, prompts, publications }).toEqual({
      status: 422,
      prompts: 0,
      publications: 0,
    });
  });

  test("cancellation terminates and settles the prompt process before the browser response", async () => {
    const child = fakePromptChild();
    const controller = new AbortController();
    const runner = createOperatingSystemPromptRunner({
      platform: "linux",
      executable: "/usr/bin/zenity",
      spawnProcess: () => child,
      timeoutMs: 1_000,
      terminationGraceMs: 5,
    });
    const confirmation = createOperatingSystemConfirmation({ promptRunner: runner });
    const request = confirmation(publicationClaims(), selectedReview(), { signal: controller.signal });
    controller.abort();

    await expect(request).rejects.toMatchObject({ code: "request_timeout" });
    expect({
      signals: child.signals,
      outputSettled: child.stdout.destroyed && child.stderr.destroyed,
    }).toEqual({
      signals: ["SIGTERM", "SIGKILL"],
      outputSettled: true,
    });
  });

  test("classifies denied, dismissed, timed out, unavailable, malformed, and failed prompt processes", async () => {
    const scenarios = [
      { platform: "macos", status: 1, stderr: "execution error: User canceled. (-128)", outcome: "denied" },
      { platform: "linux", status: null, processSignal: "SIGTERM", outcome: "dismissed" },
      { platform: "linux", status: 5, outcome: "timeout" },
      { platform: "linux", status: 0, stdout: "unexpected", outcome: "malformed" },
      { platform: "linux", status: 2, outcome: "failed" },
    ] as const;
    for (const scenario of scenarios) {
      const child = fakePromptChild();
      const runner = createOperatingSystemPromptRunner({
        platform: scenario.platform,
        executable: scenario.platform === "macos" ? "/usr/bin/osascript" : "/usr/bin/zenity",
        spawnProcess: () => {
          queueMicrotask(() => child.complete(
            scenario.status,
            scenario.stdout,
            scenario.stderr,
            scenario.processSignal,
          ));
          return child;
        },
      });
      await expect(runner({ prompt: "Review", signal: new AbortController().signal })).resolves.toEqual({
        outcome: scenario.outcome,
      });
    }
    const unavailable = createOperatingSystemPromptRunner({
      platform: "linux",
      executable: "/usr/bin/zenity",
      spawnProcess: () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
    });
    await expect(unavailable({ prompt: "Review", signal: new AbortController().signal })).resolves.toEqual({
      outcome: "unavailable",
    });
  });

  test("uses fixed absolute executables, argument arrays, bounded prompts, and no shell", async () => {
    const invocations: any[] = [];
    for (const platform of ["macos", "linux"] as const) {
      const child = fakePromptChild();
      const executable = platform === "macos" ? "/usr/bin/osascript" : "/usr/bin/zenity";
      const runner = createOperatingSystemPromptRunner({
        platform,
        executable,
        spawnProcess: (...arguments_: any[]) => {
          invocations.push(arguments_);
          queueMicrotask(() => child.complete(0, platform === "macos" ? "button returned:Post review\n" : ""));
          return child;
        },
      });
      expect(await runner({ prompt: "Post the exact review?", signal: new AbortController().signal })).toEqual({ outcome: "approved" });
    }

    expect(invocations.map(([executable, args, options]) => ({
      executable,
      argumentArray: Array.isArray(args),
      bounded: args.some((argument: string) => argument.includes("60")),
      shell: options.shell,
    }))).toEqual([
      { executable: "/usr/bin/osascript", argumentArray: true, bounded: true, shell: false },
      { executable: "/usr/bin/zenity", argumentArray: true, bounded: true, shell: false },
    ]);
  });
});

async function publishWithPrompt(promptRunner: any, events: string[]) {
  const key = Buffer.alloc(32, 4);
  const claims = publicationClaims();
  const server = await createReviewPublicationServer({
    key,
    inspectPullRequest: async () => {
      events.push("provider validation");
      return currentPullRequest(claims);
    },
    confirmPublication: createOperatingSystemConfirmation({ promptRunner }),
    publishReview: async () => {
      events.push("provider publication");
      return {
        reviewId: 194205,
        url: "https://github.com/acme/payments/pull/842#pullrequestreview-194205",
      };
    },
  });
  servers.push(server);
  const token = createConfirmationToken({ claims, selectedFindingIds: ["RC-001"] }, { key });
  return fetch(`${server.url}/api/v1/review-publications`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ confirmation_token: token }),
  });
}

async function captureReviewRequest(publication: ReturnType<typeof derivePublication>) {
  let captured: any;
  const publisher = createGitHubReviewPublisher({
    listReviews: async () => [],
    createReview: async (request: any) => {
      captured = request;
      return { reviewId: 1, url: "review-1" };
    },
  });
  await publisher.reconcileOrPublish(publication);
  return captured;
}

function providerReview(request: any, claims: ReturnType<typeof publicationClaims>) {
  return {
    id: 194205,
    html_url: "https://github.com/acme/payments/pull/842#pullrequestreview-194205",
    body: request.body,
    commit_id: request.commitId,
    state: "COMMENTED",
    user: { node_id: claims.actor.id },
  };
}

function selectedReview() {
  const claims = publicationClaims();
  return {
    findings: claims.findings,
    generalComment: "Review found 1 issue worth addressing:\n\n- Retry can create duplicate exports",
  };
}

function fakePromptChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    signals: string[];
    settled: boolean;
    kill(signal: string): boolean;
    unref(): void;
    complete(status: number | null, stdout?: string, stderr?: string, processSignal?: string | null): void;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.signals = [];
  child.settled = false;
  child.kill = (signal) => { child.signals.push(signal); return true; };
  child.unref = () => {};
  child.complete = (status, stdout = "", stderr = "", processSignal = null) => {
    if (stdout) child.stdout.write(stdout);
    if (stderr) child.stderr.write(stderr);
    child.settled = true;
    child.emit("close", status, processSignal);
  };
  return child;
}
