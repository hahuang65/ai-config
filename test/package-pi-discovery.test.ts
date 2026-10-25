import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installedSdkFile } from "./fixtures/installed-pi-sdk";
import { installFixture } from "./fixtures/install-script";

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

test("Pi SDK discovery uses a pre-installed CLI on PATH behind a mise shim without invoking mise", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "project-pi-sdk-")));
  try {
    const installed = join(root, "npm/node_modules/@earendil-works/pi-coding-agent");
    const cli = join(installed, "dist/cli.js");
    const sdk = join(installed, "dist/index.js");
    const bin = join(root, "bin"), shims = join(root, "shims"), log = join(root, "mise-log");
    mkdirSync(join(installed, "dist"), { recursive: true });
    mkdirSync(bin);
    mkdirSync(shims);
    writeFileSync(join(installed, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent" }));
    writeFileSync(cli, "fixture\n", { mode: 0o755 });
    writeFileSync(sdk, "fixture\n");
    writeFileSync(join(bin, "mise"), '#!/bin/sh\nprintf "invoked" > "$MISE_TEST_LOG"\nexit 99\n', { mode: 0o755 });
    symlinkSync(join(bin, "mise"), join(shims, "pi"));
    symlinkSync(cli, join(bin, "pi"));
    const fixture = fileURLToPath(new URL("./fixtures/installed-pi-sdk.ts", import.meta.url));
    const run = Bun.spawnSync([process.execPath, "-e",
      `import { installedSdkFile } from ${JSON.stringify(fixture)}; console.log(installedSdkFile());`], {
      cwd: root, env: { ...process.env, PATH: `${shims}:${bin}`, MISE_TEST_LOG: log },
    });
    expect(run.exitCode, run.stderr.toString()).toBe(0);
    expect(run.stdout.toString().trim()).toBe(sdk);
    expect(existsSync(log)).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the installed MVP keeps ordinary Pi skills, its guard, and project discovery", async () => {
  const setup = installFixture();
  try {
    const { home } = setup;
    const project = join(home, "project");
    const agentDir = join(home, ".pi/agent");
    mkdirSync(join(project, ".pi/extensions"), { recursive: true });
    mkdirSync(join(agentDir, "skills/personal"), { recursive: true });
    mkdirSync(join(agentDir, "themes"), { recursive: true });
    writeFileSync(join(agentDir, "skills/personal/SKILL.md"),
      "---\nname: personal\ndescription: Disposable personal skill.\n---\nTest only.\n");
    writeFileSync(join(project, ".pi/extensions/project.ts"), "export default function () {}\n");
    const installed = setup.run();
    expect(installed.status, installed.stderr).toBe(0);
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
    expect(discovered.paths).toContain(join(agentDir, "extensions/lsp.ts"));
    expect(discovered.paths).toContain(join(agentDir, "extensions/ask-user-question.ts"));
    expect(discovered.paths).toContain(join(agentDir, "extensions/todo.ts"));
    expect(discovered.paths).toContain(join(agentDir, "extensions/review-feedback.ts"));
    for (const name of ["wt", "write-tool-highlights"]) {
      expect(discovered.paths).not.toContain(join(agentDir, `extensions/${name}.ts`));
    }
    expect(discovered.paths).toContain(join(project, ".pi/extensions/project.ts"));
    expect(discovered.themes).toContain("catppuccin-mocha");
    expect(discovered.denied).toBe(true);
    expect(discovered.leaked).toBe(false);
  } finally { setup.clean(); }
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
