import { expect, test } from "bun:test";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installedSdkFile } from "./fixtures/installed-pi-sdk";
import { copyPackageFiles } from "./fixtures/inactive-package";

test("the Node-compatible Pi guard bundle matches the reviewed source", async () => {
  const source = fileURLToPath(new URL("../harnesses/pi/guard-policies.ts", import.meta.url));
  const bundle = fileURLToPath(new URL("../harnesses/pi/guard-policies.bundle.ts", import.meta.url));
  const built = await Bun.build({ entrypoints: [source], target: "node", format: "esm" });
  expect(built.success).toBe(true);
  expect(await built.outputs[0].text()).toBe(readFileSync(bundle, "utf8"));
});

test("the Pi SDK follows its installed CLI package through a launcher without assuming Homebrew", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-package-")));
  try {
    const installed = join(root, "vendor/node_modules/@earendil-works/pi-coding-agent");
    const cli = join(installed, "dist/bundle/cli.js");
    const sdk = join(installed, "dist/index.js");
    const wrapper = join(root, "bin/pi");
    mkdirSync(dirname(cli), { recursive: true });
    mkdirSync(dirname(wrapper), { recursive: true });
    writeFileSync(join(installed, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent" }));
    writeFileSync(cli, "fixture\n");
    writeFileSync(sdk, "fixture\n");
    writeFileSync(wrapper, `#!/bin/sh\nexec "${cli}" "$@"\n`);
    expect(installedSdkFile(wrapper)).toBe(sdk);
    expect(installedSdkFile(cli)).toBe(sdk);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the installed MVP keeps ordinary Pi skills, its guard, and project discovery", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "native-pi-package-")));
  try {
    const home = join(root, "home");
    const project = join(home, "project");
    const agentDir = join(home, ".pi/agent");
    const source = join(root, "replacement");
    mkdirSync(join(project, ".pi/extensions"), { recursive: true });
    mkdirSync(join(agentDir, "skills/personal"), { recursive: true });
    mkdirSync(join(agentDir, "themes"), { recursive: true });
    writeFileSync(join(agentDir, "skills/personal/SKILL.md"),
      "---\nname: personal\ndescription: Disposable personal skill.\n---\nTest only.\n");
    writeFileSync(join(project, ".pi/extensions/project.ts"), "export default function () {}\n");
    copyPackageFiles(source);
    for (const binary of ["tools/worktree/target/release/wt", "tools/worklog/target/release/wl",
      "tools/artifact-review/target/release/review-artifact", "tools/evaluation/target/release/review-change",
      "tools/evaluation/target/release/consult"]) {
      const path = join(source, binary);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "#!/bin/sh\nexit 0\n");
      chmodSync(path, 0o755);
    }
    const executable = fileURLToPath(new URL("../tools/evaluation/target/debug/ai-config", import.meta.url));
    const installed = Bun.spawnSync([executable, "--root", realpathSync(source), "install"], {
      env: { HOME: home, PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" },
      stdout: "pipe", stderr: "pipe",
    });
    expect(installed.exitCode, installed.stderr.toString()).toBe(0);
    const run = Bun.spawn(["node", fileURLToPath(new URL("./fixtures/package-pi-discovery.mjs", import.meta.url)),
      installedSdkFile(), agentDir, project], {
      cwd: project, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { HOME: home, PATH: process.env.PATH ?? "", PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" },
    });
    const [output, errors, status] = await Promise.all([
      new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited,
    ]);
    expect(status, errors).toBe(0);
    const discovered = JSON.parse(output) as { paths: string[]; errorCount: number; skills: string[];
      skillErrors: number; prompts: string[]; promptErrors: number;
      themes: string[]; themeErrors: number; denied: boolean; leaked: boolean };
    expect(discovered.errorCount).toBe(0);
    expect(discovered.skillErrors).toBe(0);
    expect(discovered.promptErrors).toBe(0);
    expect(discovered.prompts).toContain("deliver");
    expect(discovered.prompts).toContain("rebase");
    expect(discovered.themeErrors).toBe(0);
    expect(discovered.skills).toContain("personal");
    for (const name of ["3d", "code", "commit", "model-domain", "review-change", "work-log"]) {
      expect(discovered.skills).toContain(name);
    }
    expect(discovered.paths).toContain(join(agentDir, "extensions/guard-policies.ts"));
    expect(discovered.paths).toContain(join(agentDir, "extensions/status-footer.ts"));
    expect(discovered.paths).toContain(join(agentDir, "extensions/worktree.ts"));
    for (const name of ["lsp", "wt", "write-tool-highlights"]) {
      expect(discovered.paths).not.toContain(join(agentDir, `extensions/${name}.ts`));
    }
    expect(discovered.paths).toContain(join(project, ".pi/extensions/project.ts"));
    expect(discovered.themes).toContain("catppuccin-mocha");
    expect(discovered.denied).toBe(true);
    expect(discovered.leaked).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 20_000);

test("ordinary Pi discovers a linked guard and shared commit skill without the old source or a provider", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "native-pi-home-")));
  try {
    const agentDir = join(home, ".pi/agent");
    const project = join(home, "project");
    const source = join(home, "replacement/native");
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    mkdirSync(join(agentDir, "themes"), { recursive: true });
    mkdirSync(join(agentDir, "skills/personal"), { recursive: true });
    mkdirSync(join(project, ".pi/extensions"), { recursive: true });
    mkdirSync(join(project, ".pi/skills/project"), { recursive: true });
    writeFileSync(join(agentDir, "extensions/personal.ts"), "export default function () {}\n");
    writeFileSync(join(project, ".pi/extensions/project.ts"), "export default function () {}\n");
    writeFileSync(join(agentDir, "skills/personal/SKILL.md"),
      "---\nname: personal\ndescription: Disposable personal skill.\n---\nTest only.\n");
    writeFileSync(join(project, ".pi/skills/project/SKILL.md"),
      "---\nname: project\ndescription: Disposable approved project skill.\n---\nTest only.\n");
    const replacement = fileURLToPath(new URL("../", import.meta.url));
    cpSync(join(replacement, "guard"), join(source, "guard"), { recursive: true });
    cpSync(join(replacement, "skills/commit"), join(source, "skills/commit"), { recursive: true });
    cpSync(join(replacement, "harnesses/pi/guard-policies.ts"), join(source, "harnesses/pi/guard-policies.ts"), { recursive: true });
    symlinkSync(join(source, "skills/commit"), join(agentDir, "skills/commit"));
    const destination = join(agentDir, "extensions/guard-policies.ts");
    symlinkSync(join(source, "harnesses/pi/guard-policies.ts"), destination);
    const run = Bun.spawn(["bun", fileURLToPath(new URL("./fixtures/package-pi-discovery.mjs", import.meta.url)),
      installedSdkFile(), agentDir, project], {
      cwd: project, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { HOME: home, PATH: process.env.PATH ?? "", PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" },
    });
    const output = await new Response(run.stdout).text();
    expect(await run.exited).toBe(0);
    const discovered = JSON.parse(output) as { paths: string[]; errorCount: number;
      skills: string[]; skillErrors: number; themes: string[]; themeErrors: number;
      denied: boolean; leaked: boolean };
    expect(discovered.errorCount).toBe(0);
    expect(discovered.paths).toContain(destination);
    expect(discovered.paths).toContain(join(agentDir, "extensions/personal.ts"));
    expect(discovered.paths).toContain(join(project, ".pi/extensions/project.ts"));
    expect(discovered.skillErrors).toBe(0);
    expect(discovered.skills).toContain("commit");
    expect(discovered.skills).toContain("personal");
    expect(discovered.skills).toContain("project");
    expect(discovered.themeErrors).toBe(0);
    expect(discovered.denied).toBe(true);
    expect(discovered.leaked).toBe(false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 15_000);
