import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveAgentModel } from "../harnesses/pi/extensions/subagent/model-selection";
import { parseAgentTools } from "../harnesses/pi/extensions/subagent/tool-names";

const piManifest = new URL("../harnesses/pi/manifest.sh", import.meta.url).pathname;
const piModule = new URL("../harnesses/pi", import.meta.url).pathname;
const subagentPackageRelative = join(
  "libexec",
  "lib",
  "node_modules",
  "@earendil-works",
  "pi-coding-agent",
  "examples",
  "extensions",
  "subagent",
);

function addPiVersion(homebrew: string, version: string) {
  const versionRoot = join(homebrew, "Cellar", "pi-coding-agent", version);
  const subagentRoot = join(versionRoot, subagentPackageRelative);
  mkdirSync(join(versionRoot, "bin"), { recursive: true });
  mkdirSync(join(subagentRoot, "agents"), { recursive: true });
  writeFileSync(join(versionRoot, "bin", "pi"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(versionRoot, "bin", "pi"), 0o755);
  writeFileSync(join(subagentRoot, "index.ts"), `// pi ${version}\n`);
  for (const agent of ["planner", "reviewer", "scout", "worker"]) {
    writeFileSync(join(subagentRoot, "agents", `${agent}.md`), `pi ${version}\n`);
  }
  return versionRoot;
}

function installPiManifest(home: string, homebrew: string) {
  return spawnSync(
    "bash",
    [
      "-c",
      'dim() { :; }; prune_repo_rule_links() { :; }; prune_repo_command_links() { :; }; prune_dangling() { :; }; source "$PI_MANIFEST"; install_module',
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        MOD: piModule,
        PATH: `${join(homebrew, "bin")}:${process.env.PATH ?? ""}`,
        PI_MANIFEST: piManifest,
      },
    },
  );
}

test("normalizes shared YAML agent tool arrays for pi subagents", () => {
  expect(parseAgentTools(["Read", "Write", "Bash", "Glob"])).toEqual(["read", "write", "bash", "find"]);
});

test("rejects unsupported-only and mixed tool declarations instead of enabling defaults", () => {
  expect(() => parseAgentTools(["WebFetch"])).toThrow("Unsupported pi subagent tools: WebFetch");
  expect(() => parseAgentTools(["Read", "WebSearch"])).toThrow("Unsupported pi subagent tools: WebSearch");
});

test("normalizes comma-separated tool declarations", () => {
  expect(parseAgentTools("Read, Grep, Glob")).toEqual(["read", "grep", "find"]);
});

test("inherits the CLI-selected model for Review change subagents", () => {
  const environment = {
    REVIEW_CHANGE_GATE: "1",
    REVIEW_CHANGE_SUBAGENT_MODEL: "openai/gpt-5",
  };

  expect(resolveAgentModel("change-reviewer", undefined, environment)).toBe("openai/gpt-5");
  expect(resolveAgentModel("database-reviewer", undefined, environment)).toBe("openai/gpt-5");
  expect(resolveAgentModel("change-fixer", "sonnet", environment)).toBe("sonnet");
});

test("uses the pi default model for Review change subagents without an override", () => {
  expect(resolveAgentModel("change-reviewer", undefined, { REVIEW_CHANGE_GATE: "1" })).toBeUndefined();
  expect(resolveAgentModel("change-reviewer", undefined, {})).toBeUndefined();
});

test("all shared agents use the harness default model", () => {
  const agentsDirectory = new URL("../agents/", import.meta.url);
  const agentsWithModels = readdirSync(agentsDirectory)
    .filter((fileName) => fileName.endsWith(".md"))
    .filter((fileName) => /^model:/m.test(readFileSync(new URL(fileName, agentsDirectory), "utf8")));

  expect(agentsWithModels).toEqual([]);
});

test("the pi manifest bounds relative executable traversal", () => {
  const manifest = readFileSync(new URL("../harnesses/pi/manifest.sh", import.meta.url), "utf8");

  expect(manifest).toContain('*) pi_real="$(pwd -P)/$pi_real" ;;');
  expect(manifest).toContain('[ "$parent" = "$dir" ] && break');
});

test("keeps Homebrew subagent links healthy across pi upgrades without installing example agents", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "ai-config-pi-homebrew-"));
  const home = join(fixtureRoot, "home");
  const homebrew = join(fixtureRoot, "homebrew");

  try {
    const firstVersionRoot = addPiVersion(homebrew, "0.84.4");
    mkdirSync(join(homebrew, "bin"), { recursive: true });
    mkdirSync(join(homebrew, "opt"), { recursive: true });
    symlinkSync(join("..", "Cellar", "pi-coding-agent", "0.84.4", "bin", "pi"), join(homebrew, "bin", "pi"));
    symlinkSync(join("..", "Cellar", "pi-coding-agent", "0.84.4"), join(homebrew, "opt", "pi-coding-agent"));
    const installedAgents = join(home, ".pi", "agent", "agents");
    mkdirSync(installedAgents, { recursive: true });
    for (const agent of ["planner", "reviewer", "scout", "worker"]) {
      symlinkSync(
        join(firstVersionRoot, subagentPackageRelative, "agents", `${agent}.md`),
        join(installedAgents, `${agent}.md`),
      );
    }

    const installation = installPiManifest(home, homebrew);
    expect(installation.status, installation.stderr).toBe(0);

    const installedIndex = join(home, ".pi", "agent", "extensions", "subagent", "index.ts");
    const stablePackageRoot = join(homebrew, "opt", "pi-coding-agent");
    expect(readlinkSync(installedIndex)).toBe(join(stablePackageRoot, subagentPackageRelative, "index.ts"));
    for (const agent of ["planner", "reviewer", "scout", "worker"]) {
      expect(() => readlinkSync(join(installedAgents, `${agent}.md`))).toThrow();
    }

    writeFileSync(join(installedAgents, "reviewer.md"), "user owned\n");
    const reinstall = installPiManifest(home, homebrew);
    expect(reinstall.status, reinstall.stderr).toBe(0);
    expect(readFileSync(join(installedAgents, "reviewer.md"), "utf8")).toBe("user owned\n");

    addPiVersion(homebrew, "0.85.1");
    rmSync(join(homebrew, "opt", "pi-coding-agent"));
    symlinkSync(join("..", "Cellar", "pi-coding-agent", "0.85.1"), join(homebrew, "opt", "pi-coding-agent"));
    rmSync(firstVersionRoot, { recursive: true });
    expect(readFileSync(installedIndex, "utf8")).toBe("// pi 0.85.1\n");
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("the runtime adapter imports the installed TypeScript helper", () => {
  const adapter = readFileSync(new URL("../harnesses/pi/extensions/subagent/agents.ts", import.meta.url), "utf8");

  expect(adapter).toContain('from "./tool-names.ts"');
  expect(adapter).toContain('from "./model-selection.ts"');
  expect(adapter).not.toContain('from "./tool-names.js"');
});
