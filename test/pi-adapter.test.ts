import { test, expect } from "bun:test";
import bundledGuard from "../harnesses/pi/guard-policies.bundle";
import guard, { createGuardPoliciesExtension } from "../harnesses/pi/extensions/guard-policies";

// Drive the pi adapter the way pi would: register its tool_call handler via a
// fake ExtensionAPI, then invoke the handler with a structured event. pi's
// Drive pi's extension API through a representative tool_call event.
function runToolCall(
  event: unknown,
  adapter: typeof guard = guard,
  context: unknown = { cwd: process.env.HOME },
): { block?: boolean; reason?: string } | undefined {
  let handler: ((e: unknown, ctx: unknown) => any) | undefined;
  const pi = { on: (name: string, fn: (e: unknown, ctx: unknown) => any) => { if (name === "tool_call") handler = fn; } };
  adapter(pi as any);
  return handler?.(event, context);
}

test("pi adapter uses the platform home when HOME is absent", () => {
  const platformHome = "/Users/platform-user";
  const adapter = createGuardPoliciesExtension({ environmentHome: undefined, platformHome });
  const result = runToolCall({
    toolName: "read",
    input: { path: `${platformHome}/.review-publication/review-publication-worker.mjs` },
  }, adapter);
  expect(result?.block).toBe(true);
});

test("pi adapter fails closed when HOME is invalid", () => {
  const adapter = createGuardPoliciesExtension({
    environmentHome: "relative/home",
    platformHome: "/Users/platform-user",
  });
  const result = runToolCall({ toolName: "read", input: { path: "/tmp/ordinary-file" } }, adapter);
  expect(result?.block).toBe(true);
});

test("pi adapter blocks a credential read by routing through the guard core", () => {
  const result = runToolCall({ toolName: "read", input: { path: "/home/user/.ssh/id_rsa" } });
  expect(result?.block).toBe(true);
});

test("pi source and generated adapters block publication workers and protected moves", () => {
  for (const adapter of [guard, bundledGuard]) {
    for (const command of [
      "node skills/review-change/bin/review-publication.mjs --inetd",
      "node review-publication/review-publication-worker.bundle.mjs --inetd",
      "sh -c 'review-publication --inetd'",
      "mv $HOME /tmp/home",
      "mv /tmp/replacement ~/.review-publication",
    ]) {
      expect(runToolCall({ toolName: "bash", input: { command } }, adapter)?.block).toBe(true);
    }
    expect(runToolCall({ toolName: "bash", input: { command: "mv old-name new-name" } }, adapter)).toBeUndefined();
  }
});

test("pi source and generated adapters block shell-escaped publication state and worker mode", () => {
  for (const adapter of [guard, bundledGuard]) {
    for (const command of [
      "cat $HOME/\\.review\\-publication/signing-key",
      "review\\-publication \\-\\-inetd",
      "node review\\-publication/review\\-publication\\-worker\\.bundle\\.mjs --inetd",
      "sh -c 'review\\-publication \\-\\-inetd'",
      "review-publi\\\ncation --in\\\netd",
    ]) {
      expect(runToolCall({ toolName: "bash", input: { command } }, adapter)?.block, command).toBe(true);
    }
  }
});

test("pi source and generated adapters preserve quoted and literal shell backslashes", () => {
  for (const adapter of [guard, bundledGuard]) {
    for (const command of [
      String.raw`"review\-publication" --inetd`,
      String.raw`review\\-publication --inetd`,
      String.raw`printf hello\ world`,
    ]) {
      expect(runToolCall({ toolName: "bash", input: { command } }, adapter), command).toBeUndefined();
    }
  }
});

test("pi source and generated adapters track directory changes inside nested shells", () => {
  const home = process.env.HOME!;
  const command = "env LANG=C sh -c 'cd ..; command bash -c \"cd -- .claude/review-publication-sessions; mv session.json /tmp/session\"'";
  for (const adapter of [guard, bundledGuard]) {
    expect(runToolCall(
      { toolName: "bash", input: { command } },
      adapter,
      { cwd: `${home}/project` },
    )?.block).toBe(true);
  }
});

test("pi source and generated adapters block protected inline interpreter access", () => {
  const command = `bash -c 'node -e "require(\"fs\").readFileSync(require(\"os\").homedir() + \"/.review-publication/signing-key\")"'`;
  for (const adapter of [guard, bundledGuard]) {
    expect(runToolCall({ toolName: "bash", input: { command } }, adapter)?.block).toBe(true);
  }
});

test("pi source and generated adapters preserve unrelated nested shells and tests", () => {
  for (const command of [
    "sh -c 'cd /tmp && find safe -type f'",
    "node --test test/provider.test.mjs",
    "bun test test/review-change.test.ts --test-name-pattern scope",
  ]) {
    for (const adapter of [guard, bundledGuard]) {
      expect(runToolCall({ toolName: "bash", input: { command } }, adapter)).toBeUndefined();
    }
  }
});

test("committed pi guard bundle blocks escaped generated publication worker forms", () => {
  for (const command of [
    "node review-publication/review-publication-worker.bundle.mjs --inetd",
    "node review\\-publication/review\\-publication\\-worker\\.bundle\\.mjs \\-\\-inetd",
    "sh -c 'node review\\-publication/review\\-publication\\-worker\\.bundle\\.mjs --inetd'",
  ]) {
    expect(runToolCall({ toolName: "bash", input: { command } }, bundledGuard)?.block, command).toBe(true);
  }
});

test("pi adapter allows an ordinary read", () => {
  const result = runToolCall({ toolName: "read", input: { path: "/home/user/project/main.ts" } });
  expect(result).toBeUndefined();
});

test("pi adapter blocks a write that smuggles a hardcoded secret through content", () => {
  // Key built by concatenation so this test file is not itself a secret literal.
  const key = "AKIA" + "IOSFODNN7EXAMPLE";
  const result = runToolCall({ toolName: "write", input: { file_path: "config.ts", content: `const id = '${key}';` } });
  expect(result?.block).toBe(true);
});
