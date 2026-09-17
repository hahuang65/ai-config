import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { findFloorGaps, formatMatrix, floorPolicies, type Coverage } from "../shared/conformance";
import { POLICIES } from "../shared/policy-registry";
import { evaluate, type ToolCall } from "../shared/guard-core";
import piGuard, { createGuardPoliciesExtension } from "../harnesses/pi/extensions/guard-policies";
import { evaluateClaudePayload } from "../harnesses/claude/hooks/guard-verdict";

const HARNESSES = ["pi", "Claude Code"];

// The conformance probe for each policy is its registry `example` — no
// separate map to drift from the registry.

// Drive pi's in-process default export through its tool_call adapter shape.
function inProcessBlocks(guard: (pi: unknown) => void, call: ToolCall): boolean {
  let handler: ((e: unknown, ctx: unknown) => any) | undefined;
  guard({ on: (n: string, f: any) => { if (n === "tool_call") handler = f; } });
  const verdict = handler!(
    {
      toolName: call.tool,
      input: { command: call.command, path: call.path, pattern: call.pattern, content: call.content },
    },
    { cwd: call.cwd },
  );
  return !!(verdict && verdict.block);
}

// Claude Code (tier B): exercise the same normalization used by the command
// hook. A separate smoke test retains real stdin/stdout transport evidence.
async function claudeBlocks(call: ToolCall): Promise<boolean> {
  return claudeBlocksWithHomes(call);
}

async function claudeBlocksWithHomes(
  call: ToolCall,
  environmentHome?: string,
  platformHome?: string,
): Promise<boolean> {
  const payload = {
    cwd: call.cwd,
    tool_name: call.tool,
    tool_input: {
      command: call.command,
      file_path: call.path,
      pattern: call.pattern,
      content: call.content,
    },
  };
  const verdict = platformHome === undefined
    ? evaluateClaudePayload(payload)
    : evaluateClaudePayload(payload, { environmentHome, platformHome });
  return verdict?.hookSpecificOutput.permissionDecision === "deny";
}

const ADAPTERS = [
  { name: "pi", blocks: async (c: ToolCall) => inProcessBlocks(piGuard, c) },
  { name: "Claude Code", blocks: claudeBlocks },
];

async function liveCoverage(): Promise<Coverage> {
  const coverage: Coverage = {};
  for (const policy of POLICIES) {
    coverage[policy.id] = {};
    for (const adapter of ADAPTERS) {
      coverage[policy.id][adapter.name] = await adapter.blocks(policy.example);
    }
  }
  return coverage;
}

test("every harness resolves an absent HOME and fails closed for an invalid HOME", async () => {
  const platformHome = "/Users/platform-user";
  const protectedCall: ToolCall = {
    tool: "read",
    path: `${platformHome}/.review-publication/review-publication-worker.mjs`,
  };
  const ordinaryCall: ToolCall = { tool: "read", path: "/tmp/ordinary-file" };
  const absentHomePi = createGuardPoliciesExtension({ environmentHome: undefined, platformHome });
  const invalidHomePi = createGuardPoliciesExtension({ environmentHome: "relative/home", platformHome });

  expect(inProcessBlocks(absentHomePi, protectedCall)).toBe(true);
  expect(await claudeBlocksWithHomes(protectedCall, undefined, platformHome)).toBe(true);
  expect(inProcessBlocks(invalidHomePi, ordinaryCall)).toBe(true);
  expect(await claudeBlocksWithHomes(ordinaryCall, "relative/home", platformHome)).toBe(true);
});

test("every harness blocks an unscoped branch switch beneath Orchard", async () => {
  const call: ToolCall = {
    tool: "bash",
    command: "git switch accidental-branch",
    cwd: "/home/example/.orchard/alpha/task",
  };

  expect(evaluate(call)?.policy).toBe("no-orchard-branch-binding-change");
  for (const adapter of ADAPTERS) {
    expect(await adapter.blocks(call), `${adapter.name} should block the branch switch`).toBe(true);
  }
});

test("every policy's example violates it and its counter-example does not", () => {
  // The registry pins both sides of each policy's boundary; the core agrees.
  for (const policy of POLICIES) {
    expect(evaluate(policy.example)?.policy, `${policy.id}: example should violate ${policy.id}`).toBe(policy.id);
    expect(evaluate(policy.counterExample)?.policy, `${policy.id}: counter-example should not trip ${policy.id}`).not.toBe(policy.id);
  }
});

test("every harness enforces every floor policy", async () => {
  // Derive the harness list from the adapters under test so coverage and the
  // gap analysis can never silently diverge (e.g. when pi is promoted).
  const names = ADAPTERS.map((a) => a.name);
  const coverage = await liveCoverage();
  console.log("\n" + formatMatrix(coverage, names) + "\n");
  expect(findFloorGaps(coverage, names)).toEqual([]);
});

