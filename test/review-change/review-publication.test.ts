import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { renderPublicationForm } from "../../skills/review-change/runtime/review-publication-html.mjs";
import { createReviewPublicationServer } from "../../skills/review-change/runtime/review-publication-server.mjs";
import { createGitHubProvider } from "../../skills/review-change/runtime/review-publication-provider.mjs";
import { loadPublicationKey, withPublisherLock } from "../../skills/review-change/runtime/review-publication-state.mjs";
import { handleInetdRequest } from "../../skills/review-change/runtime/review-publication-inetd.mjs";
import {
  currentPullRequest,
  derivePublication,
  publicationClaims,
  signTestPublicationClaims as createPublicationToken,
} from "./review-publication-fixtures";

const servers: Array<{ close(): Promise<void> }> = [];
const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("Review publication", () => {
  test("confirms one signed Finding without publishing it", async () => {
    const key = Buffer.alloc(32, 7);
    const claims = {
      reportId: "08".repeat(16),
      host: "github.com",
      signingKeyId: "review-publication-v1",
      commentTemplateVersion: 1,
      actor: { id: "U_123", login: "reviewer" },
      repository: { id: "R_456", nameWithOwner: "acme/payments" },
      pullRequest: { id: "PR_789", number: 842, url: "https://github.com/acme/payments/pull/842" },
      scope: { baseOid: "a".repeat(40), headOid: "b".repeat(40) },
      findings: [{
        id: "RC-001",
        title: "Retry can create duplicate exports",
        body: "Guard the retry transition before creating a new export.",
        path: "src/export/export-runner.ts",
        line: 84,
        side: "RIGHT",
      }],
    };
    const publicationToken = createPublicationToken(claims, { key });
    const report = renderPublicationForm({ publicationToken, findings: claims.findings });
    let mutations = 0;
    const server = await createReviewPublicationServer({
      key,
      inspectPullRequest: async () => ({
        actor: claims.actor,
        repository: claims.repository,
        pullRequest: { ...claims.pullRequest, state: "OPEN" },
        scope: claims.scope,
      }),
      publishReview: async () => { mutations += 1; throw new Error("unexpected publication"); },
    });
    servers.push(server);

    const response = await fetch(`${server.url}/api/v1/review-publication-confirmations`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ publication_token: publicationToken, selected_finding_id: "RC-001" }),
    });
    const confirmation = await response.text();

    expect({
      reportHasSelectedFinding: report.includes('type="checkbox" checked'),
      reportHasDerivedGeneral: report.includes("Review found 1 issue worth addressing"),
      status: response.status,
      confirmationHasHeading: confirmation.includes("Post this review to GitHub?"),
      confirmationHasActor: confirmation.includes("@reviewer"),
      confirmationHasDestination: confirmation.includes("acme/payments · PR #842"),
      confirmationHasFinding: confirmation.includes("Guard the retry transition"),
      confirmationHasActions: confirmation.includes("Change selection") && confirmation.includes("Post review to GitHub"),
      mutations,
    }).toEqual({
      reportHasSelectedFinding: true,
      reportHasDerivedGeneral: true,
      status: 200,
      confirmationHasHeading: true,
      confirmationHasActor: true,
      confirmationHasDestination: true,
      confirmationHasFinding: true,
      confirmationHasActions: true,
      mutations: 0,
    });
  });

  test("keeps hostile Finding content inert in the report form", () => {
    const key = Buffer.alloc(32, 3);
    const claims = publicationClaims();
    claims.findings[0].id = "</script><script>alert(1)</script>";
    claims.findings[0].title = "<img src=x onerror=alert(1)>";
    const publicationToken = createPublicationToken(claims, { key });

    const report = renderPublicationForm({ publicationToken, findings: claims.findings });

    expect({
      scriptClosings: report.match(/<\/script>/g)?.length,
      hasExecutableInjection: report.includes("</script><script>alert(1)</script>"),
      hasEscapedTitle: report.includes("&lt;img src=x onerror=alert(1)&gt;"),
    }).toEqual({
      scriptClosings: 1,
      hasExecutableInjection: false,
      hasEscapedTitle: true,
    });
  });

  test("refuses publication under a changed GitHub actor without provider mutation", async () => {
    const key = Buffer.alloc(32, 11);
    const claims = publicationClaims();
    const publicationToken = createPublicationToken(claims, { key });
    let inspectionCount = 0;
    let providerMutations = 0;
    const server = await createReviewPublicationServer({
      key,
      inspectPullRequest: async () => {
        inspectionCount += 1;
        const current = currentPullRequest(claims);
        return inspectionCount === 1
          ? current
          : { ...current, actor: { id: "U_999", login: "other-reviewer" } };
      },
      publishReview: async () => { providerMutations += 1; throw new Error("unexpected publication"); },
    });
    servers.push(server);
    const confirmationResponse = await fetch(`${server.url}/api/v1/review-publication-confirmations`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ publication_token: publicationToken, selected_finding_id: "RC-001" }),
    });
    const confirmation = await confirmationResponse.text();
    const confirmationToken = /name="confirmation_token" value="([^"]+)"/.exec(confirmation)?.[1] ?? "";

    const response = await fetch(`${server.url}/api/v1/review-publications`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ confirmation_token: confirmationToken }),
    });
    const outcome = await response.text();

    expect({
      status: response.status,
      errorCode: /data-publication-error="([^"]+)"/.exec(outcome)?.[1],
      identifiesActors: outcome.includes("@reviewer") && outcome.includes("@other-reviewer"),
      confirmsNoPost: outcome.includes("No comments were posted"),
      providerMutations,
    }).toEqual({
      status: 403,
      errorCode: "github_actor_changed",
      identifiesActors: true,
      confirmsNoPost: true,
      providerMutations: 0,
    });
  });

  test("rejects a changed pull-request head and asks for a new review run", async () => {
    const key = Buffer.alloc(32, 12);
    const claims = publicationClaims();
    let providerMutations = 0;
    const server = await createReviewPublicationServer({
      key,
      inspectPullRequest: async () => ({
        ...currentPullRequest(claims),
        scope: { ...claims.scope, headOid: "c".repeat(40) },
      }),
      publishReview: async () => { providerMutations += 1; },
    });
    servers.push(server);

    const response = await fetch(`${server.url}/api/v1/review-publication-confirmations`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        publication_token: createPublicationToken(claims, { key }),
        selected_finding_id: "RC-001",
      }),
    });
    const outcome = await response.text();

    expect({
      status: response.status,
      errorCode: /data-publication-error="([^"]+)"/.exec(outcome)?.[1],
      correctiveAction: outcome.includes("Run Review change again") && outcome.includes("will not be moved"),
      providerMutations,
    }).toEqual({
      status: 409,
      errorCode: "pull_request_scope_changed",
      correctiveAction: true,
      providerMutations: 0,
    });
  });

  test("rejects a tampered report envelope before provider access", async () => {
    const key = Buffer.alloc(32, 13);
    const claims = publicationClaims();
    let providerAccesses = 0;
    const server = await createReviewPublicationServer({
      key,
      inspectPullRequest: async () => { providerAccesses += 1; return currentPullRequest(claims); },
      publishReview: async () => { providerAccesses += 1; },
    });
    servers.push(server);
    const token = createPublicationToken(claims, { key });

    const response = await fetch(`${server.url}/api/v1/review-publication-confirmations`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ publication_token: `${token.slice(0, -1)}x`, selected_finding_id: "RC-001" }),
    });
    const outcome = await response.text();

    expect({
      status: response.status,
      errorCode: /data-publication-error="([^"]+)"/.exec(outcome)?.[1],
      providerAccesses,
    }).toEqual({ status: 401, errorCode: "invalid_publication_token", providerAccesses: 0 });
  });

  test("rejects an inline location that is absent from the exact pull-request diff", async () => {
    const claims = publicationClaims();
    let mutationCount = 0;
    const provider = createGitHubProvider({
      execute: async (args: string[]) => {
        if (args.join(" ") === "api user") return JSON.stringify({ node_id: "U_123", login: "reviewer" });
        if (args[0] === "repo") return JSON.stringify({ id: "R_456", nameWithOwner: "acme/payments" });
        if (args[0] === "pr") return JSON.stringify({ id: "PR_789", number: claims.pullRequest.number, state: "OPEN", baseRefOid: claims.scope.baseOid, headRefOid: claims.scope.headOid });
        if (args.includes("Accept: application/vnd.github.diff")) {
          return `diff --git a/${claims.findings[0].path} b/${claims.findings[0].path}\n--- a/${claims.findings[0].path}\n+++ b/${claims.findings[0].path}\n@@ -10,1 +10,1 @@\n-old\n+new\n`;
        }
        if (args.includes("POST")) mutationCount += 1;
        return JSON.stringify([[{ filename: claims.findings[0].path, patch: "@@ -10,1 +10,1 @@\n-old\n+new" }]]);
      },
    });

    await expect(provider.inspectPullRequest(claims)).rejects.toMatchObject({ code: "invalid_inline_location" });
    expect(mutationCount).toBe(0);
  });

  test("rejects a symlinked publication state directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-publication-state-"));
    const outside = await mkdtemp(path.join(tmpdir(), "review-publication-outside-"));
    temporaryRoots.push(root, outside);
    await symlink(outside, path.join(root, ".review-publication"));

    await expect(loadPublicationKey({ home: root })).rejects.toThrow("state directory is unsafe");
  });

  test("serializes concurrent publication work and removes transient state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-publication-lock-"));
    temporaryRoots.push(root);
    let active = 0;
    let maximumActive = 0;
    const work = () => withPublisherLock(publicationClaims(), async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Bun.sleep(20);
      active -= 1;
    }, { home: root });

    await Promise.all([work(), work()]);

    expect({
      maximumActive,
      lockEntries: await Array.fromAsync(new Bun.Glob("publisher-*.lock").scan({ cwd: path.join(root, ".review-publication") })),
    }).toEqual({ maximumActive: 1, lockEntries: [] });
  });

  test("answers a socket-activated HTTP request without waiting for peer EOF", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let response = "";
    output.on("data", (chunk) => { response += chunk.toString(); });
    input.write("POST /api/v1/review-publication-confirmations HTTP/1.1\r\nHost: 127.0.0.1:4392\r\nContent-Length: 3\r\n\r\na=1");

    await Promise.race([
      handleInetdRequest({
        input,
        output,
        dispatch: async (request: any) => ({
          status: request.body === "a=1" ? 200 : 400,
          headers: { "content-type": "text/plain" },
          body: "ok",
        }),
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("publisher waited for peer EOF")), 200)),
    ]).finally(() => input.destroy());

    expect(response).toContain("HTTP/1.1 200 OK\r\n");
  });

  test("publishes one confirmed Finding as one GitHub comment review", async () => {
    const key = Buffer.alloc(32, 9);
    const claims = publicationClaims();
    const publicationToken = createPublicationToken(claims, { key });
    const publications: any[] = [];
    const server = await createReviewPublicationServer({
      key,
      inspectPullRequest: async () => currentPullRequest(claims),
      confirmPublication: async () => {},
      publishReview: async (publication: any) => {
        publications.push(publication);
        return { reviewId: 194205, url: "https://github.com/acme/payments/pull/842#pullrequestreview-194205" };
      },
    });
    servers.push(server);
    const confirmationResponse = await fetch(`${server.url}/api/v1/review-publication-confirmations`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ publication_token: publicationToken, selected_finding_id: "RC-001" }),
    });
    const confirmation = await confirmationResponse.text();
    const confirmationToken = /name="confirmation_token" value="([^"]+)"/.exec(confirmation)?.[1];

    const response = await fetch(`${server.url}/api/v1/review-publications`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ confirmation_token: confirmationToken ?? "" }),
    });
    const outcome = await response.text();

    expect({
      status: response.status,
      publicationCount: publications.length,
      publication: publications[0],
      outcomeHasReview: outcome.includes("Review posted") && outcome.includes("@reviewer") && outcome.includes("pullrequestreview-194205"),
    }).toEqual({
      status: 201,
      publicationCount: 1,
      publication: {
        event: "COMMENT",
        commitId: claims.scope.headOid,
        generalComment: "Review found 1 issue worth addressing:\n\n- Retry can create duplicate exports",
        comments: [{
          findingId: "RC-001",
          path: "src/export/export-runner.ts",
          line: 84,
          side: "RIGHT",
          body: "Guard the retry transition before creating a new export.",
        }],
        scope: claims,
      },
      outcomeHasReview: true,
    });
  });
});
