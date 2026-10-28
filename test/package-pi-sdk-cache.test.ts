import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildSdk, discover, sdkBuildFixture } from "./fixtures/standalone-pi";

for (const component of ["target", "target/pi-sdk", "target/pi-sdk/1.4.0"]) {
  test(`restoration refuses a symlinked ${component} directory without writing outside the checkout`, () => {
    const setup = sdkBuildFixture();
    try {
      const location = join(setup.root, component), outside = join(setup.root, "outside");
      mkdirSync(dirname(location), { recursive: true });
      mkdirSync(outside);
      symlinkSync(outside, location, "dir");
      expect(buildSdk(setup).status).toBe(1);
      expect(readdirSync(outside)).toEqual([]);
      expect(existsSync(join(setup.root, "npm-calls"))).toBe(false);
    } finally { rmSync(setup.root, { recursive: true, force: true }); }
  });
}

for (const kind of ["symlink", "file"]) {
  test(`restoration refuses a ${kind} node_modules before npm runs`, () => {
    const setup = sdkBuildFixture();
    try {
      const directory = join(setup.root, "target/pi-sdk/1.4.0"), outside = join(setup.root, "outside");
      mkdirSync(directory, { recursive: true });
      mkdirSync(outside);
      writeFileSync(join(outside, "keep"), "OUTSIDE_MODULES_KEEP");
      if (kind === "symlink") symlinkSync(outside, join(directory, "node_modules"), "dir");
      else writeFileSync(join(directory, "node_modules"), "NOT_A_DIRECTORY");
      expect(buildSdk(setup).status).toBe(1);
      expect(existsSync(join(setup.root, "npm-calls"))).toBe(false);
      expect(existsSync(join(directory, "package.json"))).toBe(false);
      expect(readdirSync(outside)).toEqual(["keep"]);
      expect(readFileSync(join(outside, "keep"), "utf8")).toBe("OUTSIDE_MODULES_KEEP");
    } finally { rmSync(setup.root, { recursive: true, force: true }); }
  });
}

for (const metadata of ["package.json", "package-lock.json", ".ready"]) {
  test(`a linked ${metadata} cannot be reused or overwritten during restoration`, () => {
    const setup = sdkBuildFixture();
    try {
      expect(buildSdk(setup).status).toBe(0);
      const location = join(setup.root, "target/pi-sdk/1.4.0", metadata);
      const original = readFileSync(location), outside = join(setup.root, "outside-metadata");
      writeFileSync(outside, original);
      rmSync(location);
      symlinkSync(outside, location);
      expect(discover(setup).status).toBe(1);
      expect(buildSdk(setup).status).toBe(1);
      expect(readFileSync(outside)).toEqual(original);
      expect(readFileSync(join(setup.root, "npm-calls"), "utf8").trim().split("\n")).toHaveLength(1);
    } finally { rmSync(setup.root, { recursive: true, force: true }); }
  });
}

test("SDK package metadata outside the dependency tree is refused without reading or altering it", () => {
  const setup = sdkBuildFixture();
  try {
    expect(buildSdk(setup).status).toBe(0);
    const file = join(setup.sdk, "package.json"), outside = join(setup.root, "outside-package.json");
    writeFileSync(outside, "PRIVATE_EXTERNAL_METADATA");
    rmSync(file);
    symlinkSync(outside, file);
    const run = discover(setup);
    expect(run.status).toBe(1);
    expect(run.stderr).not.toContain("PRIVATE_EXTERNAL_METADATA");
    expect(buildSdk(setup).status).toBe(0);
    expect(readFileSync(outside, "utf8")).toBe("PRIVATE_EXTERNAL_METADATA");
  } finally { rmSync(setup.root, { recursive: true, force: true }); }
});

test("a retained restore lock is not bypassed or treated as a ready SDK", () => {
  const setup = sdkBuildFixture();
  try {
    expect(buildSdk(setup).status).toBe(0);
    const lock = join(setup.root, "target/pi-sdk/1.4.0/.restore-lock");
    mkdirSync(lock);
    expect(buildSdk(setup).status).toBe(1);
    expect(discover(setup).status).toBe(1);
    expect(existsSync(lock)).toBe(true);
    expect(readFileSync(join(setup.root, "npm-calls"), "utf8").trim().split("\n")).toHaveLength(1);
  } finally { rmSync(setup.root, { recursive: true, force: true }); }
});
