import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fixture as createFixture, execute, binary, changeBinary, modelServer, configureModel, put, repository, calls, answer } from "./fixtures/reviewer.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() { return createFixture((root: string) => roots.push(root)); }

function review(f: ReturnType<typeof fixture>) {
  return execute(binary, ["--root", f.evaluation, "reviewer", "--snapshot", f.snapshot,
    "--prompt", "Inspect allowed.txt without changing it.", "--provider", "reviewer-fixture", "--model", "fixture-model", "--thinking", "off", "--timeout", "20"],
    { cwd: f.root, env: f.env, timeout: 25000, maxBuffer: 1024 * 1024 });
}

test("the Rust reviewer and installed Pi permit snapshot reads but reject writes, shell calls, resource loading and escaped reads", async () => {
  const f = fixture();
  const { requests, server } = modelServer(f.root);
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    configureModel(f.profile, address.port);
    const { stdout } = await review(f);
    const result = JSON.parse(stdout);
    expect(result.response).toBe("Runtime fixture finished.");
    expect(result.filesRead).toEqual(["allowed.txt"]);
    expect(requests).toHaveLength(2);
    expect(requests[0].tools.map((tool: any) => tool.function.name)).toEqual(["read"]);
    const seen = JSON.stringify(requests);
    expect(seen).not.toContain("OBSOLETE_ROLE_MUST_NOT_LOAD");
    expect(seen).toContain("Review the supplied frozen change against its stated intent.");
    expect(seen).toContain("SAFE_REVIEW_SOURCE");
    for (const sentinel of ["OUTSIDE_PRIVATE_SENTINEL", "INSIDE_PRIVATE_SENTINEL", "GUARD_PRIVATE_SENTINEL", "AUTH_BACKUP_PRIVATE_SENTINEL", "GIT_METADATA_SENTINEL", "UNTRUSTED_STARTUP_INSTRUCTION"]) expect(seen).not.toContain(sentinel);
    expect(readFileSync(join(f.snapshot, "allowed.txt"), "utf8")).toBe("SAFE_REVIEW_SOURCE\n");
    expect(existsSync(f.marker)).toBe(false);
    expect(existsSync(join(f.root, "untrusted-sessions"))).toBe(false);
    expect(existsSync(join(f.profile, "reviewer-sessions"))).toBe(false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 30000);

for (const [file, relative] of [
  ["review-scope.ts", "harnesses/pi/review-scope.ts"],
  ["guard-policies.bundle.ts", "harnesses/pi/guard-policies.bundle.ts"],
]) {
  test(`failure to initialize ${file} leaves the real Pi reviewer unable to read or mutate`, async () => {
    const f = fixture();
    put(join(f.evaluation, relative), 'export default function () { throw new Error("fixture load failure"); }');
    const { requests, server } = modelServer(f.root);
    try {
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      configureModel(f.profile, (server.address() as { port: number }).port);
      const outcome = await review(f).then(() => null, error => ({ code: error.code, stdout: error.stdout }));
      expect(outcome).toEqual({ code: 1, stdout: "" });
      const seen = JSON.stringify(requests);
      for (const sentinel of ["SAFE_REVIEW_SOURCE", "OUTSIDE_PRIVATE_SENTINEL", "INSIDE_PRIVATE_SENTINEL", "GUARD_PRIVATE_SENTINEL"]) expect(seen).not.toContain(sentinel);
      expect(readFileSync(join(f.snapshot, "allowed.txt"), "utf8")).toBe("SAFE_REVIEW_SOURCE\n");
      expect(existsSync(f.marker)).toBe(false);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 30000);
}

for (const agent of ["api-designer", "frontend-architect", "database-reviewer", "fact-checker", "change-reviewer"]) {
  test(`real Pi consults ${agent} using only frozen reads and its canonical role`, async () => {
    const f = fixture();
    const repo = await repository(f);
    put(join(repo, ".env"), "CONSULT_PRIVATE_SENTINEL");
    const requested = calls([
      ["read", { path: "scope.json" }], ["read", { path: "after/source.txt" }],
      ["read", { path: join(repo, "source.txt") }], ["read", { path: "after/.env" }],
      ["write", { path: "after/source.txt", content: "MUTATED" }], ["bash", { command: "exit 97" }],
    ]);
    const { requests, server } = modelServer(f.root, { calls: requested, answer: "Advice without execution." });
    try {
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      configureModel(f.profile, (server.address() as { port: number }).port);
      const { stdout } = await execute(binary, ["--root", f.evaluation, "consult", "--agent", agent, "--repo", repo,
        "--prompt", "Inspect the design", "--provider", "reviewer-fixture", "--model", "fixture-model", "--thinking", "off", "--timeout", "20"],
        { cwd: f.root, env: f.env, timeout: 25000, maxBuffer: 1024 * 1024 });
      const result = JSON.parse(stdout);
      expect(result.agent).toBe(agent);
      expect(result.response).toBe("Advice without execution.");
      expect(result.filesRead).toEqual(["after/source.txt", "scope.json"]);
      expect(requests[0].tools.map((tool: any) => tool.function.name)).toEqual(["read"]);
      expect(JSON.stringify(requests)).toContain(`name: ${agent}`);
      expect(JSON.stringify(requests)).not.toContain("OBSOLETE_ROLE_MUST_NOT_LOAD");
      expect(JSON.stringify(requests)).not.toContain("CONSULT_PRIVATE_SENTINEL");
      expect(readFileSync(join(repo, "source.txt"), "utf8")).toBe("after\n");
      expect(readFileSync(join(result.snapshot, "after/source.txt"), "utf8")).toBe("after\n");
      expect(existsSync(f.marker)).toBe(false);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 30000);
}

test("the standalone review CLI produces a signed HTML report through real Pi with a local synthetic provider", async () => {
  const f = fixture();
  const repo = await repository(f);
  const { server, requests } = modelServer(f.root, { answer, calls: calls(["scope.json", "patch.diff", "after/source.txt"].map(path => ["read", { path }])) });
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    configureModel(f.profile, (server.address() as { port: number }).port);
    const { stdout } = await execute(changeBinary, ["--root", f.evaluation, "review", "range", "HEAD~1..HEAD", "--repo", repo,
      "--intent", "Replace before with after", "--provider", "reviewer-fixture", "--model", "fixture-model", "--thinking", "off", "--json"],
      { cwd: f.root, env: f.env, timeout: 25000, maxBuffer: 1024 * 1024 });
    const receipt = JSON.parse(stdout);
    const record = JSON.parse(readFileSync(receipt.record, "utf8"));
    expect(receipt.publication).toBe("local-only");
    expect(record.files_read).toEqual(["after/source.txt", "patch.diff", "scope.json"]);
    expect(record.findings[0].inline).toBe(true);
    expect(readFileSync(receipt.report, "utf8")).toContain("&lt;img");
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests)).not.toContain("OBSOLETE_ROLE_MUST_NOT_LOAD");
    expect(existsSync(f.marker)).toBe(false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 30000);
