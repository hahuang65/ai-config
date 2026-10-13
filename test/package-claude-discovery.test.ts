import { expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeClaudeApi, toolResults } from "./fixtures/claude-api.ts";
import { copyPackageFiles } from "./fixtures/inactive-package.ts";

const CLAUDE = Bun.which("claude");
const SANDBOX = "/usr/bin/sandbox-exec";
const canRun = process.platform === "darwin" && CLAUDE && existsSync(SANDBOX);
const INSTALLER = fileURLToPath(new URL("../tools/evaluation/target/debug/ai-config", import.meta.url));
const PRIVATE_MARKER = "SYNTHETIC_PRIVATE_MARKER";
const ALLOWED_MARKER = "BENIGN_MARKER";
const PROCESS_TIMEOUT_MS = 50_000;

function disposableHome(root: string, guarded: boolean) {
  const home = join(root, "home");
  const project = join(home, "project");
  const config = join(home, ".claude");
  const privatePath = join(home, ".aws/credentials");
  const allowedPath = join(project, "allowed.txt");
  mkdirSync(join(home, ".aws"), { recursive: true });
  mkdirSync(config, { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(privatePath, PRIVATE_MARKER);
  writeFileSync(allowedPath, ALLOWED_MARKER);
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true,
    projects: { [project]: { hasTrustDialogAccepted: true } } }));
  if (guarded) {
    const source = join(root, "replacement");
    copyPackageFiles(source);
    mkdirSync(join(config, "hooks"));
    symlinkSync(join(source, "harnesses/claude/guard.ts"), join(config, "hooks/guard.ts"));
    writeFileSync(join(config, "settings.json"), JSON.stringify({ hooks: { PreToolUse: [
      { hooks: [{ type: "command", command: "bun ~/.claude/hooks/guard.ts", timeout: 10 }] },
    ] } }));
  }
  return { home, project, privatePath, allowedPath };
}

function linkedCommitSkill(root: string, home: string) {
  const packageRoot = fileURLToPath(new URL("../", import.meta.url));
  const source = join(root, "replacement/skills/commit");
  const skills = join(home, ".claude/skills");
  cpSync(join(packageRoot, "skills/commit"), source, { recursive: true });
  const reviewSource = join(root, "replacement/skills/review-change");
  cpSync(join(packageRoot, "skills/review-change"), reviewSource, { recursive: true });
  mkdirSync(join(skills, "personal"), { recursive: true });
  writeFileSync(join(skills, "personal/SKILL.md"),
    "---\nname: personal\ndescription: Disposable personal skill.\n---\nTest only.\n");
  symlinkSync(source, join(skills, "commit"));
  symlinkSync(reviewSource, join(skills, "review-change"));
}

function sandboxProfile() {
  const actualHome = homedir();
  const protectedPaths = [".claude", ".pi", ".ssh", ".aws", ".config/gcloud", ".dotfiles/ai"];
  return `(version 1)(allow default)(deny network*)
    (allow network-inbound (local ip "localhost:*"))
    (allow network-outbound (remote ip "localhost:*"))
    (deny file-write* (subpath ${JSON.stringify(actualHome)}))
    (deny file-read* ${protectedPaths.map((path) => `(subpath ${JSON.stringify(join(actualHome, path))})`).join(" ")})`;
}

