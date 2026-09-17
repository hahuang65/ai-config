import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { createGitHubReviewPublisher } from "../../skills/review-change/runtime/review-publication-github.mjs";
import { handleInetdRequest } from "../../skills/review-change/runtime/review-publication-inetd.mjs";
import { createGitHubProvider } from "../../skills/review-change/runtime/review-publication-provider.mjs";
import { createReviewPublicationServer } from "../../skills/review-change/runtime/review-publication-server.mjs";
import { signTestPublicationClaims as createPublicationToken } from "./review-publication-fixtures";

const servers: Array<{ close(): Promise<void> }> = [];
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("Review publication repair boundaries", () => {
  test("the inetd bridge emits only approved end-to-end headers with fresh framing", async () => {
    const server = await createReviewPublicationServer({
      key: Buffer.alloc(32, 1),
      inspectPullRequest: async () => { throw new Error("unexpected inspection"); },
      publishReview: async () => { throw new Error("unexpected publication"); },
    });
    servers.push(server);
    const input = new PassThrough();
    const output = new PassThrough();
    const responseChunks: Buffer[] = [];
    output.on("data", (chunk) => responseChunks.push(chunk));
    input.end([
      "POST /api/v1/review-publication-confirmations HTTP/1.1",
      "Host: 127.0.0.1:4392",
      "Content-Type: application/x-www-form-urlencoded",
      "Content-Length: 19",
      "",
      "publication_token=x",
    ].join("\r\n"));

    await handleInetdRequest({
      input,
      output,
      dispatch: async (request: any) => {
        const response = await fetch(`${server.url}${request.path}`, {
          method: request.method,
          headers: {
            "content-type": request.headers["content-type"],
            host: request.headers.host,
          },
          body: request.body,
        });
        return {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: await response.text(),
        };
      },
    });

    const rawResponse = Buffer.concat(responseChunks).toString("utf8");
    const [head, body] = rawResponse.split("\r\n\r\n");
    const headers = Object.fromEntries(head.split("\r\n").slice(1).map((line) => {
      const separator = line.indexOf(":");
      return [line.slice(0, separator).toLowerCase(), line.slice(separator + 1).trim()];
    }));
    expect({
      names: Object.keys(headers).sort(),
      connection: headers.connection,
      contentLength: headers["content-length"],
    }).toEqual({
      names: [
        "cache-control",
        "connection",
        "content-length",
        "content-security-policy",
        "content-type",
        "referrer-policy",
        "x-frame-options",
      ],
      connection: "close",
      contentLength: String(Buffer.byteLength(body)),
    });
  });

  test("an invalid excluded Finding does not block confirmation or publication", async () => {
    const claims = publicationClaims();
    claims.findings.push(finding("RC-002", 999));
    const { provider, mutationCount } = providerForDiff(claims, 84);
    const server = await createReviewPublicationServer({
      key: Buffer.alloc(32, 2),
      ...provider,
      confirmPublication: async () => {},
    });
    servers.push(server);

    const confirmation = await confirm(server.url, claims, Buffer.alloc(32, 2), "RC-001");
    const confirmationBody = await confirmation.text();
    const publication = await publish(server.url, confirmationToken(confirmationBody));

    expect({
      confirmationStatus: confirmation.status,
      publicationStatus: publication.status,
      mutations: mutationCount(),
    }).toEqual({ confirmationStatus: 200, publicationStatus: 201, mutations: 1 });
  });

  test("an invalid selected Finding blocks the complete review", async () => {
    const claims = publicationClaims();
    claims.findings.push(finding("RC-002", 999));
    const { provider, mutationCount } = providerForDiff(claims, 84);
    const server = await createReviewPublicationServer({ key: Buffer.alloc(32, 3), ...provider });
    servers.push(server);

    const response = await confirm(server.url, claims, Buffer.alloc(32, 3), "RC-001", "RC-002");
    const body = await response.text();

    expect({
      status: response.status,
      error: /data-publication-error="([^"]+)"/.exec(body)?.[1],
      mutations: mutationCount(),
    }).toEqual({ status: 409, error: "invalid_inline_location", mutations: 0 });
  });

  test("a selected Finding that becomes invalid blocks publication of the complete review", async () => {
    const claims = publicationClaims();
    const key = Buffer.alloc(32, 4);
    const { provider, mutationCount } = providerForDiff(claims, [84, 999]);
    const server = await createReviewPublicationServer({ key, ...provider });
    servers.push(server);
    const confirmation = await confirm(server.url, claims, key, "RC-001");
    const confirmationBody = await confirmation.text();

    const response = await publish(server.url, confirmationToken(confirmationBody));
    const body = await response.text();

    expect({
      status: response.status,
      error: /data-publication-error="([^"]+)"/.exec(body)?.[1],
      mutations: mutationCount(),
    }).toEqual({ status: 409, error: "invalid_inline_location", mutations: 0 });
  });

  test("uses the configured absolute gh executable without PATH resolution", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-provider-path-"));
    temporaryRoots.push(root);
    const gh = path.join(root, "gh");
    await writeFile(gh, "#!/bin/sh\nprintf '%s\\n' '{\"node_id\":\"U_123\",\"login\":\"reviewer\"}'\n");
    await chmod(gh, 0o755);
    const provider = createGitHubProvider({ ghPath: gh, environment: { PATH: "" } });

    expect(await provider.getActor()).toEqual({ id: "U_123", login: "reviewer" });
    expect(() => createGitHubProvider({ ghPath: "gh" })).toThrow("absolute executable");
  });

  test("shows a safe GitHub response error when a successful read contains malformed JSON", async () => {
    const claims = publicationClaims();
    const key = Buffer.alloc(32, 7);
    let mutations = 0;
    const provider = createGitHubProvider({
      execute: async (args: string[]) => {
        if (args.join(" ") === "api user") return "not json";
        if (args[0] === "repo") return JSON.stringify(claims.repository);
        if (args[0] === "pr") return JSON.stringify({
          id: claims.pullRequest.id,
          number: claims.pullRequest.number,
          state: "OPEN",
          baseRefOid: claims.scope.baseOid,
          headRefOid: claims.scope.headOid,
        });
        if (args.includes("POST")) mutations += 1;
        throw new Error(`Unexpected provider request: ${args.join(" ")}`);
      },
    });
    const server = await createReviewPublicationServer({ key, ...provider });
    servers.push(server);

    const response = await confirm(server.url, claims, key, "RC-001");
    const body = await response.text();

    expect({
      status: response.status,
      error: /data-publication-error="([^"]+)"/.exec(body)?.[1],
      plainFailure: body.includes("GitHub returned an unreadable response."),
      safeAction: body.includes("Check GitHub status, then run Review change again."),
      rawResponseHidden: !body.includes("not json"),
      mutations,
    }).toEqual({
      status: 502,
      error: "provider_invalid_response",
      plainFailure: true,
      safeAction: true,
      rawResponseHidden: true,
      mutations: 0,
    });
  });

  test("reconciles an accepted mutation when the create-review response is malformed JSON", async () => {
    const { provider, listCount, mutationCount } = providerWithMutationResponse("not json");

    await expect(provider.publishReview(derivePublication(publicationClaims()))).rejects.toMatchObject({
      code: "publication_outcome_unknown",
      status: 502,
    });
    expect({ lists: listCount(), mutations: mutationCount() }).toEqual({ lists: 2, mutations: 1 });
  });

  test("reconciles an accepted mutation when the create-review response has no identity", async () => {
    const { provider, listCount, mutationCount } = providerWithMutationResponse(JSON.stringify({ html_url: "https://github.com/acme/payments/pull/842" }));

    await expect(provider.publishReview(derivePublication(publicationClaims()))).rejects.toMatchObject({
      code: "publication_outcome_unknown",
      status: 502,
    });
    expect({ lists: listCount(), mutations: mutationCount() }).toEqual({ lists: 2, mutations: 1 });
  });

  test("reports an unknown outcome when post-mutation reconciliation fails", async () => {
    let listCount = 0;
    const publisher = createGitHubReviewPublisher({
      listReviews: async () => {
        listCount += 1;
        if (listCount === 1) return [];
        throw Object.assign(new Error("reconciliation unavailable"), { code: "provider_timeout", status: 504 });
      },
      createReview: async () => {
        throw Object.assign(new Error("ambiguous mutation"), { ambiguous: true });
      },
    });

    await expect(publisher.reconcileOrPublish(derivePublication(publicationClaims()))).rejects.toMatchObject({
      code: "publication_outcome_unknown",
      status: 502,
    });
  });

  test("force-settles timed-out and over-limit provider processes that never close", async () => {
    for (const failure of ["timeout", "output-limit"] as const) {
      const child = nonClosingChild();
      const provider = createGitHubProvider({
        ghPath: process.execPath,
        spawnProcess: () => child,
        timeoutMs: failure === "timeout" ? 5 : 1_000,
        outputLimit: failure === "output-limit" ? 1 : 1_000,
        terminationGraceMs: 5,
      });
      const request = provider.getActor();
      if (failure === "output-limit") child.stdout.write("too much output");

      await expect(request).rejects.toMatchObject({
        code: failure === "timeout" ? "provider_timeout" : "provider_output_limit",
      });
      expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
      child.stdout.destroy();
      child.stderr.destroy();
    }
  });

  test("maps invalid-line provider rejection to the inline-location conflict", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-provider-invalid-line-"));
    temporaryRoots.push(root);
    const gh = path.join(root, "gh");
    await writeFile(gh, "#!/bin/sh\nprintf '%s\\n' 'validation failed: invalid line' >&2\nexit 1\n");
    await chmod(gh, 0o755);
    const provider = createGitHubProvider({ ghPath: gh });

    await expect(provider.getActor()).rejects.toMatchObject({ code: "invalid_inline_location", status: 409 });
  });
});

