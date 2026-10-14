import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));

function fixture() {
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), "install-script-")));
  const source = join(temporary, "package with spaces");
  const home = join(temporary, "disposable home");
  const bin = join(temporary, "bin");
  const release = join(source, "tools/evaluation/target/release");
  for (const directory of [home, bin, release]) mkdirSync(directory, { recursive: true });
  const script = join(source, "install.sh");
  copyFileSync(join(repository, "install.sh"), script);
  const log = join(temporary, "calls");
  writeFileSync(log, "");
  writeFileSync(join(bin, "make"), '#!/bin/bash\nprintf "build\\n%s\\n%s\\n" "$PWD" "$*" >> "$TEST_LOG"\nexit "${BUILD_STATUS:-0}"\n');
  writeFileSync(join(release, "ai-config"), '#!/bin/bash\nprintf "install\\n%s\\n" "$HOME" >> "$TEST_LOG"\nprintf "%s\\n" "$@" >> "$TEST_LOG"\nexit "${INSTALL_STATUS:-0}"\n');
  for (const executable of [join(bin, "make"), join(release, "ai-config")]) chmodSync(executable, 0o755);
  return {
    source, home,
    run: (args: string[] = [], env: Record<string, string> = {}, entry = script) => spawnSync(entry, args, {
      cwd: temporary, encoding: "utf8", timeout: 10_000,
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, TEST_LOG: log, ...env },
    }),
    calls: () => readFileSync(log, "utf8"),
    clean: () => rmSync(temporary, { recursive: true, force: true }),
  };
}

test("install.sh delegates real ownership and settings management in a disposable home", () => {
  const setup = fixture();
  try {
    mkdirSync(join(setup.home, ".pi/agent"), { recursive: true });
    const settings = join(setup.home, ".pi/agent/settings.json");
    writeFileSync(settings, JSON.stringify({ defaultProvider: "personal-provider", defaultModel: "personal-model" }));
    const personal = join(setup.home, ".pi/agent/personal.md");
    writeFileSync(personal, "unrelated resource\n");
    // make test has built the package; stub only the redundant build, not ai-config.
    const entry = join(repository, "install.sh");
    const result = setup.run([], {}, entry);
    expect({ status: result.status, error: result.error }).toEqual({ status: 0, error: undefined });
    const root = realpathSync(repository);
    expect(readlinkSync(join(setup.home, ".pi/agent/AGENTS.md"))).toBe(join(root, "baseline.md"));
    expect(readlinkSync(join(setup.home, ".claude/CLAUDE.md"))).toBe(join(root, "baseline.md"));
    expect(JSON.parse(readFileSync(settings, "utf8"))).toMatchObject({
      defaultProvider: "personal-provider", defaultModel: "personal-model", theme: "catppuccin-mocha",
    });
    expect(readFileSync(personal, "utf8")).toBe("unrelated resource\n");
    const record = join(setup.home, ".local/state/ai-config/installation.json");
    const ownership = readFileSync(record, "utf8");
    expect(setup.run([], {}, entry).status).toBe(0);
    expect(readFileSync(record, "utf8")).toBe(ownership);
    expect(existsSync(join(setup.home, ".review-publication"))).toBe(false);
    expect(existsSync(join(setup.home, ".agentmemory"))).toBe(false);
  } finally {
    setup.clean();
  }
});

test("install.sh stops on a failed build instead of running a stale installer", () => {
  const setup = fixture();
  try {
    const result = setup.run([], { BUILD_STATUS: "17" });
    expect(result.status).toBe(17);
    expect(setup.calls()).toBe(`build\n${setup.source}\nbuild\n`);
  } finally {
    setup.clean();
  }
});

test("install.sh preserves the installer's failure status", () => {
  const setup = fixture();
  try {
    const result = setup.run([], { INSTALL_STATUS: "23" });
    expect(result.status).toBe(23);
    expect(setup.calls()).toContain("\ninstall\n");
  } finally {
    setup.clean();
  }
});

test("install.sh help describes effects without building or installing", () => {
  const setup = fixture();
  try {
    for (const flag of ["--help", "-h"]) {
      const result = setup.run([flag]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Usage: install.sh");
      expect(result.stdout).toContain("make build");
      expect(result.stdout).toContain("HOME");
      expect(result.stderr).toBe("");
      expect(setup.calls()).toBe("");
    }
  } finally {
    setup.clean();
  }
});

test("install.sh rejects unsupported arguments before any build or installation", () => {
  const setup = fixture();
  try {
    for (const args of [["--force"], ["install"], ["--root", "/other"], ["--help", "extra"]]) {
      const result = setup.run(args);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("Usage: install.sh");
      expect(result.stdout).toBe("");
      expect(setup.calls()).toBe("");
    }
  } finally {
    setup.clean();
  }
});

test("install.sh builds its own checkout before delegating to the Rust installer from another directory", () => {
  const setup = fixture();
  try {
    const result = setup.run();
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
    expect(setup.calls()).toBe(`build\n${setup.source}\nbuild\ninstall\n${setup.home}\n--root\n${setup.source}\ninstall\n`);
  } finally {
    setup.clean();
  }
});
