import { spawn, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { JEV_MODEL, JEV_TIMEOUT_MS, unavailable, type JevRequest, type Judgment } from "./jev-client.ts";
import { containsSecretLiteral } from "../guard/secret-literals.ts";
import { reviewSources } from "../tools/project-pi.mjs";

function environment(sources: readonly string[]) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (["NODE_OPTIONS", "NODE_PATH", "BUN_OPTIONS", "PI_CODING_AGENT_SESSION_DIR", "BASH_ENV", "ENV", "ZDOTDIR", "CDPATH"].includes(key)
        || key.startsWith("GIT_") || key.startsWith("BASH_FUNC_")) delete env[key];
  }
  env.AI_REVIEW_EXCLUDED_SOURCES = JSON.stringify(reviewSources(sources));
  return env;
}

function stop(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try { process.kill(-child.pid, "SIGKILL"); }
  catch { try { child.kill("SIGKILL"); } catch { /* Do not expose raw process diagnostics. */ } }
}

function result(text: string, request: JevRequest, elapsed: number): Judgment {
  try {
    const value = JSON.parse(text), keys = Object.keys(request.questions);
    if (value.status !== "ok" || value.model !== JEV_MODEL || Object.keys(value.probabilities).length !== keys.length ||
        keys.some(key => !Number.isFinite(value.probabilities[key]) || value.probabilities[key] < 0 || value.probabilities[key] > 1)) return unavailable(elapsed);
    const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
    return { status: "ok", model: JEV_MODEL, probabilities: Object.fromEntries(keys.map(key => [key, value.probabilities[key]])),
      inputTokens: count(value.inputTokens), outputTokens: count(value.outputTokens), elapsedMs: elapsed };
  } catch { return unavailable(elapsed); }
}

function requestBody(request: JevRequest, signal?: AbortSignal): string | undefined {
  try {
    const body = JSON.stringify(request);
    if (!signal?.aborted && Buffer.byteLength(body) <= 32768 && !containsSecretLiteral(body)) return body;
  } catch { /* Invalid input never starts a worker. */ }
}

/** Bound discovery, SDK initialization, and classification outside the hook event loop. */
export async function runJevBridge(moduleUrl: string, request: JevRequest, signal?: AbortSignal, sources: readonly string[] = []): Promise<Judgment> {
  const body = requestBody(request, signal);
  if (!body) return unavailable();
  const started = performance.now();
  return new Promise(accept => {
    const supervisor = fileURLToPath(new URL("./jev-supervisor.mjs", import.meta.url));
    const args = [...(process.versions.bun ? ["--no-env-file", "--config=/dev/null"] : []), supervisor, fileURLToPath(moduleUrl)];
    const child = spawn(process.execPath, args, { cwd: tmpdir(), env: environment(sources), detached: true, stdio: ["pipe", "pipe", "ignore", "pipe"] });
    const owner = child.stdio[3] as import("node:stream").Duplex;
    let finished = false, bytes = 0;
    const chunks: Buffer[] = [];
    const elapsed = () => Math.round(performance.now() - started);
    const finish = (value: Judgment) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      for (const event of ["SIGINT", "SIGTERM"] as const) process.removeListener(event, abort);
      process.removeListener("exit", exiting);
      stop(child);
      child.stdin!.destroy(); child.stdout!.destroy(); owner.destroy(); child.unref();
      accept(value);
    };
    const abort = () => finish(unavailable(elapsed()));
    const exiting = () => stop(child);
    const timer = setTimeout(abort, JEV_TIMEOUT_MS);
    child.once("error", abort);
    child.stdin!.once("error", abort);
    child.stdout!.on("data", (chunk: Buffer) => {
      if (finished) return;
      bytes += chunk.length;
      if (bytes > 65536) { abort(); return; }
      chunks.push(chunk);
      const text = Buffer.concat(chunks).toString("utf8"), newline = text.indexOf("\n");
      if (newline >= 0) finish(result(text.slice(0, newline), request, elapsed()));
    });
    child.once("close", abort);
    owner.once("error", abort);
    signal?.addEventListener("abort", abort, { once: true });
    for (const event of ["SIGINT", "SIGTERM"] as const) process.once(event, abort);
    process.once("exit", exiting);
    if (signal?.aborted) abort(); else child.stdin!.end(body);
  });
}