async function runClaude(root: string, home: string, project: string, port: number,
  prompt = "Read the requested local fixture paths.", debugFile?: string, agent?: string) {
  const temp = join(root, "tmp");
  const xdg = join(root, "xdg");
  mkdirSync(temp, { recursive: true });
  mkdirSync(xdg, { recursive: true });
  const bun = Bun.which("bun");
  if (!bun || !CLAUDE) throw new Error("Claude and Bun must be installed");
  const env = { HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"),
    PATH: `${dirname(realpathSync(bun))}:/opt/homebrew/bin:/usr/bin:/bin`,
    TMPDIR: temp, XDG_CONFIG_HOME: xdg, XDG_CACHE_HOME: join(xdg, "cache"),
    XDG_STATE_HOME: join(xdg, "state"), ANTHROPIC_API_KEY: "fixture-not-a-real-key",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_AUTOUPDATER: "1",
    DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", TERM: "dumb", LANG: "en_US.UTF-8" };
  const child = Bun.spawn([SANDBOX, "-p", sandboxProfile(), CLAUDE,
    "--no-session-persistence", "--permission-mode", "dontAsk", "--allowedTools", "Read",
    "--model", "claude-sonnet-4-6", "--output-format", "stream-json", "--verbose",
    ...(agent ? ["--agent", agent] : []),
    ...(debugFile ? ["--debug-file", debugFile] : []), "-p", prompt],
  { cwd: project, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill("SIGKILL"), PROCESS_TIMEOUT_MS);
  try {
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect(status, stderr.slice(-400)).toBe(0);
    return stdout;
  } finally { clearTimeout(timer); }
}

const claudeTest = canRun ? test : test.skip;
const installedTest = canRun && existsSync(INSTALLER) ? test : test.skip;
installedTest("public MVP installation loads the five evaluation agents and skills alongside personal skills", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "native-claude-package-")));
  try {
    const { home, project } = disposableHome(root, false);
    const source = join(root, "replacement");
    copyPackageFiles(source);
    for (const binary of ["tools/worktree/target/release/wt", "tools/worklog/target/release/wl",
      "tools/artifact-review/target/release/artifact-review", "tools/evaluation/target/release/review-change-eval"]) {
      const path = join(source, binary);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "#!/bin/sh\nexit 0\n");
      chmodSync(path, 0o755);
    }
    const personal = join(home, ".claude/skills/personal/SKILL.md");
    mkdirSync(dirname(personal), { recursive: true });
    writeFileSync(personal, "---\nname: personal\ndescription: Fixture.\n---\nTest only.\n");
    const installed = Bun.spawnSync([INSTALLER, "--root", realpathSync(source), "install"], {
      env: { HOME: home, PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" },
      stdout: "pipe", stderr: "pipe",
    });
    expect(installed.exitCode, installed.stderr.toString()).toBe(0);
    const { server } = startFakeClaudeApi([]);
    let stdout: string;
    const debugFile = join(root, "claude-debug.log");
    try { stdout = await runClaude(root, home, project, server.port,
      "Read the requested local fixture paths.", debugFile); }
    finally { server.stop(true); }
    const debug = readFileSync(debugFile, "utf8");
    expect(debug).not.toMatch(/CLAUDE_CODE_PLUGIN_DIRS: skipped/);
    expect(debug).toContain("Registered diagnostics handler for plugin:ai-local-lsp:ty");
    expect(debug).toContain("Registered diagnostics handler for plugin:ai-local-lsp:ruby");
    const events = stdout.split("\n").flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
    const init = events.find((event) => event.subtype === "init");
    expect(init?.skills).toContain("personal");
    for (const name of ["3d", "code", "commit", "model-domain", "review-change", "work-log"]) {
      expect(init?.skills).toContain(name);
    }
    expect(init?.slash_commands).toContain("deliver");
    expect(init?.slash_commands).toContain("rebase");
    for (const name of ["api-designer", "change-reviewer", "database-reviewer",
      "fact-checker", "frontend-architect"]) {
      expect(init?.agents).toContain(name);
    }
    for (const name of ["architecture-reviewer", "change-fixer", "refactorer", "tdd-guide"]) {
      expect(init?.agents).not.toContain(name);
    }
    expect(existsSync(join(home, ".claude/plugins/ai-worktree"))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 100_000);
claudeTest("a natively discovered specialist exposes only read tools to Claude", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "native-claude-agent-tools-")));
  try {
    const { home, project } = disposableHome(root, false);
    const source = join(root, "replacement/agents/api-designer.md");
    const destination = join(home, ".claude/agents/api-designer.md");
    mkdirSync(dirname(source), { recursive: true });
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(fileURLToPath(new URL("../agents/api-designer.md", import.meta.url)), source);
    symlinkSync(source, destination);
    const { server } = startFakeClaudeApi([]);
    let stdout: string;
    try { stdout = await runClaude(root, home, project, server.port,
      "Summarize the provided local fixture.", undefined, "api-designer"); }
    finally { server.stop(true); }
    const events = stdout.split("\n").flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
    const initialized = events.find((event) => event.subtype === "init");
    expect(initialized?.tools).toContain("Read");
    expect(initialized?.tools).toContain("Grep");
    expect(initialized?.tools).toContain("Glob");
    expect(initialized?.tools).not.toContain("Write");
    expect(initialized?.tools).not.toContain("Edit");
    expect(initialized?.tools).not.toContain("Bash");
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 70_000);

claudeTest("ordinary Claude discovers a replacement-owned skill and retains personal skills", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "native-claude-skill-")));
  try {
    const { home, project } = disposableHome(root, false);
    linkedCommitSkill(root, home);
    const { server } = startFakeClaudeApi([]);
    let stdout: string;
    try { stdout = await runClaude(root, home, project, server.port); }
    finally { server.stop(true); }
    const events = stdout.split("\n").flatMap((line) => {
      try { return [JSON.parse(line)]; }
      catch { return []; }
    });
    const initialized = events.find((event) => event.subtype === "init");
    expect(initialized?.skills).toContain("commit");
    expect(initialized?.skills).toContain("review-change");
    expect(initialized?.skills).toContain("personal");
    const skill = readFileSync(join(root, "replacement/skills/review-change/SKILL.md"), "utf8");
    expect(skill).toContain("--engine ENGINE");
    expect(skill).toContain("matching the current host");
    expect(skill).not.toContain("~/.dotfiles/ai");
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 70_000);

claudeTest("ordinary Claude loads the linked native hook and blocks a real Read while retaining harmless reads", async () => {
  for (const guarded of [false, true]) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "native-claude-home-")));
    try {
      const { home, project, privatePath, allowedPath } = disposableHome(root, guarded);
      const { server, requests } = startFakeClaudeApi([privatePath, allowedPath].map((path) => ({ name: "Read", input: { file_path: path } })));
      let stdout: string;
      try { stdout = await runClaude(root, home, project, server.port); }
      finally { server.stop(true); }
      expect(requests.length).toBeGreaterThanOrEqual(3);
      const results = toolResults(requests.at(-1)!);
      expect(results).toHaveLength(2);
      const privateResult = JSON.stringify(results[0]);
      if (guarded) {
        expect(privateResult).toContain("credential file read");
        expect(results[0].is_error).toBe(true);
        expect(JSON.stringify(requests) + stdout).not.toContain(PRIVATE_MARKER);
      } else {
        expect(privateResult).toContain(PRIVATE_MARKER);
      }
      expect(JSON.stringify(results[1])).toContain(ALLOWED_MARKER);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
}, 120_000);