test("every harness blocks ordinary model tools from reading or altering all publication state", async () => {
  const home = process.env.HOME ?? "/home/example";
  const commands = [
    "cat ~/.review-publication/signing-key",
    "cp '$HOME/.claude/review-publication-sessions/session.json' /tmp/session",
    "rm -rf ${HOME}/safe/../.review-publication",
    "find $HOME -name '*.json'",
    "rg session",
  ];
  const fileCalls: ToolCall[] = [
    { tool: "read", path: "~/.review-publication/signing-key" },
    { tool: "write", path: "$HOME/.claude/review-publication-sessions/session.json", content: "replacement" },
    { tool: "edit", path: `${home}/.review-publication/signing-key`, content: "replacement" },
    { tool: "grep", cwd: home },
    { tool: "glob", cwd: home, pattern: ".claude/review-publication-sessions/**/*.json" },
    { tool: "glob", path: `${home}/project`, pattern: "../.review-publication/**/*", cwd: "/tmp" },
  ];
  for (const adapter of ADAPTERS) {
    for (const call of [...fileCalls, ...commands.map((command) => ({ tool: "bash", command, cwd: home }))]) {
      expect(await adapter.blocks(call), `${adapter.name} should block ${call.tool}`).toBe(true);
    }
  }
});

test("every harness blocks protected filesystem access from ordinary inline interpreters", async () => {
  const home = process.env.HOME ?? "/home/example";
  const commands = [
    `node -e "require('fs').readFileSync(require('os').homedir() + '/.review-publication/signing-key')"`,
    `bun -e "await Bun.file(process.env.HOME + '/.claude/review-publication-sessions/session.json').text()"`,
    `python3 -c "from pathlib import Path; Path.home().joinpath('.review-publication', 'signing-key').unlink()"`,
    `ruby -e 'File.rename(File.join(Dir.home, ".review-publication", "a"), "/tmp/a")'`,
    `perl -e 'open my $fh, "<", "$ENV{HOME}/.review-publication/signing-key"'`,
    `sh -c 'node -e "require(\"fs\").openSync(require(\"os\").homedir() + \"/.review-publication/signing-key\")"'`,
  ];
  for (const adapter of ADAPTERS) {
    for (const command of commands) {
      expect(await adapter.blocks({ tool: "bash", command, cwd: `${home}/project` }), `${adapter.name} should block ${command}`).toBe(true);
    }
    expect(await adapter.blocks({
      tool: "bash",
      command: `python3 -c "from pathlib import Path; print(Path('/tmp/example').read_text())"`,
      cwd: `${home}/project`,
    }), `${adapter.name} should allow unrelated inline code`).toBe(false);
  }
});

test("every harness blocks production publication workers and path-changing operations", async () => {
  const home = process.env.HOME ?? "/home/example";
  const commands = [
    "review-publication --inetd",
    "node skills/review-change/bin/review-publication.mjs --inetd",
    "node review-publication/review-publication-worker.bundle.mjs --inetd",
    "sh -c 'review-publication --inetd'",
    "~/.local/bin/review-* --inetd",
    "mv $HOME /tmp/home",
    "mv /tmp/replacement ~/.claude",
    "mv /tmp/replacement ~/.review-publication",
    "cd project; mv ../.review-publication /tmp/state",
  ];
  for (const adapter of ADAPTERS) {
    for (const command of commands) {
      expect(await adapter.blocks({ tool: "bash", command, cwd: home }), `${adapter.name} should block ${command}`).toBe(true);
    }
    expect(await adapter.blocks({ tool: "bash", command: "mv old-name new-name", cwd: `${home}/project` })).toBe(false);
  }
});

test("every harness applies shell escape semantics to publication guard checks", async () => {
  const home = process.env.HOME ?? "/home/example";
  const blockedCommands = [
    "cat $HOME/\\.review\\-publication/signing-key",
    "review\\-publication \\-\\-inetd",
    "node review\\-publication/review\\-publication\\-worker\\.bundle\\.mjs --inetd",
    "sh -c 'review\\-publication \\-\\-inetd'",
    "review-publi\\\ncation --in\\\netd",
  ];
  const allowedCommands = [
    String.raw`"review\-publication" --inetd`,
    String.raw`review\\-publication --inetd`,
    String.raw`printf hello\ world`,
  ];
  for (const adapter of ADAPTERS) {
    for (const command of blockedCommands) {
      expect(await adapter.blocks({ tool: "bash", command, cwd: home }), `${adapter.name} should block ${command}`).toBe(true);
    }
    for (const command of allowedCommands) {
      expect(await adapter.blocks({ tool: "bash", command, cwd: home }), `${adapter.name} should allow ${command}`).toBe(false);
    }
  }
});

