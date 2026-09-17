import { expect, test } from "bun:test";
import http from "node:http";
import { PassThrough } from "node:stream";

import {
  handleInetdRequest,
  relayInetdRequest,
} from "../../skills/review-change/runtime/review-publication-inetd.mjs";

const FORM_HEADERS = {
  "content-type": "application/x-www-form-urlencoded",
  host: "127.0.0.1:4392",
};

test("rejects every noncanonical endpoint before dispatch or relay", async () => {
  const invalidPaths = [
    "/api//v1/review-publications",
    "/api\\v1\\review-publications",
    "/api/v1/review-publications?next=1",
    "/api/v1/review-publications#fragment",
    "/api/v1%2freview-publications",
    "/api/v1%5creview-publications",
    "/https://example.invalid/api/v1/review-publications",
  ];
  let relayedRequests = 0;
  const internal = http.createServer((_request, response) => {
    relayedRequests += 1;
    response.end("unexpected");
  });
  const address = await listen(internal);
  invalidPaths.unshift(`//127.0.0.1:${address.port}/api/v1/review-publications`);
  try {
    for (const requestPath of invalidPaths) {
      await expect(relayInetdRequest(`http://127.0.0.1:${address.port}`, {
        method: "POST",
        path: requestPath,
        headers: FORM_HEADERS,
        body: "",
      })).rejects.toMatchObject({ code: "invalid_publication_endpoint" });

      const input = new PassThrough();
      const output = new PassThrough();
      let dispatches = 0;
      input.end(rawRequest(requestPath));
      await handleInetdRequest({
        input,
        output,
        dispatch: async () => {
          dispatches += 1;
          throw new Error("A noncanonical endpoint must not dispatch");
        },
      });
      expect(dispatches).toBe(0);
    }
    expect(relayedRequests).toBe(0);
  } finally {
    await close(internal);
  }
});

test("bounds internal relay responses and settles cancellation", async () => {
  const sockets = new Set<any>();
  const server = http.createServer((request, response) => {
    if (request.url?.includes("confirmations")) {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("x".repeat(3 * 1024 * 1024));
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  const address = await listen(server);
  const serverUrl = `http://127.0.0.1:${address.port}`;
  try {
    await expect(relayInetdRequest(serverUrl, {
      method: "POST",
      path: "/api/v1/review-publication-confirmations",
      headers: FORM_HEADERS,
      body: "",
    })).rejects.toMatchObject({ code: "internal_response_too_large" });

    const controller = new AbortController();
    const request = relayInetdRequest(serverUrl, {
      method: "POST",
      path: "/api/v1/review-publications",
      headers: FORM_HEADERS,
      body: "",
    }, controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ code: "request_timeout" });
  } finally {
    for (const socket of sockets) socket.destroy();
    await close(server);
  }
});

function rawRequest(requestPath: string) {
  return [
    `POST ${requestPath} HTTP/1.1`,
    "Host: 127.0.0.1:4392",
    "Content-Type: application/x-www-form-urlencoded",
    "Content-Length: 0",
    "",
    "",
  ].join("\r\n");
}

async function listen(server: http.Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind a TCP port");
  return address;
}

function close(server: http.Server) {
  return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
