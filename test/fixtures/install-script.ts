import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { copyPackageFiles } from "./inactive-package";

const repository = resolve(import.meta.dir, "../..");
export const INSTALL_COMMAND_GUARD_MS = 30_000;

export function installerScenarioGuard(transactions: number) {
  // Every invocation retains its own limit; reserve one more for setup/cleanup.
  return (transactions + 1) * INSTALL_COMMAND_GUARD_MS;
}

export function installFixture() {
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), "shell-install-")));
  const source = join(temporary, "package π with spaces");
  const home = join(temporary, "disposable home");
  const bin = join(temporary, "bin");
  const scratch = join(temporary, "scratch");
  for (const directory of [home, bin, scratch]) mkdirSync(directory, { recursive: true });
  copyPackageFiles(source);
  copyFileSync(join(repository, "install.sh"), join(source, "install.sh"));
  cpSync(join(repository, "tools/install"), join(source, "tools/install"), { recursive: true });
  for (const relative of ["worktree/target/release/wt", "worklog/target/release/wl",
    "evaluation/target/release/review-change", "evaluation/target/release/consult",
    "artifact-review/target/release/review-artifact"]) {
    const path = join(source, "tools", relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "#!/bin/sh\nprintf 'fixture tool\\n'\n", { mode: 0o755 });
  }
  const log = join(temporary, "build-log");
  writeFileSync(log, "");
  writeFileSync(join(bin, "make"), '#!/bin/bash\nprintf "%s\\n%s\\n" "$PWD" "$*" >> "$TEST_LOG"\nexit "${BUILD_STATUS:-0}"\n');
  chmodSync(join(bin, "make"), 0o755);
  const provisionLog = join(temporary, "provision-log");
  writeFileSync(provisionLog, "");
  writeFileSync(join(bin, "mise"), '#!/bin/bash\nprintf "%s\\n%s\\n" "$PWD" "$*" >> "$PROVISION_LOG"\nif [[ $* == install ]]; then exit "${PROVISION_STATUS:-0}"; fi\nif [[ $1 == exec && $2 == -- ]]; then shift 2; exec "$@"; fi\nexit 64\n', { mode: 0o755 });
  const environment = (extra: Record<string, string>) => ({
    ...process.env, HOME: home, TMPDIR: scratch, PATH: `${bin}:${process.env.PATH}`, TEST_LOG: log, PROVISION_LOG: provisionLog, ...extra,
  });
  return {
    temporary, source, home, bin,
    run: (args: string[] = [], env: Record<string, string> = {}) => spawnSync(join(source, "install.sh"), args, {
      cwd: temporary, encoding: "utf8", timeout: INSTALL_COMMAND_GUARD_MS,
      env: environment(env),
    }),
    runFrom: (selectedSource: string, env: Record<string, string> = {}) => spawnSync(join(selectedSource, "install.sh"), [], {
      cwd: temporary, encoding: "utf8", timeout: INSTALL_COMMAND_GUARD_MS, env: environment(env),
    }),
    launch: (env: Record<string, string> = {}) => spawn(join(source, "install.sh"), [], {
      cwd: temporary, env: environment(env), detached: true, stdio: ["ignore", "pipe", "pipe"],
    }),
    calls: () => readFileSync(log, "utf8"),
    provisionCalls: () => readFileSync(provisionLog, "utf8"),
    clean: () => rmSync(temporary, { recursive: true, force: true }),
  };
}
