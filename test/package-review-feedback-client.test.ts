import { expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openReceipt } from "../harnesses/review-feedback-client";
import { fixture, execute, changeBinary, modelServer, configureModel, repository, calls, answer } from "./fixtures/reviewer.mjs";

const cli = resolve("tools/artifact-review/target/release/review-artifact");
const receipt = { version: 1, artifact: "/tmp/synthetic-report.html", ticket: "a".repeat(32) };
const line = (value: unknown) => JSON.stringify({ review_feedback: value });

test("receipt scanning keeps ticket, artifact and protocol validation", () => {
  for (const invalid of [null, { ...receipt, version: 2 }, { ...receipt, artifact: "relative" },
    { ...receipt, artifact: "/" + "a".repeat(8192) }, { ...receipt, ticket: "g".repeat(32) },
    { ...receipt, ticket: "a".repeat(31) }]) {
    expect(openReceipt(`START Review\n${line(invalid)}\nDONE Open browser\n{"elapsed":1}\n`)).toBeUndefined();
  }
  expect(openReceipt(`START Review\n${line(receipt)}\nnull\n${line({ ...receipt, ticket: "bad" })}\nTOTAL Review complete\n`)).toEqual(receipt);
});

test("receipt scanning retains its UTF-8 byte bound", () => {
  expect(openReceipt(`${line(receipt)}\n${"é".repeat(256 * 1024)}`)).toBeUndefined();
});

function opener(root: string, evaluation: string) {
  const directory = join(evaluation, "tools/artifact-review/target/release");
  mkdirSync(directory, { recursive: true });
  symlinkSync(cli, join(directory, "review-artifact"));
  const bin = join(root, "browser-bin");
  mkdirSync(bin);
  writeFileSync(join(bin, process.platform === "darwin" ? "open" : "xdg-open"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return bin;
}

test("an agent-launched human CLI receipt attaches with final progress diagnostics after it", async () => {
  const f = fixture();
  const repo = await repository(f);
  const bin = opener(f.root, f.evaluation);
  const env = { ...f.env, PATH: `${bin}:${f.env.PATH}`, AI_REVIEW_AGENT_LAUNCHED: "pi", AR_ROOT: join(f.root, "reviews") };
  const { server } = modelServer(f.root, { answer, calls: calls(["scope.json", "patch.diff"].map(path => ["read", { path }])) });
  let report: string | undefined;
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    configureModel(f.profile, (server.address() as { port: number }).port);
    const { stdout, stderr } = await execute(changeBinary, ["--root", f.evaluation, "HEAD~1..HEAD", "--repo", repo,
      "--provider", "reviewer-fixture", "--model", "fixture-model", "--thinking", "off"], { cwd: repo, env, timeout: 25000, maxBuffer: 512 * 1024 });
    report = /HTML report: (.+)/.exec(stdout)?.[1];
    expect(report).toBeString();
    expect(stderr).toContain("TOTAL");
    const found = openReceipt(stdout + stderr);
    expect(found?.artifact).toBe(report);
    const attached = await execute(cli, ["attach", report!, "--harness", "pi", "--conversation", join(f.root, "session.jsonl"),
      "--workspace", repo, "--ticket", found!.ticket], { cwd: repo, env, timeout: 10000 });
    expect(JSON.parse(attached.stdout)).toEqual({ attached: true });
  } finally {
    if (report) await execute(cli, ["stop", report], { env, timeout: 10000 }).catch(() => {});
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(f.root, { recursive: true, force: true });
  }
}, 35000);
