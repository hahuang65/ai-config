import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { projectPiHost } from "../tools/project-pi.mjs";

const source = fileURLToPath(new URL("../", import.meta.url));
const host = projectPiHost();

test.skipIf(!host.standalone)("the installed standalone binary delegates through its matching SDK with the read-only floor", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-standalone-runtime-")));
  try {
    const home = join(root, "home"), cwd = join(root, "project"), agentDir = join(home, ".pi/agent");
    mkdirSync(cwd);
    mkdirSync(join(agentDir, "extensions/subagent"), { recursive: true });
    writeFileSync(join(agentDir, "extensions/subagent/config.json"),
      readFileSync(join(source, "harnesses/pi/specialists/policy.json"), "utf8"));
    const evidence = join(root, "requests.jsonl");
    const run = spawnSync(host.executable, ["--mode", "json", "--no-session", "--offline", "--no-extensions",
      "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files", "--no-approve",
      "-e", join(source, "test/fixtures/pi-standalone-provider.ts"),
      "-e", join(source, "harnesses/pi/specialists.bundle.ts"),
      "--model", "standalone-fixture/fixture", "--thinking", "off", "Consult the API designer."], {
      cwd, encoding: "utf8", timeout: 45000, maxBuffer: 1024 * 1024,
      env: { HOME: home, TMPDIR: root, PATH: process.env.PATH, PI_CODING_AGENT_DIR: agentDir,
        PI_OFFLINE: "1", STANDALONE_EVIDENCE: evidence, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).not.toContain("Failed to load extension");
    const requests = readFileSync(evidence, "utf8").trim().split("\n").map(line => JSON.parse(line));
    const failures = run.stdout.trim().split("\n").map(line => JSON.parse(line))
      .filter(event => event.type === "tool_execution_end" && event.isError);
    expect(failures).toEqual([]);
    expect(requests).toHaveLength(3);
    expect(requests[1].tools).toEqual(["read", "grep", "find", "ls"]);
    expect(requests[1].system).toContain("# API designer");
    expect(run.stdout).toContain("STANDALONE_SDK_OK");
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 50000);