function publicationClaims() {
  return {
    reportId: "08".repeat(16),
    host: "github.com",
    signingKeyId: "review-publication-v1",
    commentTemplateVersion: 1,
    actor: { id: "U_123", login: "reviewer" },
    repository: { id: "R_456", nameWithOwner: "acme/payments" },
    pullRequest: { id: "PR_789", number: 842, url: "https://github.com/acme/payments/pull/842" },
    scope: { baseOid: "a".repeat(40), headOid: "b".repeat(40) },
    findings: [finding("RC-001", 84)],
  };
}

function finding(id: string, line: number) {
  return {
    id,
    title: `Finding ${id}`,
    body: `Repair ${id}.`,
    path: "src/export/export-runner.ts",
    line,
    side: "RIGHT",
  };
}

function providerForDiff(claims: ReturnType<typeof publicationClaims>, validLines: number | number[]) {
  let fileInspectionCount = 0;
  let inspectedLine = 0;
  let mutations = 0;
  const execute = async (args: string[]) => {
    if (args.join(" ") === "api user") return JSON.stringify({ node_id: "U_123", login: "reviewer" });
    if (args[0] === "repo") return JSON.stringify(claims.repository);
    if (args[0] === "pr") return JSON.stringify({ id: claims.pullRequest.id, number: claims.pullRequest.number, state: "OPEN", baseRefOid: claims.scope.baseOid, headRefOid: claims.scope.headOid });
    if (String(args.at(-1)).includes("/files?")) {
      const lines = Array.isArray(validLines) ? validLines : [validLines];
      const line = lines[Math.min(fileInspectionCount, lines.length - 1)];
      fileInspectionCount += 1;
      inspectedLine = line;
      return JSON.stringify([[{ filename: claims.findings[0].path, patch: `@@ -${line},1 +${line},1 @@\n-old\n+new` }]]);
    }
    if (args.includes("Accept: application/vnd.github.diff")) {
      return `diff --git a/${claims.findings[0].path} b/${claims.findings[0].path}\n--- a/${claims.findings[0].path}\n+++ b/${claims.findings[0].path}\n@@ -${inspectedLine},1 +${inspectedLine},1 @@\n-old\n+new\n`;
    }
    if (args.includes("POST")) {
      mutations += 1;
      return JSON.stringify({ id: 194205, html_url: "https://github.com/acme/payments/pull/842#pullrequestreview-194205" });
    }
    return JSON.stringify([[]]);
  };
  return { provider: createGitHubProvider({ execute }), mutationCount: () => mutations };
}

