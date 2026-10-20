import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { ChannelPrototype, MARKERS } from "./controller";
import { prepare } from "./run";

async function until(condition: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw Error("Prototype protocol check timed out");
    await Bun.sleep(10);
  }
}

test("prototype does not count auxiliary UI requests as channel-feedback turns", async () => {
  const prototype = new ChannelPrototype(() => {});
  const send = (kind: string, content: string) => fetch(`http://127.0.0.1:${prototype.api.server.port}/v1/messages`, {
    method: "POST", headers: { "content-type": "application/json", "x-claude-code-request-class": kind },
    body: JSON.stringify({ model: "claude-sonnet-4-6", messages: [{ role: "user", content }] }),
  });
  try {
    await send("auxiliary", "Generate a title for PROTOTYPE_START");
    await send("main", "PROTOTYPE_START");
    await send("auxiliary", "Suggest a next prompt");
    expect(prototype.finished).toBe(false);
    expect(prototype.observed).toBe(1);
  } finally { prototype.stop(); }
});

test("prototype still rejects a main turn before the expected feedback arrives", async () => {
  const prototype = new ChannelPrototype(() => {});
  const send = () => fetch(`http://127.0.0.1:${prototype.api.server.port}/v1/messages`, {
    method: "POST", headers: { "content-type": "application/json", "x-claude-code-request-class": "main" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "PROTOTYPE_START" }] }),
  });
  try {
    await send();
    await send();
    expect((await prototype.completed.promise).passed).toBe(false);
    expect(prototype.written.size).toBe(0);
    expect(prototype.observed).toBe(1);
  } finally { prototype.stop(); }
});

test("prototype seeds onboarding in the selected native config directory, not its parent", () => {
  const prototype = new ChannelPrototype(() => {});
  try {
    const profile = prepare(prototype);
    console.info(`PROTOTYPE fixture profile retained for inspection: ${profile.home}`);
    const config = JSON.parse(readFileSync(join(profile.env.CLAUDE_CONFIG_DIR, ".claude.json"), "utf8"));
    expect(config.hasCompletedOnboarding).toBe(true);
  } finally { prototype.stop(); }
});

test("prototype MCP negotiation and authenticated notification writes do not claim model delivery", async () => {
  const prototype = new ChannelPrototype(() => {});
  const child = Bun.spawn([process.execPath, resolve("test/prototypes/review-feedback-channel/channel.ts")], {
    env: { REVIEW_CHANNEL_PROTOTYPE_URL: prototype.url, REVIEW_CHANNEL_PROTOTYPE_TOKEN: prototype.token },
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  let output = "";
  const stdout = (async () => { for await (const chunk of child.stdout) output += new TextDecoder().decode(chunk); })();
  const stderr = new Response(child.stderr).text();
  const guard = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    expect((await fetch(`${prototype.url}/next?cursor=0`)).status).toBe(403);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })}\n`);
    child.stdin.flush();
    await until(() => output.includes('"id":1'));
    const reply = JSON.parse(output.trim());
    expect(reply.result.capabilities.experimental).toEqual({ "claude/channel": {} });
    expect(reply.result.protocolVersion).toBe("2025-06-18");
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    child.stdin.flush();
    await until(() => prototype.connected);
    prototype.publish(MARKERS[0]);
    await until(() => prototype.written.has(1));
    const notification = output.trim().split("\n").map(line => JSON.parse(line)).find(message => message.method === "notifications/claude/channel");
    expect(notification.params.content).toBe(MARKERS[0]);
    expect(prototype.api.requests).toHaveLength(0);
    expect(prototype.finished).toBe(false);
    child.stdin.end();
    expect(await child.exited, await stderr).toBe(0);
  } finally {
    clearTimeout(guard);
    child.kill("SIGTERM");
    await child.exited;
    await stdout;
    await stderr;
    prototype.stop();
  }
}, 15_000);

test("prototype Stop observer schedules a push only after a synthetic response completes", async () => {
  const prototype = new ChannelPrototype(() => {});
  await prototype.modelRequest({ messages: [{ content: "PROTOTYPE_START" }] }, 1);
  const child = Bun.spawn([process.execPath, resolve("test/prototypes/review-feedback-channel/channel.ts"), "--observe-stop"], {
    env: { REVIEW_CHANNEL_PROTOTYPE_URL: prototype.url, REVIEW_CHANNEL_PROTOTYPE_TOKEN: prototype.token },
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  const guard = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    expect(prototype.events).toHaveLength(0);
    child.stdin.write(JSON.stringify({ last_assistant_message: "PROTOTYPE_RESPONSE — synthetic completion" }));
    child.stdin.end();
    const [status, errors] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(status, errors).toBe(0);
    await until(() => prototype.events.length === 1);
    expect(prototype.events[0].content).toBe(MARKERS[0]);
    expect(prototype.finished).toBe(false);
  } finally {
    clearTimeout(guard);
    child.kill("SIGTERM");
    await child.exited;
    prototype.stop();
  }
}, 15_000);
