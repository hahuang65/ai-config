import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LspTransport } from "../harnesses/pi/lsp/transport";

async function fixture(mode: string, run: (rpc: LspTransport) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "lsp-transport-"));
  const log = join(root, "pid");
  const rpc = new LspTransport("node", [fileURLToPath(new URL("./fixtures/lsp-transport.mjs", import.meta.url)), mode, log],
    root, pathToFileURL(root).href, 500);
  try { await run(rpc); }
  finally {
    await rpc.stop();
    await rpc.stop();
    const pids = readFileSync(log, "utf8").trim().split("\n").map(Number);
    try {
      for (const pid of pids) {
        const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
        const deadline = Date.now() + 1000;
        while (alive() && Date.now() < deadline) await Bun.sleep(10);
        expect(alive()).toBe(false);
      }
    } finally {
      for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch {} }
      rmSync(root, { recursive: true, force: true });
    }
  }
}

for (const [mode, error] of [["malformed", "Invalid"], ["oversized", "oversized"], ["exit", "exited"], ["silent", "timed out"]]) {
  test(`stdio LSP fails safely and reaps the server on ${mode}`, () => fixture(mode, async (rpc) => {
    await expect(rpc.request("initialize", {})).rejects.toThrow(error);
    expect(rpc.alive).toBe(false);
  }), 5000);
}

for (const mode of ["empty-response", "both-fields", "invalid-error", "null-error", "invalid-utf8", "object-id", "boolean-id", "array-id"]) {
  test(`stdio LSP reports an invalid ${mode} as a protocol error`, () => fixture(mode, async (rpc) => {
    await expect(rpc.request("initialize", {})).rejects.toThrow("Invalid");
  }), 5000);
}

test("stdio LSP preserves a legitimate null answer", () => fixture("valid-null", async (rpc) => {
  expect(await rpc.request("hover", {})).toBe(null);
}), 5000);

test("stdio LSP respects mid-request cancellation and leaves no server", () => fixture("silent", async (rpc) => {
  const signal = AbortSignal.timeout(250);
  await expect(rpc.request("initialize", {}, signal)).rejects.toThrow("cancelled");
}), 5000);

test("stdio LSP accepts fragmented UTF-8 frames", () => fixture("fragmented", async (rpc) => {
  expect(await rpc.request("initialize", {})).toEqual({ unicode: "😀" });
}), 5000);

test("stdio LSP stops descendants even if the server exits cleanly first", () => fixture("descendant", async (rpc) => {
  expect(await rpc.request("initialize", {})).toEqual({ unicode: "😀" });
}), 5000);

test("idle parent exit stops helpers holding inherited output pipes without waiting for another query", () => fixture("inherited-pipes", async (rpc) => {
  let stopped!: () => void;
  const failure = new Promise<void>((resolve) => { stopped = resolve; });
  rpc.onFailure = stopped;
  expect(await rpc.request("initialize", {})).toEqual({ unicode: "😀" });
  let timer: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([failure, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Idle parent exit was not detected")), 1000); })]);
    expect(rpc.alive).toBe(false);
  } finally { clearTimeout(timer!); }
}), 5000);

test("an idle server that floods requests without reading replies is stopped at the output budget", () => fixture("flood", async (rpc) => {
  let stopped!: () => void;
  const failure = new Promise<void>((resolve) => { stopped = resolve; });
  rpc.onFailure = stopped;
  await rpc.request("initialize", {});
  let timer: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([failure, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Output budget did not stop the server")), 1500); })]);
    expect(rpc.alive).toBe(false);
    await expect(rpc.request("hover")).rejects.toThrow("output queue");
  } finally { clearTimeout(timer!); }
}), 5000);

test("a missing language server gives provisioning guidance without raw OS errors", async () => {
  const rpc = new LspTransport("/nonexistent-ai-config-fixture/language-server", [], tmpdir(), pathToFileURL(tmpdir()).href);
  try { await expect(rpc.request("initialize", {})).rejects.toThrow("mise.toml"); }
  finally { await rpc.stop(); }
}, 5000);
