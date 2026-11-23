import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { projectPiExecutable } from "../tools/project-pi.mjs";
import { JEV_MODEL } from "../harnesses/jev-client";

function fixture() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "jev-hook-deadline-")));
  const cwd = join(home, "project"), bin = join(home, "bin"), agent = join(home, ".pi/agent");
  const directory = join(home, ".claude/projects/fixture"), late = join(home, "late-work"), ready = join(home, "ready");
  for (const path of [cwd, bin, agent, directory]) mkdirSync(path, { recursive: true });
  writeFileSync(join(cwd, "source.ts"), "KEEP_SOURCE\n");
  const session = "11111111-1111-4111-8111-111111111111", transcript = join(directory, `${session}.jsonl`);
  writeFileSync(transcript, JSON.stringify({ type: "user", sessionId: session, uuid: "u1", parentUuid: null,
    message: { role: "user", content: "Inspect the source without changing any files." } }) + "\n");
  const payload = { cwd, session_id: session, transcript_path: transcript,
    tool_name: "Write", tool_input: { file_path: join(cwd, "source.ts"), content: "changed" } };
  const env: NodeJS.ProcessEnv = { HOME: home, PATH: bin, CLAUDE_CONFIG_DIR: join(home, ".claude"), PI_CODING_AGENT_DIR: agent,
    AI_JEV_SCOPE: "1" };
  return { home, cwd, bin, agent, late, ready, payload, env, clean: () => rmSync(home, { recursive: true, force: true }) };
}

async function hook(f: ReturnType<typeof fixture>, interrupt = false) {
  const started = performance.now();
  const child = Bun.spawn([process.execPath, resolve("harnesses/claude/guard.ts")], { cwd: f.cwd, env: f.env,
    stdin: Buffer.from(JSON.stringify(f.payload)), stdout: "pipe", stderr: "pipe" });
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 7500);
  try {
    if (interrupt) {
      const deadline = Date.now() + 1000;
      while (!existsSync(f.ready) && Date.now() < deadline) await Bun.sleep(5);
      expect(existsSync(f.ready)).toBe(true);
      child.kill("SIGTERM");
    }
    const [code, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code, output, error, elapsed: performance.now() - started };
  } finally { clearTimeout(watchdog); }
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return process.platform !== "linux" || !readFileSync(`/proc/${pid}/stat`, "utf8").split(")").at(-1)!.trim().startsWith("Z ");
  } catch { return false; }
}

async function checkHook(f: ReturnType<typeof fixture>, interrupt = false) {
  const { code, output, error, elapsed } = await hook(f, interrupt);
  expect(code, error).toBe(0);
  const verdict = JSON.parse(output).hookSpecificOutput;
  expect(verdict.permissionDecision).toBe("deny");
  expect(verdict.permissionDecisionReason).toMatch(/clarif/i);
  expect(existsSync(f.ready)).toBe(true);
  expect(elapsed).toBeLessThan(6000);
  await Bun.sleep(1750);
  const pid = Number(readFileSync(f.ready, "utf8"));
  expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
  expect(existsSync(f.late)).toBe(false);
  expect(alive(pid)).toBe(false);
  expect(readFileSync(join(f.cwd, "source.ts"), "utf8")).toBe("KEEP_SOURCE\n");
}

test("the actual Claude hook excludes project Pi executables without inherited source context", async () => {
  const f = fixture();
  try {
    const bin = join(f.cwd, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "pi"), `#!${process.execPath}\nimport { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(f.ready)}, 'executed'); console.log('synthetic-version');\n`, { mode: 0o755 });
    const result = await hook({ ...f, env: { ...f.env, PATH: bin } });
    expect(result.code, result.error).toBe(0);
    expect(JSON.parse(result.output).hookSpecificOutput.permissionDecision).toBe("deny");
    expect(existsSync(f.ready)).toBe(false);
  } finally { f.clean(); }
}, 12000);

test.each(["nested", "symlink"])("the actual Claude hook excludes the repository root from a %s workspace", async kind => {
  const f = fixture();
  try {
    writeFileSync(join(f.cwd, ".git"), "gitdir: ../metadata\n");
    const nested = join(f.cwd, "deep/work"), bin = join(f.cwd, "bin");
    mkdirSync(nested, { recursive: true });
    mkdirSync(bin);
    let cwd = nested;
    if (kind === "symlink") { cwd = join(f.home, "workspace-alias"); symlinkSync(nested, cwd, "dir"); }
    writeFileSync(join(bin, "pi"), `#!${process.execPath}\nimport { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(f.ready)}, 'executed'); console.log('synthetic-version');\n`, { mode: 0o755 });
    const result = await hook({ ...f, cwd, payload: { ...f.payload, cwd }, env: { ...f.env, PATH: bin } });
    expect(result.code, result.error).toBe(0);
    expect(JSON.parse(result.output).hookSpecificOutput.permissionDecision).toBe("deny");
    expect(existsSync(f.ready)).toBe(false);
  } finally { f.clean(); }
}, 12000);

