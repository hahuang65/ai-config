import { afterEach, describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  ensureReviewServer,
  fetchHealth,
  stopReviewServer,
} from "../../skills/review-artifact/runtime/daemon.mjs";

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
    server.closeAllConnections?.();
  }
});

describe("review server bootstrap", () => {
  test("treats a non-review health response as unavailable", async () => {
    const server = createServer((_request, response) => response.end("not json"));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();

    expect(await fetchHealth(`http://127.0.0.1:${typeof address === "object" ? address!.port : 0}`)).toBeNull();
  });

  test("returns the winning capability to concurrent startup callers", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-daemon-"));
    const port = await reservePort();
    const environment = {
      ...process.env,
      REVIEW_ARTIFACT_PORT: String(port),
      REVIEW_ARTIFACT_STATE_DIR: directory,
    };

    try {
      const connections = await Promise.all([
        ensureReviewServer(environment),
        ensureReviewServer(environment),
      ]);
      const statuses = await Promise.all(connections.map(({ agentToken, baseUrl }) => fetch(
        `${baseUrl}/sessions/missing/poll`,
        { headers: { "x-review-artifact-agent": agentToken }, signal: AbortSignal.timeout(1_000) },
      ).then((response) => response.status)));

      expect({ sameToken: connections[0].agentToken === connections[1].agentToken, statuses }).toEqual({
        sameToken: true,
        statuses: [404, 404],
      });
    } finally {
      await stopReviewServer(environment).catch(() => {});
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  test("restarts an incompatible review daemon before reuse", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-daemon-"));
    const oldServer = createServer((request, response) => {
      if (request.url === "/health") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ ok: true, app: "review-artifact", version: 1 }));
        return;
      }
      response.end(JSON.stringify({ status: "stopping" }), () => oldServer.close());
    });
    await new Promise<void>((resolve) => oldServer.listen(0, "127.0.0.1", resolve));
    const address = oldServer.address();
    const port = typeof address === "object" ? address!.port : 0;
    const environment = {
      ...process.env,
      REVIEW_ARTIFACT_PORT: String(port),
      REVIEW_ARTIFACT_STATE_DIR: directory,
    };

    try {
      const connection = await ensureReviewServer(environment);
      const health = await fetchHealth(connection.baseUrl);

      expect(health).toMatchObject({ app: "review-artifact", version: 4 });
    } finally {
      await stopReviewServer(environment).catch(() => {});
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});

async function reservePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" ? address!.port : 0;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}
