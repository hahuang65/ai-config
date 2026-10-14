import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { startFakeClaudeApi, toolResults } from "./fixtures/claude-api";

const claude = Bun.which("claude");
const runtimeTest = process.platform === "darwin" && claude && existsSync("/usr/bin/sandbox-exec") ? test : test.skip;
runtimeTest.each(["external", "native"])("native Claude carries, leaves, and checks re-entry permissions for %s task paths", async (layout) => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "claude-transition-")));
  const root = join(home, "project");
  mkdirSync(root);
  mkdirSync(join(home, ".claude/hooks"), { recursive: true });
  const source = join(home, "source");
  for (const path of ["harnesses/claude/worktree.ts", "harnesses/worktree-client.ts", "tools/worktree/target/release/wt"]) {
    mkdirSync(dirname(join(source, path)), { recursive: true });
    cpSync(resolve(path), join(source, path));
  }
  symlinkSync(join(source, "harnesses/claude/worktree.ts"), join(home, ".claude/hooks/worktree.ts"));
  const manifest = JSON.parse(readFileSync(resolve("manifest.json"), "utf8"));
  const hooks = Object.fromEntries(manifest.settings.filter(s => s.path[0] === "hooks" &&
    s.value.hooks?.[0].command === "bun ~/.claude/hooks/worktree.ts").map(s => [s.path[1], [s.value]]));
  writeFileSync(join(home, ".claude/settings.json"), JSON.stringify({ hooks }));
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true,
    projects: { [root]: { hasTrustDialogAccepted: true } } }));
  const treeRoot = layout === "native" ? join(root, ".claude/worktrees") : join(home, "trees");
  const target = join(treeRoot, "project/feature");
  const env = { HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), WT_ROOT: treeRoot,
    PATH: `${dirname(realpathSync(Bun.which("bun")!))}:/opt/homebrew/bin:/usr/bin:/bin`,
    ANTHROPIC_API_KEY: "disposable-fixture", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1",
    GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", TERM: "dumb", LANG: "en_US.UTF-8" };
  for (const args of [["init", "-b", "main"], ["config", "user.name", "Test User"],
    ["config", "user.email", "test@example.invalid"], ["commit", "--allow-empty", "-m", "initial"]]) {
    expect(Bun.spawnSync(["git", ...args], { cwd: root, env }).exitCode).toBe(0);
  }
  writeFileSync(join(root, ".git/info/exclude"), ".claude/worktrees/\n");
  const profile = `(version 1)(allow default)(deny network*)
    (allow network-inbound (local ip "localhost:*"))(allow network-outbound (remote ip "localhost:*"))
    (deny file-write* (subpath ${JSON.stringify(homedir())}))
    (deny file-read* ${[".claude", ".pi", ".ssh", ".aws", ".config/gcloud", ".dotfiles/ai"]
      .map(p => `(subpath ${JSON.stringify(join(homedir(), p))})`).join(" ")})`;
  async function run(port: number, args: string[]) {
    const child = Bun.spawn(["/usr/bin/sandbox-exec", "-p", profile, claude!, "--permission-mode", "dontAsk",
      "--allowedTools", "EnterWorktree,ExitWorktree,Bash", "--model", "claude-sonnet-4-6", "--verbose", "--output-format", "stream-json",
      ...args], { cwd: root, env: { ...env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` }, stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 45_000);
    try {
      const [output, error, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(status, error).toBe(0);
      return output.split("\n").filter(Boolean).map(line => JSON.parse(line));
    } finally { clearTimeout(timer); }
  }
  const calls = [{ name: "EnterWorktree", input: { name: "feature" } }, { name: "Bash", input: { command: "pwd -P" } }];
  try {
    const first = startFakeClaudeApi(calls);
    let id: string;
    try {
      const events = await run(first.server.port, ["-p", "CARRY_CLAUDE_HISTORY"]);
      id = events.find(e => e.subtype === "init").session_id;
      expect(first.requests).toHaveLength(3); // Initial turn, automatic post-entry turn, post-Bash turn.
      expect(JSON.stringify(first.requests[1]).split("[WT continuation v1]").length - 1).toBe(1);
      const results = toolResults(first.requests.at(-1)!);
      expect(results).toHaveLength(2);
      for (const result of results) expect(result.is_error, JSON.stringify(results)).not.toBe(true);
      expect(JSON.stringify(results.at(-1))).toContain(target);
    } finally { first.server.stop(true); }
    const saved = Bun.spawnSync([join(source, "tools/worktree/target/release/wt"), "session", "inspect", "feature", "--harness", "claude"], { cwd: root, env });
    expect(saved.exitCode, saved.stderr.toString()).toBe(0);
    expect(JSON.parse(saved.stdout.toString()).conversation).toBe(id!);
    const second = startFakeClaudeApi([...calls, { name: "Bash", input: { command: "pwd -P" } }]);
    try {
      await run(second.server.port, ["--resume", id!, "-p", "RESUME_CLAUDE_HISTORY"]);
      expect(JSON.stringify(second.requests)).toContain("CARRY_CLAUDE_HISTORY");
      expect(second.requests).toHaveLength(2); // Resume itself must not replay a continuation.
      expect(JSON.stringify(second.requests.at(-1)).split("[WT continuation v1]").length - 1).toBe(1);
      const results = toolResults(second.requests.at(-1)!);
      expect(results).toHaveLength(3);
      expect(results.at(-1)?.is_error, JSON.stringify(results)).not.toBe(true);
      expect(JSON.stringify(results.at(-1))).toContain(target);
    } finally { second.server.stop(true); }
    const leaveCalls = [...calls, { name: "Bash", input: { command: "pwd -P" } },
      { name: "ExitWorktree", input: { action: "keep" } }, { name: "Bash", input: { command: "pwd -P" } }];
    const leave = startFakeClaudeApi(leaveCalls);
    try {
      await run(leave.server.port, ["--resume", id!, "-p", "LEAVE_CLAUDE_HISTORY"]);
      expect(leave.requests).toHaveLength(3);
      expect(JSON.stringify(leave.requests[1]).split("[WT continuation v1]").length - 1).toBe(2);
      const results = toolResults(leave.requests.at(-1)!);
      expect(results).toHaveLength(5);
      expect(results.at(-1)?.is_error, JSON.stringify(results)).not.toBe(true);
      expect(JSON.stringify(results.at(-1))).toContain(root);
      expect(existsSync(target)).toBe(true);
    } finally { leave.server.stop(true); }
    const reenter = startFakeClaudeApi([...leaveCalls,
      { name: "EnterWorktree", input: { path: target } },
      { name: "Bash", input: { command: "pwd -P" } }]);
    try {
      await run(reenter.server.port, ["--resume", id!, "-p", "REENTER_CLAUDE_HISTORY"]);
      expect(reenter.requests).toHaveLength(3);
      expect(JSON.stringify(reenter.requests[1]).split("[WT continuation v1]").length - 1)
        .toBe(layout === "external" ? 2 : 3); // Permission denial adds no continuation.
      const results = toolResults(reenter.requests.at(-1)!);
      expect(results).toHaveLength(7);
      if (layout === "external") {
        expect(results.at(-2)?.is_error).toBe(true);
        expect(JSON.stringify(results.at(-2))).toContain("Permission to use EnterWorktree has been denied");
      } else {
        expect(results.at(-2)?.is_error, JSON.stringify(results)).not.toBe(true);
      }
      expect(results.at(-1)?.is_error, JSON.stringify(results)).not.toBe(true);
      expect(JSON.stringify(results.at(-1))).toContain(layout === "external" ? root : target);
      expect(JSON.stringify(reenter.requests)).toContain("LEAVE_CLAUDE_HISTORY");
    } finally { reenter.server.stop(true); }
  } finally { rmSync(home, { recursive: true, force: true }); }
}, 200_000);