test("the actual Claude hook excludes project SDK entry aliases without inherited source context", async () => {
  const f = fixture();
  try {
    const sdk = join(f.home, "sdk");
    mkdirSync(join(sdk, "dist"), { recursive: true });
    writeFileSync(join(sdk, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "1.5.2", type: "module" }));
    writeFileSync(join(sdk, "dist/cli.js"), "fixture CLI\n", { mode: 0o755 });
    const entry = join(f.cwd, "entry.mjs");
    writeFileSync(entry, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(f.ready)}, 'executed'); throw Error('Synthetic SDK');`);
    symlinkSync(entry, join(sdk, "dist/index.js"));
    symlinkSync(join(sdk, "dist/cli.js"), join(f.bin, "pi"));
    const result = await hook(f);
    expect(result.code, result.error).toBe(0);
    expect(JSON.parse(result.output).hookSpecificOutput.permissionDecision).toBe("deny");
    expect(existsSync(f.ready)).toBe(false);
  } finally { f.clean(); }
}, 12000);

test("the actual Claude hook preserves inherited exclusions when adding its native workspace", async () => {
  const f = fixture();
  try {
    const inherited = join(f.home, "inherited-source");
    mkdirSync(inherited);
    const executable = join(inherited, "pi");
    writeFileSync(executable, `#!${process.execPath}\nimport { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(f.ready)}, 'executed'); console.log('synthetic-version');\n`, { mode: 0o755 });
    symlinkSync(executable, join(f.bin, "pi"));
    const result = await hook({ ...f, env: { ...f.env, AI_REVIEW_EXCLUDED_SOURCES: JSON.stringify([inherited]) } });
    expect(result.code, result.error).toBe(0);
    expect(JSON.parse(result.output).hookSpecificOutput.permissionDecision).toBe("deny");
    expect(existsSync(f.ready)).toBe(false);
  } finally { f.clean(); }
}, 12000);

test.each(["import", "initialization"])("the actual Claude hook bounds stalled SDK %s", async stage => {
  const f = fixture();
  try {
    const sdk = join(f.home, "sdk");
    mkdirSync(join(sdk, "dist"), { recursive: true });
    writeFileSync(join(sdk, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "1.5.2", type: "module" }));
    writeFileSync(join(sdk, "dist/cli.js"), "fixture CLI\n");
    const stall = `writeFileSync(${JSON.stringify(f.ready)}, String(process.pid)); const end = Date.now() + 6500; while (Date.now() < end) {} writeFileSync(${JSON.stringify(f.late)}, 'late'); throw Error('Synthetic SDK stall');`;
    writeFileSync(join(sdk, "dist/index.js"), `import { writeFileSync } from 'node:fs';\n${stage === "import" ? stall : `export const ModelRuntime = { create() { ${stall} } };`}`);
    writeFileSync(join(f.bin, "pi"), `#!/bin/sh\nexec "${join(sdk, "dist/cli.js")}" "$@"\n`, { mode: 0o755 });
    await checkHook(f);
  } finally { f.clean(); }
}, 12000);

test("the bounded actual Claude hook uses native authentication and returns no allow decision", async () => {
  const f = fixture(), requests: any[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json() as any;
    requests.push(body);
    return Response.json({ model: JEV_MODEL, answers: { drift: { type: "noul", noul: 0.01 } }, usage: { input_tokens: 80, output_tokens: 0 } });
  } });
  try {
    symlinkSync(projectPiExecutable(), join(f.bin, "pi"));
    writeFileSync(join(f.agent, "models.json"), JSON.stringify({ providers: { typesafe: { baseUrl: `http://127.0.0.1:${server.port}/v1`, apiKey: "fixture" } } }));
    const result = await hook(f);
    expect(result.code, result.error).toBe(0);
    expect(result.output).toBe("");
    expect(requests).toHaveLength(1);
    expect(requests[0].model).toBe(JEV_MODEL);
    expect(requests[0].state.user_requests).toEqual(["Inspect the source without changing any files."]);
    expect(requests[0].state.proposed_action).not.toHaveProperty("content");
  } finally { server.stop(true); f.clean(); }
}, 12000);

test.each([["deadline", false], ["SIGTERM", true]] as const)("the actual Claude hook stops stalled Pi discovery on %s", async (_label, interrupt) => {
  const f = fixture();
  try {
    writeFileSync(join(f.bin, "pi"), `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(f.ready)}, String(process.pid));\nsetTimeout(() => { writeFileSync(${JSON.stringify(f.late)}, 'late'); console.log('1.5.2'); }, 6500);\n`, { mode: 0o755 });
    await checkHook(f, interrupt);
  } finally { f.clean(); }
}, 12000);
