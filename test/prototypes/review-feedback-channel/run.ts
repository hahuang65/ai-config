// PROTOTYPE — NOT PRODUCTION. Run manually in a real terminal for native consent.
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ChannelPrototype } from "./controller";

function quote(value: string) { return `'${value.replaceAll("'", "'\\''")}'`; }

export function prepare(prototype: ChannelPrototype) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "review-channel-prototype-")));
  const root = join(home, "workspace");
  const bun = realpathSync(process.execPath);
  mkdirSync(root, { mode: 0o700 });
  mkdirSync(join(home, ".claude"), { mode: 0o700 });
  cpSync(fileURLToPath(new URL("./channel.ts", import.meta.url)), join(home, "channel.ts"));
  writeFileSync(join(home, ".claude/.claude.json"), JSON.stringify({ hasCompletedOnboarding: true }), { mode: 0o600 });
  writeFileSync(join(home, ".claude/settings.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command",
    command: `${quote(bun)} ${quote(join(home, "channel.ts"))} --observe-stop`, timeout: 3 }] }] } }), { mode: 0o600 });
  const mcp = join(home, "mcp.json");
  writeFileSync(mcp, JSON.stringify({ mcpServers: { review_feedback_prototype: {
    command: bun, args: [join(home, "channel.ts")],
  } } }), { mode: 0o600 });
  const env = { HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), XDG_CONFIG_HOME: join(home, ".config"),
    XDG_CACHE_HOME: join(home, ".cache"), PATH: `${dirname(bun)}:/opt/homebrew/bin:/usr/bin:/bin`,
    REVIEW_CHANNEL_PROTOTYPE_URL: prototype.url, REVIEW_CHANNEL_PROTOTYPE_TOKEN: prototype.token,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${prototype.api.server.port}`, ANTHROPIC_API_KEY: "disposable-fixture",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1", TERM: process.env.TERM || "xterm-256color", LANG: "en_US.UTF-8" };
  return { home, root, mcp, env };
}

export function sandbox() {
  return `(version 1)(allow default)(deny network*)
    (allow network-inbound (local ip "localhost:*"))(allow network-outbound (remote ip "localhost:*"))
    (deny file-write* (subpath ${JSON.stringify(homedir())}))
    (deny file-read* ${[".claude", ".pi", ".ssh", ".aws", ".config/gcloud", ".dotfiles/ai"]
      .map(path => `(subpath ${JSON.stringify(join(homedir(), path))})`).join(" ")})`;
}

async function stop(child: ReturnType<typeof Bun.spawn>) {
  child.kill("SIGTERM");
  const guard = setTimeout(() => child.kill("SIGKILL"), 2000);
  try { await child.exited; } finally { clearTimeout(guard); }
}

async function nativeRun(prototype: ChannelPrototype, prepared: ReturnType<typeof prepare>) {
  const child = Bun.spawn(["/usr/bin/sandbox-exec", "-p", sandbox(), realpathSync(Bun.which("claude")!),
    "--mcp-config", prepared.mcp, "--dangerously-load-development-channels", "server:review_feedback_prototype",
    "--tools", "", "--model", "claude-sonnet-4-6", "PROTOTYPE_START — synthetic native-push test only"], {
    cwd: prepared.root, env: prepared.env, stdin: "inherit", stdout: "inherit", stderr: "inherit",
  });
  const guard = setTimeout(() => prototype.finish(false, "Five-minute native test budget expired"), 300_000);
  const interrupt = () => prototype.finish(false, "Stopped by the operator");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    return await Promise.race([prototype.completed.promise,
      child.exited.then(() => ({ passed: false, detail: "Native client exited before all channel checks completed" }))]);
  } finally {
    clearTimeout(guard);
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    await stop(child);
  }
}

async function main() {
  console.log("PROTOTYPE — NOT PRODUCTION: isolated native Claude channel test");
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error("Run this fixture manually in a real terminal; native channel consent cannot be automated.");
  if (process.platform !== "darwin" || !existsSync("/usr/bin/sandbox-exec") || !Bun.which("claude")) {
    throw Error("This bounded fixture requires macOS sandbox-exec and the already-installed Claude client.");
  }
  const observations: string[] = [];
  const prototype = new ChannelPrototype(message => observations.push(message));
  try {
    const prepared = prepare(prototype);
    console.log("No installation, real credentials, external network, or source-editing tools are used.");
    console.log("Accept only the disposable workspace, fixture API key, and review_feedback_prototype channel prompts.");
    console.log("The five synthetic conversation responses run automatically after consent; do not enter a work request.");
    console.log("The fixture stops within five minutes. Ctrl+C stops it early.");
    console.log(`Private fixture state (retained for inspection): ${prepared.home}`);
    const outcome = await nativeRun(prototype, prepared);
    for (const message of observations) console.log(message);
    console.log(`PROTOTYPE_RESULT ${JSON.stringify({ ...outcome, modelRequests: prototype.api.requests.length,
      mainRequests: prototype.mainRequests, auxiliaryRequests: prototype.auxiliaryRequests,
      mcpConnected: prototype.connected, notificationsWritten: prototype.written.size, requestFacts: prototype.requestFacts })}`);
    process.exitCode = outcome.passed ? 0 : 1;
  } finally { prototype.stop(); }
}

if (import.meta.main) await main().catch((error: Error) => {
  console.error(`PROTOTYPE — NOT PRODUCTION: ${error.message}`);
  process.exitCode = 1;
});
