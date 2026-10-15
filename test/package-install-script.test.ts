import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installFixture } from "./fixtures/install-script";

test("install.sh refuses a missing jq before building or changing the home", () => {
  const setup = installFixture();
  try {
    symlinkSync(Bun.which("dirname")!, join(setup.bin, "dirname"));
    const result = setup.run([], { PATH: setup.bin });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("jq is required");
    expect(result.stdout).toBe("");
    expect(setup.calls()).toBe("");
    expect(existsSync(join(setup.home, ".local/state/ai-config"))).toBe(false);
  } finally { setup.clean(); }
});

test("install.sh refuses missing GNU coreutils before building or installing", () => {
  const setup = installFixture();
  try {
    for (const tool of ["mv", "stat", "dd", "sync", "head", "readlink"]) {
      writeFileSync(join(setup.bin, tool), "#!/bin/sh\nexit 64\n", { mode: 0o755 });
      const result = setup.run();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`GNU coreutils (${tool}) is required`);
      expect(result.stdout).toBe("");
      expect(setup.calls()).toBe("");
      expect(existsSync(join(setup.home, ".local/state/ai-config"))).toBe(false);
      unlinkSync(join(setup.bin, tool));
    }
  } finally { setup.clean(); }
});

test("install.sh manages ownership and settings in a disposable home without touching unrelated resources", () => {
  const setup = installFixture();
  try {
    mkdirSync(join(setup.home, ".pi/agent"), { recursive: true });
    const settings = join(setup.home, ".pi/agent/settings.json");
    writeFileSync(settings, JSON.stringify({ defaultProvider: "personal-provider", defaultModel: "personal-model" }));
    const personal = join(setup.home, ".pi/agent/personal.md");
    writeFileSync(personal, "unrelated resource\n");
    const result = setup.run();
    expect({ status: result.status, error: result.error, stderr: result.stderr }).toEqual({ status: 0, error: undefined, stderr: "" });
    expect(readlinkSync(join(setup.home, ".pi/agent/AGENTS.md"))).toBe(join(setup.source, "baseline.md"));
    expect(readlinkSync(join(setup.home, ".claude/CLAUDE.md"))).toBe(join(setup.source, "baseline.md"));
    expect(JSON.parse(readFileSync(settings, "utf8"))).toMatchObject({
      defaultProvider: "personal-provider", defaultModel: "personal-model", theme: "catppuccin-mocha",
    });
    expect(readFileSync(personal, "utf8")).toBe("unrelated resource\n");
    const record = join(setup.home, ".local/state/ai-config/installation.json");
    const ownership = readFileSync(record, "utf8");
    expect(setup.run().status).toBe(0);
    expect(readFileSync(record, "utf8")).toBe(ownership);
    expect(existsSync(join(setup.home, ".review-publication"))).toBe(false);
    expect(existsSync(join(setup.home, ".agentmemory"))).toBe(false);
  } finally { setup.clean(); }
}, 30_000);

test("install.sh refuses a HOME inside its own source before creating state or building", () => {
  const setup = installFixture();
  try {
    const result = setup.run([], { HOME: setup.source });
    expect(result.status).toBe(1);
    expect(setup.calls()).toBe("");
    expect(result.stderr).toContain("inside the configuration source");
    expect(existsSync(join(setup.source, ".local"))).toBe(false);
  } finally { setup.clean(); }
}, 30_000);

test("install.sh preserves a failed build's status and never starts installation", () => {
  const setup = installFixture();
  try {
    const result = setup.run([], { BUILD_STATUS: "17" });
    expect(result.status).toBe(17);
    expect(setup.calls()).toBe(`${setup.source}\nbuild\n`);
    expect(existsSync(join(setup.home, ".local"))).toBe(false);
  } finally { setup.clean(); }
});

test("install.sh reports installation failure without adopting an unrelated file", () => {
  const setup = installFixture();
  try {
    mkdirSync(join(setup.home, ".claude"));
    const collision = join(setup.home, ".claude/CLAUDE.md");
    writeFileSync(collision, "personal instructions\n");
    const result = setup.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unrelated destination");
    expect(readFileSync(collision, "utf8")).toBe("personal instructions\n");
    expect(existsSync(join(setup.home, ".local/state/ai-config/installation.json"))).toBe(false);
    expect(existsSync(join(setup.home, ".pi"))).toBe(false);
  } finally { setup.clean(); }
}, 30_000);

test("install.sh help describes effects without building or installing", () => {
  const setup = installFixture();
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
  } finally { setup.clean(); }
});

test("install.sh rejects unsupported arguments before any build or installation", () => {
  const setup = installFixture();
  try {
    for (const args of [["--force"], ["install"], ["--root", "/other"], ["--help", "extra"]]) {
      const result = setup.run(args);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("Usage: install.sh");
      expect(result.stdout).toBe("");
      expect(setup.calls()).toBe("");
    }
  } finally { setup.clean(); }
});

test("install.sh builds and installs its own checkout when called from another directory", () => {
  const setup = installFixture();
  try {
    const result = setup.run();
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
    expect(setup.calls()).toBe(`${setup.source}\nbuild\n`);
    const record = JSON.parse(readFileSync(join(setup.home, ".local/state/ai-config/installation.json"), "utf8"));
    expect(record.source).toBe(setup.source);
  } finally { setup.clean(); }
}, 30_000);
