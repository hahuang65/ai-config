import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installedSdkFile } from "./fixtures/installed-pi-sdk";

const source = resolve(import.meta.dir, "..");

async function fixture(runtime?: string) {
  const root = mkdtempSync(join(tmpdir(), "guard-parser-init-"));
  const copy = join(root, "package"), agentDir = join(root, "home/.pi/agent"), cwd = join(root, "project");
  const clean = () => rmSync(root, { recursive: true, force: true });
  try {
    cpSync(join(source, "guard"), join(copy, "guard"), { recursive: true });
    cpSync(join(source, "harnesses/claude"), join(copy, "harnesses/claude"), { recursive: true });
    mkdirSync(join(copy, "harnesses/pi"), { recursive: true });
    cpSync(join(source, "harnesses/pi/guard-policies.ts"), join(copy, "harnesses/pi/guard-policies.ts"));
    if (runtime) {
      cpSync(join(copy, "guard/vendor/tree-sitter.mjs"), join(copy, "guard/vendor/real-tree-sitter.mjs"));
      writeFileSync(join(copy, "guard/vendor/tree-sitter.mjs"), runtime);
    }
    const bundle = await Bun.build({ entrypoints: [join(copy, "harnesses/pi/guard-policies.ts")], target: "node", format: "esm" });
    expect(bundle.success).toBe(true);
    await Bun.write(join(copy, "harnesses/pi/guard-policies.bundle.ts"), bundle.outputs[0]);
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    mkdirSync(cwd);
    symlinkSync(join(copy, "harnesses/pi/guard-policies.bundle.ts"), join(agentDir, "extensions/guard.ts"));
    const env = { ...process.env, HOME: join(root, "home"), PI_CODING_AGENT_DIR: agentDir };
    return { copy, clean, claude: () => spawnSync("bun", [join(copy, "harnesses/claude/guard.ts")], {
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git status --short" }, cwd }),
      encoding: "utf8", timeout: 5_000, env,
    }), pi: (delay?: string) => spawnSync("node", [join(source, "test/fixtures/guard-parser-loader.mjs"),
      installedSdkFile(), agentDir, cwd, ...(delay ? [delay] : [])], { cwd, encoding: "utf8", timeout: 7_000, env }) };
  } catch (error) { clean(); throw error; }
}

test("both native adapters emit refusals instead of waiting forever for parser initialization", async () => {
  const setup = await fixture("export class Parser { static init() { return new Promise(() => {}); } }\nexport class Language {}\n");
  try {
    const claude = setup.claude();
    expect(claude.status, claude.stderr).toBe(0);
    expect(JSON.parse(claude.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
    const pi = setup.pi();
    expect(pi.status, pi.stderr).toBe(0);
    expect(JSON.parse(pi.stdout)).toEqual({ errors: 0, handlers: 1, blocked: [true, true] });
  } finally { setup.clean(); }
}, 15_000);

test("a late successful grammar load cannot re-enable a timed-out Pi guard", async () => {
  const setup = await fixture(`import { Parser, Language as RealLanguage } from './real-tree-sitter.mjs';
export { Parser };
export class Language { static async load(bytes) {
  await new Promise(resolve => setTimeout(resolve, 1500));
  return RealLanguage.load(bytes);
} }
`);
  try {
    const pi = setup.pi("1000");
    expect(pi.status, pi.stderr).toBe(0);
    expect(JSON.parse(pi.stdout)).toEqual({ errors: 0, handlers: 1, blocked: [true, true], blockedAfterDelay: true });
  } finally { setup.clean(); }
}, 15_000);

for (const kind of ["FIFO", "oversized"]) {
  test(`both adapters refuse ${kind} WASM assets without hanging`, async () => {
    const setup = await fixture();
    try {
      const grammar = join(setup.copy, "guard/vendor/tree-sitter-bash.wasm");
      rmSync(grammar);
      if (kind === "FIFO") expect(spawnSync("mkfifo", [grammar]).status).toBe(0);
      else writeFileSync(grammar, Buffer.alloc(2 * 1024 * 1024 + 1));
      const claude = setup.claude();
      expect(claude.status, claude.stderr).toBe(0);
      expect(JSON.parse(claude.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
      const pi = setup.pi();
      expect(pi.status, pi.stderr).toBe(0);
      expect(JSON.parse(pi.stdout)).toEqual({ errors: 0, handlers: 1, blocked: [true, true] });
    } finally { setup.clean(); }
  }, 15_000);
}
