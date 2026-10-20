import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { startFakeClaudeApi } from "./fixtures/claude-api";
import { feedbackScenario, startFeedbackClaude, until } from "./fixtures/review-feedback-claude";

const nativeTest = process.platform === "darwin" && Bun.which("claude") && existsSync("/usr/bin/sandbox-exec") ? test : test.skip;
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
const cli = resolve("tools/artifact-review/target/release/review-artifact");

function configure(home: string) {
  const hooksDirectory = join(home, ".claude/hooks");
  mkdirSync(hooksDirectory, { recursive: true });
  const installed = join(hooksDirectory, "review-feedback.ts");
  symlinkSync(resolve("harnesses/claude/review-feedback.ts"), installed);
  const command = `${quote(process.execPath)} ${quote(installed)}`;
  const manifest = JSON.parse(readFileSync(resolve("manifest.json"), "utf8"));
  const hooks: Record<string, unknown[]> = {};
  for (const setting of manifest.settings.filter(setting => setting.path[0] === "hooks"
    && setting.value.hooks?.[0].command.startsWith("bun ~/.claude/hooks/review-feedback.ts"))) {
    (hooks[setting.path[1]] ??= []).push({ ...setting.value, hooks: setting.value.hooks.map(hook => ({ ...hook,
      command: command + hook.command.slice("bun ~/.claude/hooks/review-feedback.ts".length) })) });
  }
  writeFileSync(join(home, ".claude/settings.json"), JSON.stringify({ hooks }));
}

async function command(home: string, args: string[]) {
  const child = Bun.spawn([cli, ...args], { env: { HOME: home, AR_ROOT: join(home, "reviews") }, stdout: "pipe", stderr: "pipe" });
  const guard = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    const [output, errors, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (status !== 0) throw Error(`Feedback helper failed: ${errors}`);
    return JSON.parse(output);
  } finally { clearTimeout(guard); }
}

async function sendFeedback(home: string, artifact: string, revision: string) {
  const hash = new Bun.CryptoHasher("sha256").update(artifact).digest("hex");
  const descriptor = await Bun.file(join(home, "reviews", hash, "server.json")).json();
  const origin = `http://127.0.0.1:${descriptor.port}`;
  const response = await fetch(`${origin}/submit`, { method: "POST", headers: {
    authorization: `Bearer ${descriptor.capability}`, origin, "content-type": "application/json",
  }, body: JSON.stringify({ id: "claude-idle-feedback-0001", action: "feedback", revision, message: "Explain the synthetic review", annotations: [] }) });
  expect(response.status).toBe(200);
}

