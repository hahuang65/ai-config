import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { startReviewServer } from "../../skills/review-artifact/runtime/server.mjs";

const servers: Array<{ agentToken: string; baseUrl: string; close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("review server security", () => {
  test("rejects untrusted hosts and browser origins", async () => {
    const { artifact, server } = await reviewServer("<!doctype html><main>Secure</main>");
    const badHost = await fetch(`${server.baseUrl}/health`, { headers: { host: "evil.example" } });
    const created = await createSession(server, artifact);
    const badOrigin = await fetch(`${server.baseUrl}/api/sessions/${created.key}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ prompts: [{ prompt: "Injected" }] }),
    });

    expect([badHost.status, badOrigin.status]).toEqual([403, 403]);
  });

  test("rejects malformed durable annotation targets", async () => {
    const { artifact, server } = await reviewServer("<!doctype html><main>Secure target</main>");
    const created = await createSession(server, artifact);
    const response = await fetch(`${server.baseUrl}/api/sessions/${created.key}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.baseUrl },
      body: JSON.stringify({
        prompts: [{ prompt: "Malformed", target: { type: "text-range", text: {} } }],
      }),
    });

    expect(response.status).toBe(422);
  });

  test("does not expose the agent capability to browser surfaces", async () => {
    const { artifact, server } = await reviewServer("<!doctype html><main>Private capability</main>");
    const created = await createSession(server, artifact);
    const shell = await fetch(created.url).then((response) => response.text());

    expect(JSON.stringify(created) + shell).not.toContain(server.agentToken);
  });

  test("prevents the artifact origin from consuming agent events", async () => {
    const { artifact, server } = await reviewServer("<!doctype html><main>Review me</main>");
    const created = await createSession(server, artifact);
    await fetch(`${server.baseUrl}/api/sessions/${created.key}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.baseUrl },
      body: JSON.stringify({ prompts: [{ prompt: "Keep this private" }] }),
    });

    const artifactPoll = await fetch(`${server.baseUrl}/api/sessions/${created.key}/poll`);
    const artifactShutdown = await fetch(`${server.baseUrl}/shutdown`, { method: "POST" });
    const agentPoll = await fetch(`${server.baseUrl}/api/sessions/${created.key}/poll`, {
      headers: { "x-review-artifact-agent-token": server.agentToken },
    });

    expect([artifactPoll.status, artifactShutdown.status]).toEqual([401, 401]);
    expect(await agentPoll.json()).toMatchObject({
      status: "feedback",
      prompts: [{ prompt: "Keep this private" }],
    });
  });
});

async function reviewServer(source: string) {
  const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-"));
  const artifact = path.join(directory, "specs.html");
  await writeFile(artifact, source);
  const server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
  servers.push(server);
  return { artifact, server };
}

function createSession(server: { baseUrl: string }, artifact: string) {
  return fetch(`${server.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: artifact }),
  }).then((response) => response.json());
}
