import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import {
  handleInetdRequest,
  relayInetdRequest,
} from "../../skills/review-change/runtime/review-publication-inetd.mjs";
import { createConfirmationToken } from "../../skills/review-change/runtime/review-publication-protocol.mjs";
import { createGitHubReviewPublisher } from "../../skills/review-change/runtime/review-publication-github.mjs";
import { createGitHubProvider } from "../../skills/review-change/runtime/review-publication-provider.mjs";
import { createReviewPublicationServer } from "../../skills/review-change/runtime/review-publication-server.mjs";
import { withPublisherLock } from "../../skills/review-change/runtime/review-publication-state.mjs";
import { derivePublication, publicationClaims } from "./review-publication-fixtures";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("Review publication request cancellation", () => {
  test("relays the socket Host header to the bounded local server", async () => {
    let observedHost = "";
    const server = http.createServer((request, response) => {
      observedHost = request.headers.host ?? "";
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("relayed");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind a TCP port");
    try {
      const response = await relayInetdRequest(`http://127.0.0.1:${address.port}`, {
        method: "POST",
        path: "/api/v1/review-publication-confirmations",
        headers: { "content-type": "application/x-www-form-urlencoded", host: "127.0.0.1:59321" },
        body: "publication_token=fixture",
      });

      expect({ observedHost, response: { body: response.body, status: response.status } }).toEqual({
        observedHost: "127.0.0.1:59321",
        response: { body: "relayed", status: 200 },
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  test("times out stalled socket input without dispatching work", async () => {
    const input = new PassThrough();
    const output = responseStream();
    let dispatches = 0;

    await handleInetdRequest({
      input,
      output,
      requestTimeoutMs: 5,
      dispatch: async () => {
        dispatches += 1;
        throw new Error("Stalled input must not dispatch");
      },
    });

    expect({ dispatches, response: output.text() }).toEqual({
      dispatches: 0,
      response: expect.stringContaining("The publication request took too long."),
    });
  });

  test("cancels and settles a GitHub subprocess before returning", async () => {
    const child = nonClosingChild();
    const provider = createGitHubProvider({
      ghPath: process.execPath,
      spawnProcess: () => child,
      timeoutMs: 1_000,
      terminationGraceMs: 5,
    });
    const controller = new AbortController();
    const request = provider.getActor({ signal: controller.signal });

    controller.abort();

    await expect(request).rejects.toMatchObject({ code: "request_timeout", ambiguous: false });
    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
    child.stdout.destroy();
    child.stderr.destroy();
  });

  test("cancels a possible create-review subprocess and returns an unknown outcome", async () => {
    const claims = publicationClaims();
    const controller = new AbortController();
    const started = deferred();
    let mutationChild: ReturnType<typeof nonClosingChild> | undefined;
    const provider = createGitHubProvider({
      ghPath: process.execPath,
      spawnProcess: (_executable, args) => {
        if (args.includes("POST")) {
          mutationChild = nonClosingChild();
          return mutationChild;
        }
        return closingChild(providerResponse(args, claims));
      },
      timeoutMs: 1_000,
      terminationGraceMs: 5,
    });
    const publication = provider.publishReview(derivePublication(claims), {
      signal: controller.signal,
      markMutationStarted: started.resolve,
    });
    await started.promise;

    controller.abort();

    await expect(publication).rejects.toMatchObject({ code: "publication_outcome_unknown" });
    expect(mutationChild?.signals).toEqual(["SIGTERM", "SIGKILL"]);
    mutationChild?.stdout.destroy();
    mutationChild?.stderr.destroy();
  });

  test("cancellation before mutation reports that nothing was posted", async () => {
    let mutationStarted = false;
    const response = await runPublicationRequest({
      inspectPullRequest: async (_claims: unknown, _findings: unknown, context: any) => {
        await aborted(context.signal);
        throw requestTimeout();
      },
      publishReview: async () => {
        mutationStarted = true;
        throw new Error("Publication must not start");
      },
    });

    expect({ mutationStarted, response }).toEqual({
      mutationStarted: false,
      response: expect.stringContaining("No comments were posted"),
    });
  });

  test("accepted socket close and error events settle the prompt before worker completion", async () => {
    const events = [
      { stream: "input", event: "close" },
      { stream: "input", event: "error" },
      { stream: "output", event: "close" },
      { stream: "output", event: "error" },
    ] as const;
    let promptsSettled = 0;
    let providerMutations = 0;

    for (const fixture of events) {
      const promptStarted = deferred();
      await runPublicationRequest({
        requestTimeoutMs: 1_000,
        confirmPublication: async (_claims: unknown, _review: unknown, context: any) => {
          promptStarted.resolve();
          await aborted(context.signal);
          await Bun.sleep(5);
          promptsSettled += 1;
          throw requestTimeout();
        },
        publishReview: async () => {
          providerMutations += 1;
          throw new Error("Publication must not start after disconnect");
        },
        interrupt: async ({ input, output }) => {
          await promptStarted.promise;
          const stream = fixture.stream === "input" ? input : output;
          if (fixture.event === "error") stream.emit("error", new Error("client disconnected"));
          else stream.emit("close");
        },
      });
    }

    expect({ promptsSettled, providerMutations }).toEqual({ promptsSettled: 4, providerMutations: 0 });
  });

  test("maximum lock wait and a deadline-ambiguous create reconcile before response and lock cleanup", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "review-publication-lifetime-path-"));
    temporaryRoots.push(home);
    const claims = publicationClaims();
    const firstAcquired = deferred();
    const releaseFirst = deferred();
    const firstLock = withPublisherLock(claims, async () => {
      firstAcquired.resolve();
      await releaseFirst.promise;
    }, { home });
    await firstAcquired.promise;

    let now = 0;
    let listCalls = 0;
    let requestSignal: AbortSignal | undefined;
    let reconciliationUsedFreshDeadline = false;
    let responseCompleted = false;
    let expectedReview: Record<string, unknown> | undefined;
    const publisher = createGitHubReviewPublisher({
      listReviews: async (_scope: unknown, context: any) => {
        listCalls += 1;
        if (listCalls === 1) return [];
        reconciliationUsedFreshDeadline = context.signal !== requestSignal && !context.signal.aborted;
        return [expectedReview];
      },
      validateScope: async () => {},
      createReview: async (request: any, context: any) => {
        context.markMutationStarted();
        expectedReview = {
          actorId: claims.actor.id,
          commitId: request.commitId,
          state: "COMMENTED",
          body: request.body,
          comments: request.comments,
          reviewId: 901,
          url: `${claims.pullRequest.url}#pullrequestreview-901`,
        };
        await aborted(context.signal);
        throw Object.assign(new Error("ambiguous create at request deadline"), { ambiguous: true });
      },
    });

    const response = await runPublicationRequest({
      home,
      requestTimeoutMs: 20,
      lockOptions: {
        now: () => now,
        pollIntervalMs: 5,
        waitTimeoutMs: 10,
        sleep: async (duration: number) => {
          now += duration;
          if (now === 10) {
            releaseFirst.resolve();
            await firstLock;
          }
        },
      },
      publishReview: async (publication: any, context: any) => {
        requestSignal = context.signal;
        const outcome = await publisher.reconcileOrPublish(publication, context);
        return { ...outcome };
      },
      onResponseEnd: () => { responseCompleted = true; },
    });
    const stateEntries = await readdir(path.join(home, ".review-publication"));

    expect({
      waited: now,
      listCalls,
      reconciliationUsedFreshDeadline,
      responseCompleted,
      stateEntries,
      response,
    }).toEqual({
      waited: 10,
      listCalls: 2,
      reconciliationUsedFreshDeadline: true,
      responseCompleted: true,
      stateEntries: [],
      response: expect.stringContaining("may have been posted"),
    });
  });

  test("a disconnect during a possible mutation releases the lock before the unknown outcome response", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "review-publication-cancel-lock-"));
    temporaryRoots.push(home);
    const mutationStarted = deferred();
    let mutationSettled = false;
    let settledWhenResponseEnded = false;
    const response = await runPublicationRequest({
      home,
      requestTimeoutMs: 1_000,
      publishReview: async (_publication: unknown, context: any) => {
        context.markMutationStarted();
        mutationStarted.resolve();
        await aborted(context.signal);
        await Bun.sleep(10);
        mutationSettled = true;
        throw Object.assign(new Error("Unknown publication outcome"), {
          code: "publication_outcome_unknown",
          status: 502,
        });
      },
      interrupt: async ({ output }) => {
        await mutationStarted.promise;
        output.emit("close");
      },
      onResponseEnd: () => { settledWhenResponseEnded = mutationSettled; },
    });
    const stateEntries = await readdir(path.join(home, ".review-publication"));

    expect({ mutationSettled, settledWhenResponseEnded, stateEntries, response }).toEqual({
      mutationSettled: true,
      settledWhenResponseEnded: true,
      stateEntries: [],
      response: expect.stringMatching(/may have been posted[\s\S]*marker reconciliation/i),
    });
  });
});

async function runPublicationRequest({
  home,
  inspectPullRequest = async (claims: any) => ({
    actor: claims.actor,
    repository: claims.repository,
    pullRequest: { ...claims.pullRequest, state: "OPEN" },
    scope: claims.scope,
  }),
  publishReview,
  confirmPublication = async () => {},
  interrupt,
  onResponseEnd = () => {},
  requestTimeoutMs = 15,
  lockOptions = {},
}: {
  home?: string;
  inspectPullRequest?: (...arguments_: any[]) => Promise<any>;
  publishReview: (...arguments_: any[]) => Promise<any>;
  confirmPublication?: (...arguments_: any[]) => Promise<any>;
  interrupt?: (streams: { input: PassThrough; output: PassThrough }) => Promise<void>;
  onResponseEnd?: () => void;
  requestTimeoutMs?: number;
  lockOptions?: Record<string, unknown>;
}) {
  const stateHome = home ?? await mkdtemp(path.join(tmpdir(), "review-publication-cancel-state-"));
  if (!home) temporaryRoots.push(stateHome);
  const key = Buffer.alloc(32, 4);
  const claims = publicationClaims();
  const confirmationToken = createConfirmationToken({
    claims,
    selectedFindingIds: claims.findings.map((finding) => finding.id),
  }, { key });
  const body = new URLSearchParams({ confirmation_token: confirmationToken }).toString();
  const input = new PassThrough();
  input.write([
    "POST /api/v1/review-publications HTTP/1.1",
    "Host: 127.0.0.1:4392",
    "Content-Type: application/x-www-form-urlencoded",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "",
    body,
  ].join("\r\n"));
  const output = responseStream(onResponseEnd);

  const handling = handleInetdRequest({
    input,
    output,
    requestTimeoutMs,
    dispatch: async (request: any, context: any) => {
      const server = await createReviewPublicationServer({
        key,
        inspectPullRequest,
        publishReview,
        confirmPublication,
        requestContext: context,
        withPublicationLock: (identity: any, task: () => Promise<unknown>, lockContext: any) => (
          withPublisherLock(identity, task, { ...lockOptions, home: stateHome, signal: lockContext.signal })
        ),
        expectedHost: "127.0.0.1:4392",
      });
      try {
        const response = await fetch(`${server.url}${request.path}`, {
          method: request.method,
          headers: {
            "content-type": request.headers["content-type"],
            host: request.headers.host,
          },
          body: request.body,
          signal: context.signal,
        });
        return {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: await response.text(),
        };
      } finally {
        await server.close();
      }
    },
  });
  await interrupt?.({ input, output });
  await handling;
  input.destroy();
  return output.text();
}

function responseStream(onEnd = () => {}) {
  const stream = new PassThrough() as PassThrough & { chunks: Buffer[]; text(): string };
  stream.chunks = [];
  stream.on("data", (chunk) => stream.chunks.push(chunk));
  stream.on("end", onEnd);
  stream.text = () => Buffer.concat(stream.chunks).toString("utf8");
  return stream;
}

function aborted(signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

function requestTimeout() {
  return Object.assign(new Error("Request timed out"), { code: "request_timeout", status: 504 });
}

function providerResponse(args: string[], claims: ReturnType<typeof publicationClaims>) {
  const endpoint = String(args.at(-1));
  if (endpoint.endsWith("/reviews")) return JSON.stringify([[]]);
  if (args.join(" ") === "api user") return JSON.stringify({ node_id: claims.actor.id, login: claims.actor.login });
  if (args[0] === "repo") return JSON.stringify(claims.repository);
  if (args[0] === "pr") return JSON.stringify({
    id: claims.pullRequest.id,
    number: claims.pullRequest.number,
    state: "OPEN",
    baseRefOid: claims.scope.baseOid,
    headRefOid: claims.scope.headOid,
  });
  throw new Error(`Unexpected provider request: ${args.join(" ")}`);
}

function closingChild(output: string) {
  const child = nonClosingChild();
  queueMicrotask(() => {
    child.stdout.write(output);
    child.emit("close", 0);
  });
  return child;
}

function deferred() {
  let resolvePromise!: () => void;
  return {
    promise: new Promise<void>((resolve) => { resolvePromise = resolve; }),
    resolve: () => resolvePromise(),
  };
}

function nonClosingChild() {
  const events = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    signals: string[];
    kill(signal: string): boolean;
    unref(): void;
  };
  events.stdin = new PassThrough();
  events.stdout = new PassThrough();
  events.stderr = new PassThrough();
  events.signals = [];
  events.kill = (signal: string) => { events.signals.push(signal); return true; };
  events.unref = () => {};
  return events;
}