function providerWithMutationResponse(mutationResponse: string) {
  const claims = publicationClaims();
  let lists = 0;
  let mutations = 0;
  const execute = async (args: string[]) => {
    if (args.join(" ") === "api user") return JSON.stringify({ node_id: claims.actor.id, login: claims.actor.login });
    if (args[0] === "repo") return JSON.stringify(claims.repository);
    if (args[0] === "pr") return JSON.stringify({
      id: claims.pullRequest.id,
      number: claims.pullRequest.number,
      state: "OPEN",
      baseRefOid: claims.scope.baseOid,
      headRefOid: claims.scope.headOid,
    });
    if (args.includes("POST")) {
      mutations += 1;
      return mutationResponse;
    }
    if (String(args.at(-1)).endsWith("/reviews")) {
      lists += 1;
      return JSON.stringify([[]]);
    }
    throw new Error(`Unexpected provider request: ${args.join(" ")}`);
  };
  return {
    provider: createGitHubProvider({ execute }),
    listCount: () => lists,
    mutationCount: () => mutations,
  };
}

async function confirm(url: string, claims: ReturnType<typeof publicationClaims>, key: Buffer, ...selected: string[]) {
  const form = new URLSearchParams({ publication_token: createPublicationToken(claims, { key }) });
  selected.forEach((id) => form.append("selected_finding_id", id));
  return fetch(`${url}/api/v1/review-publication-confirmations`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
}

function confirmationToken(body: string) {
  return /name="confirmation_token" value="([^"]+)"/.exec(body)?.[1] ?? "";
}

function publish(url: string, token: string) {
  return fetch(`${url}/api/v1/review-publications`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ confirmation_token: token }),
  });
}

function derivePublication(claims: ReturnType<typeof publicationClaims>) {
  return {
    event: "COMMENT",
    commitId: claims.scope.headOid,
    generalComment: "Review found 1 issue worth addressing:\n\n- Finding RC-001",
    comments: claims.findings.map(({ id, path, line, side, body }) => ({ findingId: id, path, line, side, body })),
    scope: claims,
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
