import { expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeClaudeApi, toolResults } from "./fixtures/claude-api.ts";

const binary = fileURLToPath(new URL("../tools/evaluation/target/debug/evaluation", import.meta.url));
const reviewBinary = fileURLToPath(new URL("../tools/evaluation/target/debug/review-change", import.meta.url));
const consultBinary = fileURLToPath(new URL("../tools/evaluation/target/debug/consult", import.meta.url));
const sandbox = "/usr/bin/sandbox-exec";
const canRun = process.platform === "darwin" && existsSync(sandbox)
  && existsSync(binary) && existsSync(reviewBinary) && Bun.which("claude") && Bun.which("bun");

function profile(): string {
  const actualHome = homedir();
  // The reviewed binary now lives under .dotfiles/ai; protect personal state but allow its trusted source.
  const protectedPaths = [".claude", ".pi", ".ssh", ".aws", ".config/gcloud"];
  return `(version 1)(allow default)(deny network*)
    (allow network-inbound (local ip "localhost:*"))
    (allow network-outbound (remote ip "localhost:*"))
    (deny file-write* (subpath ${JSON.stringify(actualHome)}))
    (deny file-read* ${protectedPaths.map((path) => `(subpath ${JSON.stringify(join(actualHome, path))})`).join(" ")})`;
}

function isolatedEnvironment(root: string, home: string, port: number) {
  const xdg = join(root, "xdg");
  const temp = join(root, "tmp");
  mkdirSync(xdg);
  mkdirSync(temp);
  const bun = Bun.which("bun")!;
  return { HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"),
    PATH: `${dirname(realpathSync(bun))}:/opt/homebrew/bin:/usr/bin:/bin`,
    TMPDIR: temp, XDG_CONFIG_HOME: xdg, XDG_CACHE_HOME: join(xdg, "cache"),
    XDG_STATE_HOME: join(xdg, "state"), ANTHROPIC_API_KEY: "fixture-not-a-real-key",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_AUTOUPDATER: "1",
    DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", TERM: "dumb", LANG: "en_US.UTF-8" };
}

const claudeTest = canRun ? test : test.skip;
claudeTest("native Claude reviewer completes a scoped read through the installed restricted runner", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "native-claude-review-")));
  const home = join(root, "home");
  const snapshot = join(root, "snapshot");
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(snapshot);
  writeFileSync(join(snapshot, "source.txt"), "REVIEW_EVIDENCE_MARKER\n");
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true,
    projects: { [snapshot]: { hasTrustDialogAccepted: true } } }));
  const { server, requests } = startFakeClaudeApi([
    { name: "Read", input: { file_path: join(snapshot, "source.txt") } },
  ]);
  try {
    const env = isolatedEnvironment(root, home, server.port);
    const child = Bun.spawn([sandbox, "-p", profile(), binary, "reviewer", "--engine", "claude",
      "--snapshot", snapshot, "--prompt", "Read source.txt and summarize the evidence.",
      "--model", "claude-sonnet-4-6"],
    { cwd: snapshot, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 50_000);
    try {
      const [stdout, stderr, status] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ]);
      expect(status, stderr.slice(-600)).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject({ protocolVersion: 1, snapshot,
        response: "FIXTURE_COMPLETE", filesRead: ["source.txt"] });
      expect(requests.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(toolResults(requests.at(-1)!))).toContain("REVIEW_EVIDENCE_MARKER");
      expect(existsSync(join(root, ".state/pi"))).toBe(false);
    } finally { clearTimeout(timer); }
  } finally { server.stop(true); rmSync(root, { recursive: true, force: true }); }
}, 70_000);

claudeTest("restricted Claude refuses outside and symlink reads before the model sees their contents", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "native-claude-isolation-")));
  const home = join(root, "home");
  const snapshot = join(root, "snapshot");
  const secret = "SYNTHETIC_OUTSIDE_CONTENT_NOT_EVIDENCE";
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(snapshot);
  writeFileSync(join(root, "outside.txt"), secret);
  writeFileSync(join(snapshot, "source.txt"), "SAFE_EVIDENCE\n");
  symlinkSync(join(root, "outside.txt"), join(snapshot, "escape.txt"));
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true,
    projects: { [snapshot]: { hasTrustDialogAccepted: true } } }));
  const { server, requests } = startFakeClaudeApi([
    { name: "Read", input: { file_path: join(root, "outside.txt") } },
    { name: "Read", input: { file_path: join(snapshot, "escape.txt") } },
    { name: "Read", input: { file_path: join(snapshot, "source.txt") } },
  ]);
  try {
    const env = isolatedEnvironment(root, home, server.port);
    const child = Bun.spawn([sandbox, "-p", profile(), binary, "reviewer", "--engine", "claude",
      "--snapshot", snapshot, "--prompt", "Read the requested fixture files."],
    { cwd: snapshot, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 50_000);
    try {
      const [stdout, stderr, status] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ]);
      expect(status, stderr.slice(-600)).toBe(0);
      expect(JSON.parse(stdout).filesRead).toEqual(["source.txt"]);
      const results = toolResults(requests.at(-1)!);
      expect(results.map((result) => result.is_error)).toEqual([true, true, undefined]);
      expect(JSON.stringify(requests) + stdout).not.toContain(secret);
      expect(JSON.stringify(results[2])).toContain("SAFE_EVIDENCE");
    } finally { clearTimeout(timer); }
  } finally { server.stop(true); rmSync(root, { recursive: true, force: true }); }
}, 70_000);

