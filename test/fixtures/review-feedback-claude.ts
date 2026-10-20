import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

export async function until(condition: () => boolean, evidence: () => string) {
  const deadline = Date.now() + 20_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw Error(`Native feedback delivery timed out: ${evidence()}`);
    await Bun.sleep(25);
  }
}

export function feedbackScenario(timeout = 30) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "review-feedback-claude-")));
  const root = join(home, "project");
  mkdirSync(root);
  mkdirSync(join(home, ".claude"));
  const marker = join(home, "feedback-ready");
  const hook = join(home, "wait-feedback.mjs");
  const artifact = join(root, "review.html");
  writeFileSync(artifact, "<h1>Disposable review</h1>");
  writeFileSync(hook, `import { existsSync, writeFileSync } from 'node:fs';
    process.on('SIGTERM', () => { writeFileSync(${JSON.stringify(`${marker}.cancelled`)}, 'Native timeout cancelled the listener.'); process.exit(0); });
    for await (const _ of process.stdin) {}
    const deadline = Date.now() + 25000;
    while (!existsSync(${JSON.stringify(marker)})) {
      if (Date.now() > deadline) process.exit(1);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    console.error('REVIEW_FEEDBACK_NATIVE_WAKE');
    writeFileSync(${JSON.stringify(`${marker}.sent`)}, 'Hook returned feedback while the API request was held.');
    process.exit(2);`);
  writeFileSync(join(home, ".claude/settings.json"), JSON.stringify({ hooks: { PostToolUse: [{ matcher: "Read",
    hooks: [{ type: "command", command: `${JSON.stringify(Bun.which("node"))} ${JSON.stringify(hook)}`,
      asyncRewake: true, timeout }] }] } }));
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true,
    projects: { [root]: { hasTrustDialogAccepted: true } } }));
  return { home, root, marker, artifact };
}

export function renewalScenario() {
  const scenario = feedbackScenario();
  const hook = join(scenario.home, "renew-feedback.mjs");
  const counter = join(scenario.home, "renewals.json");
  writeFileSync(hook, `import { existsSync, readFileSync, writeFileSync } from 'node:fs';
    for await (const _ of process.stdin) {}
    const counter = ${JSON.stringify(counter)};
    const run = (existsSync(counter) ? JSON.parse(readFileSync(counter, 'utf8')) : 0) + 1;
    writeFileSync(counter, JSON.stringify(run));
    if (run > 3) process.exit(0);
    if (run < 3) {
      await new Promise(resolve => setTimeout(resolve, 150));
      console.error('REVIEW_FEEDBACK_RENEW: maintenance only, not human feedback or approval.');
      process.exit(2);
    }
    const deadline = Date.now() + 10000;
    while (!existsSync(${JSON.stringify(scenario.marker)})) {
      if (Date.now() > deadline) process.exit(1);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    console.error('REVIEW_FEEDBACK_AFTER_RENEWAL'); process.exit(2);`);
  writeFileSync(join(scenario.home, ".claude/settings.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{
    type: "command", command: `${JSON.stringify(Bun.which("node"))} ${JSON.stringify(hook)}`,
    asyncRewake: true, timeout: 15,
  }] }] } }));
  return { ...scenario, counter };
}

function sandboxProfile() {
  return `(version 1)(allow default)(deny network*)
    (allow network-inbound (local ip "localhost:*"))(allow network-outbound (remote ip "localhost:*"))
    (deny file-write* (subpath ${JSON.stringify(homedir())}))
    (deny file-read* ${[".claude", ".pi", ".ssh", ".aws", ".config/gcloud", ".dotfiles/ai"]
      .map(path => `(subpath ${JSON.stringify(join(homedir(), path))})`).join(" ")})`;
}

export function startFeedbackClaude(scenario: ReturnType<typeof feedbackScenario>, port: number) {
  const { root, home } = scenario;
  const tools = "tools" in scenario ? String(scenario.tools) : "Read";
  const child = Bun.spawn(["/usr/bin/sandbox-exec", "-p", sandboxProfile(), Bun.which("claude")!, "-p", "--permission-mode", "dontAsk",
    "--allowedTools", tools, "--tools", tools, "--model", "claude-sonnet-4-6", "--verbose",
    "--input-format", "stream-json", "--output-format", "stream-json"], { cwd: root, stdin: "pipe", stdout: "pipe", stderr: "pipe",
    env: { HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), PATH: `${dirname(realpathSync(Bun.which("node")!))}:${dirname(process.execPath)}:/usr/bin:/bin`,
      AR_ROOT: join(home, "reviews"),
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, ANTHROPIC_API_KEY: "disposable-fixture",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1",
      DISABLE_ERROR_REPORTING: "1", TERM: "dumb", LANG: "en_US.UTF-8" } });
  let output = "";
  const stdout = (async () => { for await (const chunk of child.stdout) output += new TextDecoder().decode(chunk); })();
  const stderr = new Response(child.stderr).text();
  const timer = setTimeout(() => child.kill("SIGKILL"), 45_000);
  return { output: () => output, send(content: string) {
    child.stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`);
    child.stdin.flush();
  }, async stop() {
    clearTimeout(timer);
    child.stdin.end();
    child.kill("SIGTERM");
    const kill = setTimeout(() => child.kill("SIGKILL"), 2_000);
    await child.exited;
    clearTimeout(kill);
    await stdout;
    await stderr;
    rmSync(home, { recursive: true, force: true });
  } };
}
