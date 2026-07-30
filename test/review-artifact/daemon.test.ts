import { afterEach, describe, expect, test } from "bun:test";
import { createServer } from "node:http";

import { fetchHealth } from "../../skills/review-artifact/runtime/daemon.mjs";

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
});
