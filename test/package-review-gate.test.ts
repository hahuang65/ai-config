import { expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

test("cold test runs build every manifest release target before package validation", () => {
  const preview = Bun.spawnSync(["make", "-n", "test"], {
    cwd: root, stdout: "pipe", stderr: "pipe",
  });
  expect(preview.exitCode, preview.stderr.toString()).toBe(0);
  const commands = preview.stdout.toString();
  const packageTests = commands.indexOf("bun test ");
  const rustTests = commands.indexOf("cargo test --locked --offline --manifest-path tools/evaluation/Cargo.toml");
  for (const tool of ["worktree", "worklog", "artifact-review", "evaluation"]) {
    const release = `cargo build --locked --offline --release --manifest-path tools/${tool}/Cargo.toml`;
    const position = commands.indexOf(release);
    expect(position).toBeGreaterThanOrEqual(0);
    expect(position).toBeLessThan(packageTests);
    expect(position).toBeLessThan(rustTests);
  }
});

test("browser integration checks build their debug CLI explicitly before use", () => {
  const preview = Bun.spawnSync(["make", "-n", "test"], {
    cwd: root, stdout: "pipe", stderr: "pipe",
  });
  expect(preview.exitCode, preview.stderr.toString()).toBe(0);
  const commands = preview.stdout.toString();
  const build = "cargo build --locked --offline --manifest-path tools/artifact-review/Cargo.toml";
  const browser = "node --test --test-concurrency=1 tools/artifact-review/tests/integration.mjs";
  expect(commands).toContain(build);
  expect(commands.indexOf(build)).toBeLessThan(commands.indexOf(browser));
});

test("offline gate builds and runs process-level worktree parity", () => {
  const preview = Bun.spawnSync(["make", "-n", "test"], {
    cwd: root, stdout: "pipe", stderr: "pipe",
  });
  expect(preview.exitCode, preview.stderr.toString()).toBe(0);
  const commands = preview.stdout.toString();
  const build = "cargo build --locked --offline --manifest-path tools/worktree/Cargo.toml";
  const parity = "python tools/worktree/tests/rust_parity.py";
  expect(commands).toContain(build);
  expect(commands).toContain(parity);
  expect(commands.indexOf(build)).toBeLessThan(commands.indexOf(parity));
});

test("offline verification runs every evaluation regression, including safety suites", () => {
  const preview = Bun.spawnSync(["make", "-n", "test"], {
    cwd: root, stdout: "pipe", stderr: "pipe",
  });
  expect(preview.exitCode, preview.stderr.toString()).toBe(0);
  const commands = preview.stdout.toString();
  expect(commands).toContain("cargo test --locked --offline --manifest-path tools/evaluation/Cargo.toml --lib --tests");
});
