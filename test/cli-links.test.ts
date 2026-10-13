import { afterEach, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { peerSource } from "./peer-sources";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(name: "wt" | "wl") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `rust-${name}-install-`)));
  roots.push(root);
  const project = join(root, "project with spaces"), home = join(root, "home");
  mkdirSync(join(project, "target/release"), { recursive: true });
  mkdirSync(join(home, ".local/bin"), { recursive: true });
  const cargo = join(root, "cargo"), binary = join(project, `target/release/${name}`);
  writeFileSync(cargo, "#!/bin/sh\nexit 0\n");
  chmodSync(cargo, 0o755);
  writeFileSync(binary, "fixture executable\n");
  copyFileSync(join(peerSource(name), "Makefile"), join(project, "Makefile"));
  const launcher = join(home, `.local/bin/${name}`);
  const run = (action: string) => spawnSync("make", ["--no-print-directory", action], {
    cwd: project, env: { PATH: `${root}:${process.env.PATH}`, HOME: home }, encoding: "utf8", timeout: 10000,
  });
  return { launcher, binary, root, run };
}

for (const name of ["wt", "wl"] as const) {
  test(`${name} component Makefile cannot install or remove Rust-owned links`, () => {
    const f = fixture(name);
    expect(f.run("install").status).not.toBe(0);
    expect(f.run("uninstall").status).not.toBe(0);
    expect(existsSync(f.launcher)).toBe(false);
    expect(readFileSync(f.binary, "utf8")).toBe("fixture executable\n");
  });

  test(`${name} disabled component installers preserve foreign files and dangling links`, () => {
    const f = fixture(name);
    writeFileSync(f.launcher, "unrelated launcher\n");
    expect(f.run("install").status).not.toBe(0);
    expect(f.run("uninstall").status).not.toBe(0);
    expect(readFileSync(f.launcher, "utf8")).toBe("unrelated launcher\n");
    rmSync(f.launcher);
    const missing = join(f.root, "missing");
    symlinkSync(missing, f.launcher);
    expect(f.run("install").status).not.toBe(0);
    expect(f.run("uninstall").status).not.toBe(0);
    expect(readlinkSync(f.launcher)).toBe(missing);
  });
}
