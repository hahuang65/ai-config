import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { startFakeClaudeApi, toolResults, type FixtureCall } from "./claude-api";

export function worklogRuntime() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "claude-worklog-")));
  const root = join(home, "project");
  mkdirSync(root);
  mkdirSync(join(home, "bin"));
  mkdirSync(join(home, ".claude"));
  cpSync(resolve("tools/worklog/target/release/wl"), join(home, "bin/worklog"));
  writeFileSync(join(home, ".claude/settings.json"), "{}"); // No custom hooks: exercise native isolation.
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true,
    projects: { [root]: { hasTrustDialogAccepted: true } } }));
  const env = { HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), WL_ROOT: join(home, "state"),
    PATH: `${join(home, "bin")}:${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin`,
    ANTHROPIC_API_KEY: "disposable-fixture", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1",
    GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", TERM: "dumb", LANG: "en_US.UTF-8" };
  try {
    for (const args of [["init", "-b", "main"], ["config", "user.name", "Test User"],
      ["config", "user.email", "test@example.invalid"], ["commit", "--allow-empty", "-m", "initial"]]) {
      const result = Bun.spawnSync(["git", ...args], { cwd: root, env });
      if (result.exitCode) throw new Error(result.stderr.toString());
    }
    writeFileSync(join(root, ".git/info/exclude"), ".claude/worktrees/\n");
    return { home, root, env, dispose: () => rmSync(home, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(home, { recursive: true, force: true });
    throw error;
  }
}

export async function runWorklogRuntime(fixture: ReturnType<typeof worklogRuntime>, calls: FixtureCall[]) {
  const profile = `(version 1)(allow default)(deny network*)
    (allow network-inbound (local ip "localhost:*"))(allow network-outbound (remote ip "localhost:*"))
    (deny file-write* (subpath ${JSON.stringify(homedir())}))
    (deny file-read* ${[".claude", ".pi", ".ssh", ".aws", ".worklog", ".config/gcloud", ".dotfiles/ai"]
      .map(path => `(subpath ${JSON.stringify(join(homedir(), path))})`).join(" ")})`;
  const api = startFakeClaudeApi(calls);
  try {
    const child = Bun.spawn(["/usr/bin/sandbox-exec", "-p", profile, Bun.which("claude")!,
      "--permission-mode", "dontAsk", "--allowedTools", "EnterWorktree,Bash", "--model", "claude-sonnet-4-6",
      "--verbose", "--output-format", "stream-json", "-p", "Run the synthetic Worklog compatibility fixture."],
    { cwd: fixture.root, env: { ...fixture.env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.server.port}` }, stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 45_000);
    try {
      const [output, error, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      if (status !== 0) throw new Error(`Claude fixture failed (${status}): ${error.slice(0, 2000)} ${output.slice(-2000)}`);
      const results = toolResults(api.requests.at(-1) ?? {});
      if (results.length !== calls.length) throw new Error(`Incomplete Claude fixture: ${results.length}/${calls.length} tool results`);
      return results;
    } finally { clearTimeout(timer); }
  } finally { api.server.stop(true); }
}
