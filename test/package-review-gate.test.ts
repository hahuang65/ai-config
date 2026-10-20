import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const piRuntimeCommand = "bun test --concurrent --max-concurrency=2 test/package-worktree.test.ts";
const claudeRuntimeCommand = "bun test --concurrent --max-concurrency=2 test/package-claude-worktree-runtime.test.ts";

test("build and verification allow locked Cargo dependency fetching without provisioning tools", () => {
  for (const target of ["build", "lint", "test"]) {
    const preview = Bun.spawnSync(["make", "-n", target], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(preview.exitCode, preview.stderr.toString()).toBe(0);
    const commands = preview.stdout.toString().split("\n");
    const cargo = commands.filter(line => /^cargo (build|test|clippy) /.test(line));
    expect(cargo.length).toBeGreaterThan(0);
    for (const command of cargo) {
      expect(command).toContain("--locked");
      expect(command).not.toContain("--offline");
    }
    expect(commands.some(line => /^(mise install|\.\/install\.sh)(\s|$)/.test(line))).toBe(false);
  }
});

test("the build generates both LSP projections before package checks", () => {
  const preview = Bun.spawnSync(["make", "-n", "test"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect(preview.exitCode).toBe(0);
  const commands = preview.stdout.toString();
  for (const command of ["bun tools/build-language-servers.mjs", "bun build harnesses/pi/lsp.ts"]) {
    expect(commands).toContain(command);
    expect(commands.indexOf(command)).toBeLessThan(commands.indexOf("bun test "));
  }
});

test("cold test runs build every manifest release target before package validation", () => {
  const preview = Bun.spawnSync(["make", "-n", "test"], {
    cwd: root, stdout: "pipe", stderr: "pipe",
  });
  expect(preview.exitCode, preview.stderr.toString()).toBe(0);
  const commands = preview.stdout.toString();
  const packageTests = commands.indexOf("bun test ");
  const rustTests = commands.indexOf("cargo test --locked --manifest-path tools/evaluation/Cargo.toml");
  for (const tool of ["worktree", "worklog", "artifact-review", "evaluation"]) {
    const release = `cargo build --locked --release --manifest-path tools/${tool}/Cargo.toml`;
    const position = commands.indexOf(release);
    expect(position).toBeGreaterThanOrEqual(0);
    expect(position).toBeLessThan(packageTests);
    expect(position).toBeLessThan(rustTests);
  }
});

test("focused and full browser checks build every dependency once before use", () => {
  const builds = [
    "bun build harnesses/pi/guard-policies.ts --target node --format esm --outfile harnesses/pi/guard-policies.bundle.ts",
    "cargo build --locked --manifest-path tools/evaluation/Cargo.toml",
    "cargo build --locked --manifest-path tools/artifact-review/Cargo.toml",
  ];
  const browser = "node --test --test-concurrency=1 tools/artifact-review/tests/integration.mjs";
  for (const targets of [["test-browser"], ["test"], ["test-package", "test-browser"], ["test-browser", "test-package"]]) {
    const preview = Bun.spawnSync(["make", "-n", ...targets], {
      cwd: root, stdout: "pipe", stderr: "pipe",
    });
    expect(preview.exitCode, preview.stderr.toString()).toBe(0);
    const commands = preview.stdout.toString().split("\n");
    expect(commands).toContain(browser);
    for (const build of builds) {
      expect(commands.filter(line => line === build).length, targets.join(" ")).toBe(1);
      expect(commands.indexOf(build)).toBeLessThan(commands.indexOf(browser));
    }
  }
});

test("reviewer process fixtures are built for tests but not production builds", () => {
  const fixture = "cargo build --locked --manifest-path tools/evaluation/Cargo.toml --example reviewer-fixture";
  for (const target of ["test-package", "test-evaluation", "test"]) {
    const preview = Bun.spawnSync(["make", "-n", target], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(preview.exitCode, preview.stderr.toString()).toBe(0);
    const commands = preview.stdout.toString().split("\n");
    expect(commands.filter(line => line === fixture)).toHaveLength(1);
    const firstTest = commands.findIndex(line => line.startsWith("bun test ") || line.startsWith("cargo test "));
    expect(commands.indexOf(fixture)).toBeLessThan(firstTest);
  }
  const production = Bun.spawnSync(["make", "-n", "build"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect(production.exitCode, production.stderr.toString()).toBe(0);
  expect(production.stdout.toString()).not.toContain("reviewer-fixture");
});

test("the gate builds and runs process-level worktree parity", () => {
  const preview = Bun.spawnSync(["make", "-n", "test"], {
    cwd: root, stdout: "pipe", stderr: "pipe",
  });
  expect(preview.exitCode, preview.stderr.toString()).toBe(0);
  const commands = preview.stdout.toString();
  const build = "cargo build --locked --manifest-path tools/worktree/Cargo.toml";
  const parity = "python tools/worktree/tests/rust_parity.py";
  expect(commands).toContain(build);
  expect(commands).toContain(parity);
  expect(commands.indexOf(build)).toBeLessThan(commands.indexOf(parity));
});

test("worktree parity uses a bounded worker count with a serial override", () => {
  for (const workers of [4, 1]) {
    const preview = Bun.spawnSync(["make", "-n", "test", `WT_TEST_JOBS=${workers}`], {
      cwd: root, stdout: "pipe", stderr: "pipe",
    });
    expect(preview.exitCode, preview.stderr.toString()).toBe(0);
    expect(preview.stdout.toString()).toContain(`python tools/worktree/tests/rust_parity.py --jobs ${workers}`);
  }
});

test("installer workers have a bounded default and an explicit serial override", () => {
  const environment = { ...process.env };
  for (const key of ["INSTALL_TEST_JOBS", "MAKEFLAGS", "MFLAGS", "MAKEOVERRIDES", "MAKELEVEL"]) delete environment[key];
  for (const workers of [undefined, 1, 2]) {
    const options = workers === undefined ? [] : [`INSTALL_TEST_JOBS=${workers}`];
    const preview = Bun.spawnSync(["make", "-n", "test-package", ...options], {
      cwd: root, env: environment, stdout: "pipe", stderr: "pipe",
    });
    expect(preview.exitCode, preview.stderr.toString()).toBe(0);
    expect(preview.stdout.toString()).toContain(`-f test/installers.mk -j${workers ?? 2}`);
  }
});

test("invalid installer worker counts fail before build or test commands", () => {
  for (const workers of ["", "0", "3", "1 2", "unbounded"]) {
    const preview = Bun.spawnSync(["make", "-n", "test-package", `INSTALL_TEST_JOBS=${workers}`], {
      cwd: root, stdout: "pipe", stderr: "pipe",
    });
    expect(preview.exitCode).not.toBe(0);
    expect(preview.stderr.toString()).toContain("INSTALL_TEST_JOBS must be 1 or 2");
    expect(preview.stdout.toString()).toBe("");
  }
});

test("package gates run every Bun file once and isolate bounded native runtime concurrency", () => {
  const expectedFiles = [
    ...readdirSync(resolve(root, "test")).filter(name => /^package-.*\.test\.ts$/.test(name)).map(name => `test/${name}`),
    "test/reviewer-runtime.test.ts", "test/guards.test.ts", "test/cli-links.test.ts", "test/resolve-conflicts.test.ts",
  ].sort();
  for (const targets of [["test-package"], ["test-package", "INSTALL_TEST_JOBS=1"], ["test"], ["-j4", "test"]]) {
    const preview = Bun.spawnSync(["make", "-n", ...targets], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(preview.exitCode, preview.stderr.toString()).toBe(0);
    const commands = bunCommands(preview.stdout.toString());
    expect(commands).toHaveLength(5);
    expect(commands[3]).toBe(piRuntimeCommand);
    expect(commands[4]).toBe(claudeRuntimeCommand);
    expect(commands[0]).not.toContain("test/package-install-");
    expect(commands[0]).not.toContain("test/package-worktree.test.ts");
    expect(commands[0]).not.toContain("test/package-claude-worktree-runtime.test.ts");
    for (const command of commands.slice(0, 3)) expect(command).not.toContain("--concurrent");
    for (const command of commands.slice(1, 3)) {
      const selected = command.split(/\s+/).slice(2);
      expect(selected.length).toBeGreaterThan(0);
      expect(selected.every(path => /^test\/package-install-.*\.test\.ts$/.test(path))).toBe(true);
    }
    const files = commands.flatMap(command => command.split(/\s+/).filter(arg => arg.endsWith(".test.ts")));
    expect(files.sort()).toEqual(expectedFiles);
  }
});

test("focused targets run only their selected suite and full test runs each suite once", () => {
  const suites = {
    "test-package": ["bun test test/", piRuntimeCommand, claudeRuntimeCommand],
    "test-worktree": ["cargo test --locked --manifest-path tools/worktree/Cargo.toml", "python -m unittest discover -s tools/worktree/tests -p parallel_runner_tests.py -v", "python tools/worktree/tests/rust_parity.py"],
    "test-worklog": ["cargo test --locked --manifest-path tools/worklog/Cargo.toml"],
    "test-artifact": ["cargo test --locked --manifest-path tools/artifact-review/Cargo.toml"],
    "test-evaluation": ["cargo test --locked --manifest-path tools/evaluation/Cargo.toml --lib --tests"],
    "test-browser": ["node --test --test-concurrency=1 tools/artifact-review/tests/integration.mjs"],
  };
  for (const [target, expected] of Object.entries(suites)) {
    const preview = Bun.spawnSync(["make", "-n", target], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(preview.exitCode, preview.stderr.toString()).toBe(0);
    const commands = preview.stdout.toString().split("\n");
    for (const command of Object.values(suites).flat()) {
      expect(commands.filter(line => line.startsWith(command)).length).toBe(expected.includes(command) ? 1 : 0);
    }
  }
  const full = Bun.spawnSync(["make", "-n", "-j4", "test"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect(full.exitCode, full.stderr.toString()).toBe(0);
  for (const command of Object.values(suites).flat()) {
    expect(full.stdout.toString().split("\n").filter(line => line.startsWith(command)).length).toBe(1);
  }
});

test("combined focused targets share builds within one invocation without caching tests", () => {
  for (let invocation = 0; invocation < 2; invocation++) {
    const preview = Bun.spawnSync(["make", "-n", "test-package", "test-evaluation"], {
      cwd: root, stdout: "pipe", stderr: "pipe",
    });
    expect(preview.exitCode, preview.stderr.toString()).toBe(0);
    const commands = preview.stdout.toString().split("\n");
    for (const tool of ["worktree", "worklog", "artifact-review", "evaluation"]) {
      expect(commands.filter(line => line === `cargo build --locked --release --manifest-path tools/${tool}/Cargo.toml`).length).toBe(1);
    }
    expect(commands.filter(line => line === "cargo build --locked --manifest-path tools/evaluation/Cargo.toml").length).toBe(1);
    expect(commands.some(line => line.startsWith("bun test "))).toBe(true);
    expect(commands).toContain("cargo test --locked --manifest-path tools/evaluation/Cargo.toml --lib --tests");
  }
});

test("change-review cases share one Cargo test target with every case module wired once", () => {
  const groups = [
    "change_execution", "change_opportunities", "change_post", "change_post_safety",
    "change_progress", "change_progress_terminal", "change_review",
    "change_review_diagnostics", "change_scope", "change_snapshot", "change_startup",
    "change_subject", "change_subject_safety", "change_suggestion_fallback",
  ];
  expectGroupedEvaluationCases("change", groups, /^change_.*\.rs$/);
});

test("reviewer and consult cases share one Cargo test target with every case module wired once", () => {
  expectGroupedEvaluationCases("runners", ["consult", "reviewer", "reviewer_claude", "reviewer_diagnostics"], /^(consult|reviewer)(?:_.*)?\.rs$/);
});

test("shell installation and package cases share one Cargo test target with every case module wired once", () => {
  const groups = [
    "configuration_package", "configuration_package_resources", "configuration_package_settings", "configuration_package_themes",
    "package_command_migration", "package_config_cli", "package_install", "package_manifest",
  ];
  expectGroupedEvaluationCases("configuration", groups, /^(configuration|package)_.*\.rs$/);
});

function bunCommands(output: string) {
  return output.split("\n").flatMap(line => {
    const command = line.match(/(?:^|; )(bun test [^|]+)/)?.[1];
    return command ? [command.replace(/\s+2>&1\s*$/, "").trim()] : [];
  });
}

function expectGroupedEvaluationCases(target: string, groups: string[], pattern: RegExp) {
  const metadata = Bun.spawnSync([
    "cargo", "metadata", "--locked", "--offline", "--no-deps", "--format-version", "1",
    "--manifest-path", "tools/evaluation/Cargo.toml",
  ], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect(metadata.exitCode, metadata.stderr.toString()).toBe(0);
  const evaluation = JSON.parse(metadata.stdout.toString()).packages.find((item: { name: string }) => item.name === "evaluation");
  const targets = evaluation.targets.filter((target: { kind: string[] }) => target.kind.includes("test"))
    .map((target: { name: string }) => target.name);
  expect(targets.filter((name: string) => name === target || groups.includes(name))).toEqual([target]);
  const entry = readFileSync(resolve(root, `tools/evaluation/tests/${target}.rs`), "utf8");
  for (const name of groups) {
    expect(entry.split(`#[path = "cases/${name}.rs"]\nmod ${name};`).length - 1).toBe(1);
  }
  const cases = readdirSync(resolve(root, "tools/evaluation/tests/cases"))
    .filter(name => pattern.test(name)).sort();
  expect(cases).toEqual(groups.map(name => `${name}.rs`).sort());
}

test("verification runs every evaluation regression, including safety suites", () => {
  const preview = Bun.spawnSync(["make", "-n", "test"], {
    cwd: root, stdout: "pipe", stderr: "pipe",
  });
  expect(preview.exitCode, preview.stderr.toString()).toBe(0);
  const commands = preview.stdout.toString();
  expect(commands).toContain("cargo test --locked --manifest-path tools/evaluation/Cargo.toml --lib --tests");
});
