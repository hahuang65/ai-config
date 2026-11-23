import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeShellParser } from "../guard/shell-parser";
import type { Classifier } from "../guard/semantic-scope";
import { evaluateClaudePayload } from "../harnesses/claude/guard-verdict";
import { evaluateSemanticScope } from "../harnesses/claude/semantic-scope";
import { createGuardPoliciesExtension as sourceGuard } from "../harnesses/pi/guard-policies";
import { createGuardPoliciesExtension as bundledGuard } from "../harnesses/pi/guard-policies.bundle";

beforeAll(async () => { expect(await initializeShellParser()).toBe(true); });

type Adapter = { name: string; check(command: string): Promise<string | undefined> };

function piAdapter(factory: typeof sourceGuard, home: string, ctx: any): Adapter["check"] {
  let handler: Function;
  factory({ environmentHome: home, platformHome: home })({
    on: (name: string, callback: Function) => { if (name === "tool_call") handler = callback; },
  } as any);
  return async command => {
    const result = await handler!({ toolName: "bash", input: { command } }, ctx);
    return result?.block ? result.reason : undefined;
  };
}

function fixture(probability: number | null = 0.99) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "jev-redirections-")));
  const cwd = join(home, "project"), directory = join(home, ".claude/projects/fixture");
  mkdirSync(cwd);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(cwd, "source.ts"), "KEEP_SOURCE\n");
  const session = "11111111-1111-4111-8111-111111111111", transcript = join(directory, `${session}.jsonl`);
  const message = { role: "user", content: "Inspect the source without changing files." };
  writeFileSync(transcript, JSON.stringify({ type: "user", sessionId: session, uuid: "u1", parentUuid: null, message }) + "\n");
  const calls: unknown[] = [];
  const classify: Classifier = async request => {
    calls.push(request);
    return { status: probability === null ? "unavailable" : "ok", model: "jev-1.14.0",
      probabilities: probability === null ? {} : { drift: probability }, inputTokens: null, outputTokens: null, elapsedMs: 0 };
  };
  const ctx = { cwd, sessionManager: { getBranch: () => [{ type: "message", message }] }, modelRegistry: {
    findOfType: () => ({ type: "classifier", provider: "typesafe", id: "jev-latest" }),
    classify: async (_model: unknown, request: any) => {
      const result = await classify(request);
      return { stopReason: result.status === "ok" ? "stop" : "error", model: result.model,
        answers: Object.fromEntries(Object.entries(result.probabilities).map(([key, value]) => [key, { type: "bool", probability: value }])) };
    },
  } };
  const adapters: Adapter[] = [
    { name: "Pi source", check: piAdapter(sourceGuard, home, ctx) },
    { name: "Pi bundle", check: piAdapter(bundledGuard, home, ctx) },
    { name: "Claude", check: async command => {
      const payload = { cwd, session_id: session, transcript_path: transcript, tool_name: "Bash", tool_input: { command } };
      const verdict = evaluateClaudePayload(payload, { environmentHome: home, platformHome: home }) ?? await evaluateSemanticScope(payload, classify, home);
      return verdict?.hookSpecificOutput.permissionDecision === "deny" ? verdict.hookSpecificOutput.permissionDecisionReason : undefined;
    } },
  ];
  return { adapters, calls, clean: () => {
    expect(readFileSync(join(cwd, "source.ts"), "utf8")).toBe("KEEP_SOURCE\n");
    rmSync(home, { recursive: true, force: true });
  } };
}

async function withFixture(run: (f: ReturnType<typeof fixture>) => Promise<void>, probability: number | null = 0.99) {
  const previous = process.env.AI_JEV_SCOPE;
  process.env.AI_JEV_SCOPE = "1";
  try {
    const f = fixture(probability);
    try { await run(f); }
    finally { f.clean(); }
  } finally { if (previous === undefined) delete process.env.AI_JEV_SCOPE; else process.env.AI_JEV_SCOPE = previous; }
}

test("a configured external Git diff cannot bypass scope assessment", () => withFixture(async f => {
  for (const adapter of f.adapters) {
    f.calls.length = 0;
    expect(await adapter.check("GIT_EXTERNAL_DIFF=./restart-helper git diff"), adapter.name).toMatch(/scope|clarif/i);
    expect(f.calls, adapter.name).toHaveLength(1);
  }
}));

test.each(["git diff", "git diff --cached", "git diff --no-ext-diff --no-textconv", "git show", "git log", "git log -p",
  "env GIT_EXTERNAL_DIFF=./restart-helper git diff", "GIT_EXTERNAL_DIFF=./restart-helper command /usr/bin/git diff",
  "GIT_EXTERNAL_DIFF=./restart-helper bash -c 'git diff'"])
  ("helper-capable Git display %s receives scope assessment", command => withFixture(async f => {
    for (const adapter of f.adapters) {
      f.calls.length = 0;
      expect(await adapter.check(command), adapter.name).toMatch(/scope|clarif/i);
      expect(f.calls, adapter.name).toHaveLength(1);
    }
  }));

test.each(["git status --short", "git rev-parse --show-toplevel", "git ls-files -- src", "git ls-tree HEAD"])
  ("ordinary Git metadata inspection %s adds no classifier call", command => withFixture(async f => {
    for (const adapter of f.adapters) {
      f.calls.length = 0;
      expect(await adapter.check(command), adapter.name).toBeUndefined();
      expect(f.calls, adapter.name).toHaveLength(0);
    }
  }));

test("helper-capable Git display still requires clarification when Jev is unavailable", () => withFixture(async f => {
  for (const adapter of f.adapters) {
    for (const command of ["GIT_EXTERNAL_DIFF=./restart-helper git diff", "git show", "git log -p"]) {
      f.calls.length = 0;
      expect(await adapter.check(command), adapter.name).toMatch(/scope|clarif/i);
      expect(f.calls, adapter.name).toHaveLength(1);
    }
  }
}, null));