function workspaceScenario() {
  const scenario = { ...feedbackScenario(), tools: "Bash,EnterWorktree,ExitWorktree" };
  const task = join(scenario.root, ".claude/worktrees/feedback");
  mkdirSync(join(scenario.root, ".claude/worktrees"), { recursive: true });
  const env = { PATH: process.env.PATH, HOME: scenario.home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  for (const args of [["init", "-b", "main"], ["config", "user.name", "Fixture"],
    ["config", "user.email", "fixture@example.invalid"], ["add", "review.html"],
    ["commit", "-m", "fixture"], ["worktree", "add", "-b", "feedback", task]]) {
    const result = Bun.spawnSync(["git", "-C", scenario.root, ...args], { env });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  }
  scenario.artifact = join(task, "review.html");
  configure(scenario.home);
  return { ...scenario, task };
}

function workspaceApi(scenario: ReturnType<typeof workspaceScenario>, owner: () => string) {
  let returning = false;
  let claimed = false;
  const api = startFakeClaudeApi([], "WORKSPACE_REPLY", { additionalTurns: 12, nextCall(request, count) {
    if (count === 1 || returning && count === 5) return { name: "EnterWorktree", input: { path: scenario.task } };
    if (count === 2) return { name: "Bash", input: { command: [cli, "open", scenario.artifact, "--no-browser"].map(quote).join(" ") } };
    if (count === 3) return { name: "ExitWorktree", input: { action: "keep" } };
    if (returning && !claimed && JSON.stringify(request).includes("Use this literal command to read and claim")) {
      claimed = true;
      return { name: "Bash", input: { command: [cli, "claim", scenario.artifact, "--harness", "claude",
        "--conversation", owner(), "--workspace", scenario.task].map(quote).join(" ") } };
    }
  } });
  return { ...api, reenter() { returning = true; } };
}

nativeTest("Claude defers task feedback while away and completes it after native worktree re-entry", async () => {
  const scenario = workspaceScenario();
  let owner: string;
  const api = workspaceApi(scenario, () => owner);
  const run = startFeedbackClaude(scenario, api.server.port);
  const poll = () => command(scenario.home, ["poll", scenario.artifact, "--timeout", "0"]);
  try {
    run.send("OPEN_REVIEW_THEN_LEAVE_TASK");
    await until(() => run.output().includes('"type":"result"'), run.output);
    owner = /"session_id":"([a-zA-Z0-9-]+)"/.exec(run.output())![1];
    let state = await poll();
    const deadline = Date.now() + 10_000;
    while (state.processing.responder !== "claude" && Date.now() < deadline) { await Bun.sleep(50); state = await poll(); }
    expect(state.processing.responder).toBe("claude");
    expect(api.requests).toHaveLength(4);
    await sendFeedback(scenario.home, scenario.artifact, state.current_revision);
    await Bun.sleep(1200);
    expect(api.requests).toHaveLength(4);
    expect((await poll()).processing.state).toBe("queued");
    api.reenter();
    run.send("RETURN_TO_REVIEW_WORKSPACE");
    await until(() => run.output().includes("Use this literal command to read and claim") || api.requests.length >= 7, run.output);
    const answered = Date.now() + 10_000;
    do { state = await poll(); if (state.processing.state === "answered") break; await Bun.sleep(50); } while (Date.now() < answered);
    expect(state.processing.state).toBe("answered");
    expect(state.events.filter(event => event.action === "reply").map(event => event.message)).toEqual(["WORKSPACE_REPLY"]);
  } finally {
    await command(scenario.home, ["stop", scenario.artifact]).catch(() => {});
    await run.stop();
    api.server.stop(true);
  }
}, 60_000);

nativeTest("native Claude feedback returns the Markdown reply before processing queued unrelated prompts", async () => {
  const scenario = { ...feedbackScenario(), tools: "Bash" };
  configure(scenario.home);
  let owner: string;
  let processing = false;
  let release: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const api = startFakeClaudeApi([], "FIXTURE_COMPLETE", { additionalTurns: 6, async onRequest(_request, count) {
    if (count === 4) { processing = true; await gate; return "- REVIEW_REPLY"; }
    if (count === 5) return "UNRELATED_REPLY";
  }, nextCall(_request, count) {
    if (count === 1) return { name: "Bash", input: { command: `printf '%s\\n' 'Synthetic review generated'; ` + [cli, "open", scenario.artifact, "--no-browser"].map(quote).join(" ") } };
    if (count === 3) return { name: "Bash", input: { command: [cli, "claim", scenario.artifact, "--harness", "claude", "--conversation", owner,
      "--workspace", scenario.root].map(quote).join(" ") } };
  } });
  const run = startFeedbackClaude(scenario, api.server.port);
  const poll = () => command(scenario.home, ["poll", scenario.artifact, "--timeout", "0"]);
  try {
    run.send("OPEN_SYNTHETIC_REVIEW");
    await until(() => run.output().includes('"type":"result"'), run.output);
    owner = /"session_id":"([a-zA-Z0-9-]+)"/.exec(run.output())![1];
    let state = await poll();
    const deadline = Date.now() + 10_000;
    while (state.processing.responder !== "claude" && Date.now() < deadline) { await Bun.sleep(50); state = await poll(); }
    expect(state.processing.responder).toBe("claude");
    await sendFeedback(scenario.home, scenario.artifact, state.current_revision);
    await until(() => processing, run.output);
    expect((await poll()).processing.state).toBe("working");
    run.send("UNRELATED_USER_REQUEST");
    await Bun.sleep(300);
    expect(api.requests).toHaveLength(4);
    expect((await poll()).processing.state).toBe("working");
    release!();
    await until(() => api.requests.length >= 5, run.output);
    state = await poll();
    const answered = Date.now() + 10_000;
    while (state.processing.state !== "answered" && Date.now() < answered) { await Bun.sleep(50); state = await poll(); }
    expect(state.processing.state).toBe("answered");
    const replies = state.events.filter((event: { action: string }) => event.action === "reply");
    expect(replies).toHaveLength(1);
    expect(replies[0].message).toBe("- REVIEW_REPLY");
  } finally {
    release!();
    await command(scenario.home, ["stop", scenario.artifact]).catch(() => {});
    await run.stop();
    api.server.stop(true);
  }
}, 50_000);
