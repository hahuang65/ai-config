import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installerScenarioGuard, installFixture } from "./fixtures/install-script";

test("install.sh owns standard Bash completion links without editing startup files", () => {
  const setup = installFixture();
  try {
    const startup = "# personal Bash configuration\nprintf 'personal startup\\n'\n";
    writeFileSync(join(setup.home, ".bashrc"), startup);
    writeFileSync(join(setup.home, ".bash_profile"), startup);
    const result = setup.run();
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
    const record = JSON.parse(readFileSync(join(setup.home, ".local/state/ai-config/installation.json"), "utf8"));
    for (const command of ["wt", "worktree"]) {
      const destination = `.local/share/bash-completion/completions/${command}`;
      expect(existsSync(join(setup.home, destination)), destination).toBe(true);
      expect(readlinkSync(join(setup.home, destination))).toBe(join(setup.source, "tools/worktree/src/completion.bash"));
      expect(record.links).toContainEqual({ destination, target: "tools/worktree/src/completion.bash" });
    }
    expect(readFileSync(join(setup.home, ".bashrc"), "utf8")).toBe(startup);
    expect(readFileSync(join(setup.home, ".bash_profile"), "utf8")).toBe(startup);
  } finally { setup.clean(); }
}, 30_000);

test("either installed entry registers both names and calls its selected command", () => {
  const setup = installFixture();
  try {
    writeFileSync(join(setup.source, "tools/worktree/target/release/wt"),
      '#!/bin/bash\n[[ $# == 4 && $1 == __complete && $2 == 1 && $3 == "${0##*/}" && $4 == en ]] || exit 64\nprintf "enter\\n"\n');
    expect(setup.run().status).toBe(0);
    for (const command of ["wt", "worktree"]) {
      const env: NodeJS.ProcessEnv = { ...process.env, HOME: setup.home, PATH: `${setup.home}/.local/bin:${process.env.PATH}` };
      delete env.BASH_ENV;
      delete env.ENV;
      const result = spawnSync("bash", ["--noprofile", "--norc", "-c", `
        source "$HOME/.local/share/bash-completion/completions/$1"
        complete -p wt worktree >/dev/null || exit 17
        COMP_WORDS=("$1" en)
        COMP_CWORD=1
        _wt_complete
        printf '%s\\n' "\${COMPREPLY[@]}"
      `, "completion-install-test", command], { cwd: setup.temporary, env, encoding: "utf8", timeout: 10_000 });
      expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({
        status: 0, stdout: "enter\n", stderr: "",
      });
    }
  } finally { setup.clean(); }
}, 30_000);

const completionLoader = ["/usr/share/bash-completion/bash_completion",
  "/opt/homebrew/share/bash-completion/bash_completion", "/usr/local/share/bash-completion/bash_completion"].find(existsSync);

test.skipIf(!completionLoader)("bash-completion lazily discovers either installed command", () => {
  const setup = installFixture();
  try {
    writeFileSync(join(setup.source, "tools/worktree/target/release/wt"), "#!/bin/sh\nprintf 'enter\\n'\n");
    expect(setup.run().status).toBe(0);
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: setup.home, PATH: `${setup.home}/.local/bin:${process.env.PATH}` };
    for (const key of Object.keys(env)) {
      if (key.startsWith("XDG_") || key.startsWith("BASH_COMPLETION") || ["ENV", "BASH_ENV"].includes(key)) delete env[key];
    }
    env.BASH_COMPLETION_COMPAT_DIR = join(setup.temporary, "no-compat");
    env.BASH_COMPLETION_USER_FILE = join(setup.temporary, "no-user-file");
    for (const command of ["wt", "worktree"]) {
      const result = spawnSync("bash", ["--noprofile", "--norc", "-c", `
        source "$2"
        COMP_WORDS=("$1" en)
        COMP_CWORD=1
        COMP_LINE="$1 en"
        COMP_POINT=\${#COMP_LINE}
        registration=$(complete -p -D) || exit 17
        [[ $registration =~ -F[[:space:]]+([a-zA-Z_][a-zA-Z_0-9]*) ]] || exit 18
        handler=\${BASH_REMATCH[1]}
        status=0
        "$handler" "$1" en "$1" || status=$?
        [[ $status == 0 || $status == 124 ]] || exit 19
        complete -p wt worktree >/dev/null || exit 20
        _wt_complete
        printf '%s\\n' "\${COMPREPLY[@]}"
      `, "completion-loader-test", command, completionLoader!], {
        cwd: setup.temporary, env, encoding: "utf8", timeout: 10_000,
      });
      expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({
        status: 0, stdout: "enter\n", stderr: "",
      });
    }
  } finally { setup.clean(); }
}, 30_000);

test("completion links are idempotent and follow an owned source switch", () => {
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
    for (const command of ["wt", "worktree"]) {
      expect(readlinkSync(join(setup.home, ".local/share/bash-completion/completions", command)))
        .toBe(join(next, "tools/worktree/src/completion.bash"));
    }
    expect(existsSync(join(setup.home, ".bashrc"))).toBe(false);
    expect(existsSync(join(setup.home, ".bash_profile"))).toBe(false);
  } finally { setup.clean(); }
}, installerScenarioGuard(3));

test("a recorded upgrade adds the previously missing completion links", () => {
  const setup = installFixture();
  try {
    expect(setup.run().status).toBe(0);
    const path = join(setup.home, ".local/state/ai-config/installation.json");
    const record = JSON.parse(readFileSync(path, "utf8"));
    const completions = record.links.filter((link: { destination: string }) => link.destination.includes("bash-completion/"));
    record.links = record.links.filter((link: { destination: string }) => !link.destination.includes("bash-completion/"));
    writeFileSync(path, JSON.stringify(record));
    for (const { destination } of completions) unlinkSync(join(setup.home, destination));
    expect(setup.run().status).toBe(0);
    for (const { destination, target } of completions) {
      expect(readlinkSync(join(setup.home, destination))).toBe(join(setup.source, target));
    }
  } finally { setup.clean(); }
}, installerScenarioGuard(2));

for (const kind of ["personal file", "unrecorded matching symlink"]) {
  test(`install refuses a completion ${kind} without changing it`, () => {
    const setup = installFixture();
    try {
      const directory = join(setup.home, ".local/share/bash-completion/completions");
      mkdirSync(directory, { recursive: true });
      const path = join(directory, "wt");
      const target = join(setup.source, "tools/worktree/src/completion.bash");
      if (kind === "personal file") writeFileSync(path, "personal completion\n");
      else symlinkSync(target, path);
      const result = setup.run();
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/unrelated destination|Unowned or modified link/);
      if (kind === "personal file") expect(readFileSync(path, "utf8")).toBe("personal completion\n");
      else expect(readlinkSync(path)).toBe(target);
      expect(existsSync(join(setup.home, ".claude/CLAUDE.md"))).toBe(false);
      expect(existsSync(join(setup.home, ".local/state/ai-config/installation.json"))).toBe(false);
    } finally { setup.clean(); }
  }, 30_000);
}