test("low Git display drift grants no permission and cannot override deterministic denials", () => withFixture(async f => {
  for (const adapter of f.adapters) {
    f.calls.length = 0;
    expect(await adapter.check("GIT_EXTERNAL_DIFF=./restart-helper git diff"), adapter.name).toBeUndefined();
    expect(f.calls, adapter.name).toHaveLength(1);
    f.calls.length = 0;
    expect(await adapter.check("GIT_EXTERNAL_DIFF=./restart-helper git reset --hard"), adapter.name).toMatch(/refused/i);
    expect(f.calls, adapter.name).toHaveLength(0);
  }
}, 0.01));

test.each(["file --compile -m ./rules", "file -bC -m ./rules", "file --comp -m ./rules",
  "file --mime-type source.ts -C", "command file -C -m ./rules", "/usr/bin/file -C -m ./rules", "file --unknown-option source.ts"])
  ("file compilation or unknown option %s receives scope assessment", command => withFixture(async f => {
    for (const adapter of f.adapters) {
      f.calls.length = 0;
      expect(await adapter.check(command), adapter.name).toMatch(/scope|clarif/i);
      expect(f.calls, adapter.name).toHaveLength(1);
    }
  }));

test.each(["file source.ts", "file -b source.ts", "file -bi source.ts", "file --mime-type source.ts",
  "file -hL source.ts", "file --version", "file -- --compile -C", "file - source.ts"])
  ("known file inspection %s adds no classifier call", command => withFixture(async f => {
    for (const adapter of f.adapters) {
      f.calls.length = 0;
      expect(await adapter.check(command), adapter.name).toBeUndefined();
      expect(f.calls, adapter.name).toHaveLength(0);
    }
  }));

test("file compilation still requires clarification when Jev is unavailable", () => withFixture(async f => {
  for (const adapter of f.adapters) {
    f.calls.length = 0;
    expect(await adapter.check("file -C -m ./rules"), adapter.name).toMatch(/scope|clarif/i);
    expect(f.calls, adapter.name).toHaveLength(1);
  }
}, null));

test("file compilation cannot bypass scope checks by looking like inspection", () => withFixture(async f => {
  for (const adapter of f.adapters) {
    f.calls.length = 0;
    expect(await adapter.check("file -C -m ./rules"), adapter.name).toMatch(/scope|clarif/i);
    expect(f.calls, adapter.name).toHaveLength(1);
  }
}));

test.each(["> source.ts", "exec 3>source.ts", "true >> source.ts", "true 2> source.ts", "true >& source.ts", "true &> source.ts",
  "true &>> source.ts", "true >| source.ts", "true >source.ts >/dev/null", "true 1>2",
  "git status >source.ts", "(true) >source.ts", "{ true; } >source.ts", 'true > "$(printf source.ts)"',
  'true "$(true > source.ts)"', "true <(true > source.ts)"])("file redirect %s cannot take the read-only exemption", command => withFixture(async f => {
  for (const adapter of f.adapters) {
    f.calls.length = 0;
    expect(await adapter.check(command), adapter.name).toMatch(/scope|clarif/i);
    expect(f.calls, adapter.name).toHaveLength(1);
  }
}));

test.each(["git status 2>&1", "true 1>&2", "true 2>&-", "true >/dev/null", "true < source.ts",
  "printf '%s' 'true > source.ts'", "true <<'TEXT'\ntrue > source.ts\nTEXT", 'true "$(printf \'%s\' \'>\')" source.ts'])
  ("read-only redirect or quoted example %s adds no classifier call", command => withFixture(async f => {
    for (const adapter of f.adapters) {
      f.calls.length = 0;
      expect(await adapter.check(command), adapter.name).toBeUndefined();
      expect(f.calls, adapter.name).toHaveLength(0);
    }
  }));

test("redirect-only and read-looking writes still require clarification when Jev is unavailable", () => withFixture(async f => {
  for (const adapter of f.adapters) {
    for (const command of ["> source.ts", "true > source.ts"]) {
      f.calls.length = 0;
      expect(await adapter.check(command), adapter.name).toMatch(/scope|clarif/i);
      expect(f.calls, adapter.name).toHaveLength(1);
    }
  }
}, null));

test("low drift adds no allow decision and cannot override deterministic shell-write denials", () => withFixture(async f => {
  for (const adapter of f.adapters) {
    f.calls.length = 0;
    expect(await adapter.check("true > source.ts"), adapter.name).toBeUndefined();
    expect(f.calls, adapter.name).toHaveLength(1);
    f.calls.length = 0;
    expect(await adapter.check("printf changed > source.ts"), adapter.name).toMatch(/refused/i);
    expect(f.calls, adapter.name).toHaveLength(0);
  }
}, 0.01));

test.each(["true 0<> source.ts", "FOO=1 >source.ts"])("unsupported redirect syntax %s stays denied without calling Jev", command => withFixture(async f => {
  for (const adapter of f.adapters) {
    f.calls.length = 0;
    expect(await adapter.check(command), adapter.name).toMatch(/refused|parser|parsed/i);
    expect(f.calls, adapter.name).toHaveLength(0);
  }
}));

test("a read-looking command with output redirection still receives a scope check in both harnesses", () => withFixture(async f => {
  for (const adapter of f.adapters) {
    f.calls.length = 0;
    expect(await adapter.check("true > source.ts"), adapter.name).toMatch(/scope|clarif/i);
    expect(f.calls, adapter.name).toHaveLength(1);
  }
}));
