import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installedSdkFile } from "./fixtures/installed-pi-sdk";

const source = resolve(import.meta.dir, "..");

test("the shipped parser assets and Pi bundle match their pinned build inputs", async () => {
  for (const [packageName, files] of [
    ["web-tree-sitter", [["web-tree-sitter.wasm", "web-tree-sitter.wasm"], ["LICENSE", "web-tree-sitter.LICENSE"]]],
    ["tree-sitter-bash", [["tree-sitter-bash.wasm", "tree-sitter-bash.wasm"], ["LICENSE", "tree-sitter-bash.LICENSE"]]],
  ] as const) {
    for (const [input, output] of files) expect(readFileSync(join(source, "guard/vendor", output)))
      .toEqual(readFileSync(join(source, "node_modules", packageName, input)));
  }
  for (const [input, output] of [
    ["node_modules/web-tree-sitter/web-tree-sitter.js", "guard/vendor/tree-sitter.mjs"],
    ["harnesses/pi/guard-policies.ts", "harnesses/pi/guard-policies.bundle.ts"],
  ]) {
    const result = await Bun.build({ entrypoints: [join(source, input)], target: "node", format: "esm" });
    expect(result.success).toBe(true);
    expect(await result.outputs[0].text()).toBe(readFileSync(join(source, output), "utf8"));
  }
});

for (const missingGrammar of [false, true]) {
  test(`the symlinked Node/Pi guard ${missingGrammar ? "fails closed without its grammar" : "loads its local WASM parser without node_modules"}`, () => {
    const root = mkdtempSync(join(tmpdir(), "guard-parser-native-"));
    try {
      const copy = join(root, "package");
      const agentDir = join(root, "home/.pi/agent");
      const cwd = join(root, "project");
      mkdirSync(join(copy, "harnesses/pi"), { recursive: true });
      cpSync(join(source, "guard"), join(copy, "guard"), { recursive: true });
      cpSync(join(source, "harnesses/pi/guard-policies.bundle.ts"), join(copy, "harnesses/pi/guard-policies.bundle.ts"));
      mkdirSync(join(agentDir, "extensions"), { recursive: true });
      mkdirSync(cwd);
      symlinkSync(join(copy, "harnesses/pi/guard-policies.bundle.ts"), join(agentDir, "extensions/guard.ts"));
      if (missingGrammar) rmSync(join(copy, "guard/vendor/tree-sitter-bash.wasm"));
      const result = spawnSync("node", [join(source, "test/fixtures/guard-parser-loader.mjs"), installedSdkFile(), agentDir, cwd], {
        cwd, encoding: "utf8", timeout: 20_000,
        env: { ...process.env, HOME: join(root, "home"), PI_CODING_AGENT_DIR: agentDir },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ errors: 0, handlers: 1, blocked: [missingGrammar, true] });
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 30_000);
}

test("the Claude hook emits a refusal when the parser runtime itself is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "guard-parser-missing-"));
  try {
    cpSync(join(source, "guard"), join(root, "guard"), { recursive: true });
    cpSync(join(source, "harnesses/claude"), join(root, "harnesses/claude"), { recursive: true });
    rmSync(join(root, "guard/vendor/tree-sitter.mjs"));
    const result = spawnSync("bun", [join(root, "harnesses/claude/guard.ts")], {
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git status --short" }, cwd: root }),
      encoding: "utf8", timeout: 10_000, env: { PATH: process.env.PATH, HOME: root },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the Claude hook refuses malformed or oversized Bash without a text-matching fallback", () => {
  for (const command of ["echo $(", `printf ${"x".repeat(65_536)}`]) {
    const result = spawnSync("bun", [join(source, "harnesses/claude/guard.ts")], {
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd: "/tmp/project" }),
      encoding: "utf8", timeout: 10_000,
      env: { PATH: process.env.PATH, HOME: "/home/disposable-user" },
    });
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout).hookSpecificOutput;
    expect(output.permissionDecision).toBe("deny");
    expect(output.permissionDecisionReason).toMatch(/malformed|inspection limit/);
  }
});
