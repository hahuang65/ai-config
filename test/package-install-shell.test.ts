import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { installerScenarioGuard, installFixture } from "./fixtures/install-script";

const destination = ".local/share/ai-config/bash/wt.bash";
const target = "tools/worktree/src/shell.bash";

test("install.sh owns the WT Bash fragment without changing user startup files", () => {
  const setup = installFixture();
  try {
    const startup = "# personal startup configuration\n";
    for (const file of [".bashrc", ".bash_profile"]) writeFileSync(join(setup.home, file), startup);
    const result = setup.run();
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
    expect(existsSync(join(setup.home, destination))).toBe(true);
    expect(readlinkSync(join(setup.home, destination))).toBe(join(setup.source, target));
    const record = JSON.parse(readFileSync(join(setup.home, ".local/state/ai-config/installation.json"), "utf8"));
    expect(record.links).toContainEqual({ destination, target });
    for (const file of [".bashrc", ".bash_profile"]) {
      expect(readFileSync(join(setup.home, file), "utf8")).toBe(startup);
    }
  } finally { setup.clean(); }
}, 30_000);

test("the WT Bash fragment is idempotent and follows an owned source switch", () => {
  const setup = installFixture();
  try {
    expect(setup.run().status).toBe(0);
    const record = join(setup.home, ".local/state/ai-config/installation.json");
    const before = readFileSync(record, "utf8");
    expect(setup.run().status).toBe(0);
    expect(readFileSync(record, "utf8")).toBe(before);
    const next = join(setup.temporary, "next source");
    cpSync(setup.source, next, { recursive: true });
    expect(setup.runFrom(next).status).toBe(0);
    expect(readlinkSync(join(setup.home, destination))).toBe(join(next, target));
    expect(existsSync(join(setup.home, ".bashrc"))).toBe(false);
    expect(existsSync(join(setup.home, ".bash_profile"))).toBe(false);
  } finally { setup.clean(); }
}, installerScenarioGuard(3));

test("a recorded upgrade adds the previously missing WT Bash fragment", () => {
  const setup = installFixture();
  try {
    expect(setup.run().status).toBe(0);
    const path = join(setup.home, ".local/state/ai-config/installation.json");
    const record = JSON.parse(readFileSync(path, "utf8"));
    record.links = record.links.filter((link: { destination: string }) => link.destination !== destination);
    writeFileSync(path, JSON.stringify(record));
    unlinkSync(join(setup.home, destination));
    expect(setup.run().status).toBe(0);
    expect(readlinkSync(join(setup.home, destination))).toBe(join(setup.source, target));
    expect(JSON.parse(readFileSync(path, "utf8")).links).toContainEqual({ destination, target });
  } finally { setup.clean(); }
}, installerScenarioGuard(2));

test("a new Bash process sources the installed fragment and enters using either command name", () => {
  const setup = installFixture();
  try {
    copyFileSync(resolve("tools/worktree/target/release/wt"), join(setup.source, "tools/worktree/target/release/wt"));
    expect(setup.run().status).toBe(0);
    const project = join(setup.temporary, "project");
    mkdirSync(project);
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: setup.home, PATH: `${setup.home}/.local/bin:${process.env.PATH}`,
      GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", WT_ROOT: join(setup.temporary, "trees") };
    delete env.BASH_ENV;
    delete env.ENV;
    for (const args of [["init", "-b", "main", "--template="], ["config", "user.name", "Test User"],
      ["config", "user.email", "test@example.invalid"], ["commit", "--allow-empty", "-m", "initial"]]) {
      const git = spawnSync("git", args, { cwd: project, env, encoding: "utf8", timeout: 10_000 });
      expect(git.status, git.stderr).toBe(0);
    }
    const created = spawnSync(join(setup.home, ".local/bin/wt"), ["new", "feature", "--local", "--json"], {
      cwd: project, env, encoding: "utf8", timeout: 15_000,
    });
    expect(created.status, created.stderr).toBe(0);
    const path = JSON.parse(created.stdout).worktree.path;
    for (const name of ["wt", "worktree"]) {
      const shell = spawnSync("bash", ["--noprofile", "--norc", "-c",
        'source "$HOME/.local/share/ai-config/bash/wt.bash"; "$1" enter feature || exit; printf "%s\\n" "$PWD"',
        "installed-shell-test", name], { cwd: project, env, encoding: "utf8", timeout: 15_000 });
      expect({ status: shell.status, stdout: shell.stdout, stderr: shell.stderr }).toEqual({
        status: 0, stdout: `${path}\n`, stderr: "",
      });
    }
  } finally { setup.clean(); }
}, 45_000);

for (const kind of ["personal file", "unrecorded matching symlink"]) {
  test(`install refuses a WT Bash fragment ${kind} without adopting it`, () => {
    const setup = installFixture();
    try {
      mkdirSync(join(setup.home, ".local/share/ai-config/bash"), { recursive: true });
      const path = join(setup.home, destination);
      if (kind === "personal file") writeFileSync(path, "personal shell setup\n");
      else symlinkSync(join(setup.source, target), path);
      const result = setup.run();
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/unrelated destination|Unowned or modified link/);
      if (kind === "personal file") expect(readFileSync(path, "utf8")).toBe("personal shell setup\n");
      else expect(readlinkSync(path)).toBe(join(setup.source, target));
      expect(existsSync(join(setup.home, ".claude/CLAUDE.md"))).toBe(false);
      expect(existsSync(join(setup.home, ".local/state/ai-config/installation.json"))).toBe(false);
    } finally { setup.clean(); }
  }, 30_000);
}