test("every harness blocks protected access after sequential directory changes", async () => {
  const home = process.env.HOME ?? "/home/example";
  const commands = [
    `cd ${home}; cd .review-publication && cat signing-key`,
    `cd ${home}/project && cd ..\nfind . -type f`,
    "cd $HOME && rg session",
    "cd $TARGET && find . -type f",
    "cd $TARGET; cat signing-key",
  ];
  for (const adapter of ADAPTERS) {
    for (const command of commands) {
      expect(await adapter.blocks({ tool: "bash", command, cwd: "/tmp" }), `${adapter.name} should block ${command}`).toBe(true);
    }
    expect(await adapter.blocks({ tool: "bash", command: "find" }), `${adapter.name} should block a pathless recursive tool`).toBe(true);
    expect(await adapter.blocks({
      tool: "bash",
      command: "cd /tmp && rg session .; cd safe && pwd",
      cwd: home,
    }), `${adapter.name} should allow unrelated directory changes`).toBe(false);
  }
});

test("every harness tracks directory changes inside nested shell command text", async () => {
  const home = process.env.HOME ?? "/home/example";
  const commands = [
    "sh -c 'cd ..; cd .review-publication && cat signing-key'",
    "bash -c 'cd; find . -type f'",
    "dash -c 'cd --; rg session'",
    "env LANG=C sh -c 'cd ..; command bash -c \"cd .claude/review-publication-sessions; mv session.json /tmp/session\"'",
  ];
  for (const adapter of ADAPTERS) {
    for (const command of commands) {
      expect(await adapter.blocks({ tool: "bash", command, cwd: `${home}/project` }), `${adapter.name} should block ${command}`).toBe(true);
    }
    expect(await adapter.blocks({
      tool: "bash",
      command: "command sh -c 'cd /tmp && find safe -type f'",
      cwd: `${home}/project`,
    }), `${adapter.name} should allow unrelated nested shell commands`).toBe(false);
  }
});

test("the Claude shim preserves recursive cwd and glob prefix scope", async () => {
  const home = process.env.HOME ?? "/home/example";
  expect(await claudeBlocks({ tool: "grep", cwd: home })).toBe(true);
  expect(await claudeBlocks({ tool: "glob", pattern: "../**/*", cwd: `${home}/project` })).toBe(true);
  expect(await claudeBlocks({
    tool: "glob",
    path: `${home}/project`,
    pattern: "../.claude/review-publication-sessions/**/*.json",
    cwd: "/tmp",
  })).toBe(true);
});

test("the pi adapter preserves recursive cwd and glob prefix scope", async () => {
  const home = process.env.HOME ?? "/home/example";
  expect(inProcessBlocks(piGuard, { tool: "find", cwd: home })).toBe(true);
  expect(inProcessBlocks(piGuard, {
    tool: "glob",
    pattern: "../**/*",
    cwd: `${home}/project`,
  })).toBe(true);
  expect(inProcessBlocks(piGuard, {
    tool: "glob",
    path: `${home}/project`,
    pattern: "../.claude/review-publication-sessions/**/*.json",
    cwd: "/tmp",
  })).toBe(true);
});

test("Claude routes recursive file tools through the shared guard shim", async () => {
  const settings = JSON.parse(await readFile(new URL("../harnesses/claude/settings.json", import.meta.url), "utf8"));
  const guardHook = settings.hooks.PreToolUse.find((entry: any) => (
    entry.hooks?.some((hook: any) => String(hook.command).endsWith("/hooks/guard.ts"))
  ));

  expect(guardHook?.matcher).toBe("Read|Edit|Write|Bash|Grep|Glob");
});

test("the coverage matrix labels floor policies and lists every harness", () => {
  const coverage = { "no-secret-access": { pi: true, "Claude Code": true } };
  const matrix = formatMatrix(coverage, HARNESSES);
  expect(matrix).toContain("no-secret-access");
  expect(matrix).toContain("floor");
  expect(matrix).toContain("Claude Code");
});

test("reports a floor policy left uncovered by a harness", () => {
  const coverage = { "no-secret-access": { pi: true, "Claude Code": false } };
  const gaps = findFloorGaps(coverage, HARNESSES);
  expect(gaps).toContainEqual({ policy: "no-secret-access", harness: "Claude Code" });
});

test("does not report an uncovered non-floor policy as a gap", () => {
  // Every floor policy covered; a non-floor policy left uncovered.
  const coverage: Coverage = {};
  for (const policy of floorPolicies()) {
    coverage[policy.id] = { pi: true, "Claude Code": true };
  }
  coverage["no-shell-write"] = { pi: false, "Claude Code": false };
  expect(findFloorGaps(coverage, HARNESSES)).toEqual([]);
});