claudeTest("Claude consultation uses a frozen snapshot without a Pi profile or old configuration", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "native-claude-consult-")));
  const home = join(root, "home");
  const source = join(root, "replacement");
  const repo = join(root, "repo");
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true,
    projects: { [repo]: { hasTrustDialogAccepted: true } } }));
  mkdirSync(join(source, "agents"), { recursive: true });
  mkdirSync(repo);
  copyFileSync(fileURLToPath(new URL("../reviewer.md", import.meta.url)),
    join(source, "reviewer.md"));
  copyFileSync(fileURLToPath(new URL("../agents/api-designer.md", import.meta.url)),
    join(source, "agents/api-designer.md"));
  const gitEnv = { HOME: home, PATH: "/opt/homebrew/bin:/usr/bin:/bin",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  const git = (args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: repo, env: gitEnv });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
  };
  git(["init", "-b", "main"]);
  writeFileSync(join(repo, "source.txt"), "FROZEN_CONSULT_MARKER\n");
  git(["add", "source.txt"]);
  git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
    "commit", "-m", "Fixture source"]);
  const { server, requests } = startFakeClaudeApi([
    { name: "Read", input: { file_path: "scope.json" } },
    { name: "Read", input: { file_path: "after/source.txt" } },
  ]);
  try {
    const env = isolatedEnvironment(root, home, server.port);
    const child = Bun.spawn([sandbox, "-p", profile(), consultBinary, "--root", source,
      "--engine", "claude", "--agent", "api-designer", "--repo", repo,
      "--prompt", "Review the frozen source."],
    { cwd: repo, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 50_000);
    try {
      const [stdout, stderr, status] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ]);
      expect(status, stderr.slice(-600)).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject({ protocolVersion: 1,
        response: "FIXTURE_COMPLETE", filesRead: ["after/source.txt", "scope.json"] });
      expect(JSON.stringify(toolResults(requests.at(-1)!))).toContain("FROZEN_CONSULT_MARKER");
      expect(existsSync(join(source, ".state/pi"))).toBe(false);
    } finally { clearTimeout(timer); }
  } finally { server.stop(true); rmSync(root, { recursive: true, force: true }); }
}, 70_000);

claudeTest("Claude change review retains a local report without Pi or publishing", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "native-claude-change-")));
  const home = join(root, "home");
  const source = join(root, "replacement");
  const repo = join(root, "repo");
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true,
    projects: { [repo]: { hasTrustDialogAccepted: true } } }));
  mkdirSync(join(source, "agents"), { recursive: true });
  mkdirSync(repo);
  copyFileSync(fileURLToPath(new URL("../reviewer.md", import.meta.url)),
    join(source, "reviewer.md"));
  copyFileSync(fileURLToPath(new URL("../agents/change-reviewer.md", import.meta.url)),
    join(source, "agents/change-reviewer.md"));
  const gitEnv = { HOME: home, PATH: "/opt/homebrew/bin:/usr/bin:/bin",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  const git = (args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: repo, env: gitEnv });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
  };
  git(["init", "-b", "main"]);
  writeFileSync(join(repo, "source.txt"), "before\n");
  git(["add", "source.txt"]);
  const commit = (message: string) => git(["-c", "user.name=Fixture",
    "-c", "user.email=fixture@example.invalid", "commit", "-am", message]);
  commit("Fixture base");
  writeFileSync(join(repo, "source.txt"), "FROZEN_REVIEW_MARKER\n");
  commit("Fixture change");
  const answer = JSON.stringify({ summary: "Scoped review.", risk: "low",
    uncertainties: ["Tests were not run."], findings: [] });
  const { server, requests } = startFakeClaudeApi([
    { name: "Read", input: { file_path: "scope.json" } },
    { name: "Read", input: { file_path: "patch.diff" } },
  ], answer);
  try {
    const env = isolatedEnvironment(root, home, server.port);
    const child = Bun.spawn([sandbox, "-p", profile(), reviewBinary, "--root", source,
      "review", "range", "HEAD~1..HEAD", "--engine", "claude", "--repo", repo,
      "--intent", "Review the fixture change.", "--json"],
    { cwd: repo, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 50_000);
    try {
      const [stdout, stderr, status] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ]);
      expect(status, stderr.slice(-600)).toBe(0);
      const receipt = JSON.parse(stdout);
      expect(receipt).toMatchObject({ protocolVersion: 1, findingCount: 0,
        publication: "local-only" });
      const record = JSON.parse(readFileSync(receipt.record, "utf8"));
      expect(record).toMatchObject({ summary: "Scoped review.",
        files_read: ["patch.diff", "scope.json"] });
      expect(JSON.stringify(toolResults(requests.at(-1)!))).toContain("FROZEN_REVIEW_MARKER");
      expect(existsSync(join(source, ".state/pi"))).toBe(false);
    } finally { clearTimeout(timer); }
  } finally { server.stop(true); rmSync(root, { recursive: true, force: true }); }
}, 70_000);
