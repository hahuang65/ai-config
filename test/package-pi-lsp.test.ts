import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installedSdkFile } from "./fixtures/installed-pi-sdk";

async function runLsp(actions: unknown[], mode = "pull") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-lsp-")));
  try {
    const extensions = join(root, "home/.pi/agent/extensions");
    mkdirSync(extensions, { recursive: true });
    mkdirSync(join(root, "project"));
    mkdirSync(join(root, "bin"));
    writeFileSync(join(root, "project/main.ts"), "const answer = 42;\n");
    writeFileSync(join(root, "actions.json"), JSON.stringify(actions));
    const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
    const entry = manifest.links.find((l: any) => l.destination === ".pi/agent/extensions/lsp.ts");
    if (entry) {
      const bundle = fileURLToPath(new URL(`../${entry.target}`, import.meta.url));
      symlinkSync(bundle, join(extensions, "lsp.ts"));
    }
    const fixture = pathToFileURL(fileURLToPath(new URL("./fixtures/lsp-server.mjs", import.meta.url))).href;
    for (const name of ["typescript-language-server", "rust-analyzer", "ty", "ruby-lsp", "gopls",
      "lua-language-server", "bash-language-server", "terraform-ls"]) {
      writeFileSync(join(root, "bin", name), `#!/usr/bin/env node\nimport ${JSON.stringify(fixture)};\n`);
      chmodSync(join(root, "bin", name), 0o755);
    }
    const run = Bun.spawnSync(["node", fileURLToPath(new URL("./fixtures/pi-lsp.mjs", import.meta.url)),
      installedSdkFile(), root, join(root, "actions.json")], { cwd: join(root, "project"), timeout: 20_000,
      env: { HOME: join(root, "home"), PATH: `${join(root, "bin")}:${process.env.PATH}`,
        PI_CODING_AGENT_DIR: join(root, "home/.pi/agent"), PI_OFFLINE: "1", LSP_TEST_LOG: join(root, "server.jsonl"), LSP_TEST_MODE: mode },
      stdout: "pipe", stderr: "pipe" });
    expect(run.exitCode, run.stderr.toString()).toBe(0);
    return JSON.parse(run.stdout.toString());
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("the shipped Pi LSP bundle matches its reviewed source", async () => {
  const build = await Bun.build({ entrypoints: [fileURLToPath(new URL("../harnesses/pi/lsp.ts", import.meta.url))],
    target: "node", format: "esm", external: ["@earendil-works/pi-coding-agent", "typebox"] });
  expect(build.success, JSON.stringify(build.logs)).toBe(true);
  expect(await build.outputs[0].text()).toBe(readFileSync(new URL("../harnesses/pi/lsp.bundle.ts", import.meta.url), "utf8"));
});

test("waiting for push diagnostics preserves the sanitized transport failure cause", async () => {
  const result = await runLsp([{ operation: "diagnostics", path: "main.ts" }], "push-malformed");
  expect(result.results[0].error).toBe("Invalid or oversized language-server response.");
}, 30_000);

test("standalone carriage returns have the same line boundaries as CRLF and LF", async () => {
  const result = await runLsp([
    { write: "main.ts", content: "one\rtwo" },
    { operation: "hover", path: "main.ts", line: 2, column: 2 },
    { operation: "hover", path: "main.ts", line: 1, column: 5 },
    { write: "main.ts", content: "one\r\ntwo\nthree\rfour" },
    { operation: "hover", path: "main.ts", line: 4, column: 1 },
  ]);
  expect(result.results[0].content?.[0].text).toContain("one");
  expect(result.results[1].error).toContain("outside the document");
  expect(result.results[2].content?.[0].text).toContain("four");
  expect(result.log.filter((m: any) => m.method === "textDocument/hover").map((m: any) => m.params.position))
    .toEqual([{ line: 1, character: 1 }, { line: 3, character: 0 }]);
}, 30_000);

test("short filesystem reads still synchronize the complete document", async () => {
  const result = await runLsp([{ operation: "hover", path: "main.ts", line: 1, column: 1 }], "short-read");
  expect(JSON.parse(result.results[0].content[0].text).contents).toBe("const answer = 42;\n");
}, 30_000);

test("escaping-heavy input gets an accurate size error without killing or desynchronizing a healthy server", async () => {
  const result = await runLsp([
    { operation: "hover", path: "main.ts", line: 1, column: 1 },
    { write: "main.ts", content: "\n".repeat(1024 * 1024) },
    { operation: "hover", path: "main.ts", line: 1, column: 1 },
    { write: "main.ts", content: "const answer = 42;\n" },
    { operation: "diagnostics", path: "main.ts" },
  ], "push");
  expect(result.results[1].error).toContain("serialized input");
  expect(result.results.at(-1).structuredContent.result.versioned).toBe(true);
  expect(result.results.at(-1).content[0].text).toContain("pushed diagnostic");
  expect(result.log.filter((m: any) => m.method === "initialize")).toHaveLength(1);
}, 30_000);

test("Pi refuses an unsupported position encoding instead of returning incorrect locations", async () => {
  const result = await runLsp([{ operation: "hover", path: "main.ts", line: 1, column: 1 }], "utf8");
  expect(result.results[0].error).toContain("UTF-16");
  expect(result.log.some((m: any) => m.method === "textDocument/hover")).toBe(false);
}, 30_000);

test("Pi rejects server-directed edits and bounds model-visible output", async () => {
  const action = { operation: "hover", path: "main.ts", line: 1, column: 1 };
  const edit = await runLsp([action], "edit");
  expect(edit.log.find((m: any) => m.id === "server-edit").result.applied).toBe(false);
  const large = await runLsp([action], "large");
  expect(large.results[0].details.truncated).toBe(true);
  expect(large.results[0].content[0].text.length).toBeLessThan(48_000);
  expect(large.results[0].content[0].text).toContain("truncated");
  expect(large.results[0].structuredContent.result).toBe(null);
  expect(JSON.stringify(large.results[0].structuredContent).length).toBeLessThan(48_000);
  expect(edit.results[0].structuredContent.result).toEqual(JSON.parse(edit.results[0].content[0].text));
}, 30_000);

test("Pi rejects protected, escaped, symlinked, oversized, and invalid-position inputs before starting a server", async () => {
  const result = await runLsp([
    { write: "credentials.ts", content: "PRIVATE_FIXTURE" },
    { symlink: "secret.ts", target: "credentials.ts" },
    { write: "../outside.ts", content: "OUTSIDE_FIXTURE" },
    { symlink: "escape.ts", target: "../outside.ts" },
    { write: "large.ts", content: "x".repeat(1024 * 1024 + 1) },
    ...["credentials.ts", "secret.ts", "../outside.ts", "escape.ts", "large.ts"].map(path =>
      ({ operation: "hover", path, line: 1, column: 1 })),
    { operation: "hover", path: "main.ts", line: 99, column: 1 },
    { operation: "rename", path: "main.ts", line: 1, column: 1 },
  ]);
  expect(result.results).toHaveLength(7);
  for (const response of result.results) expect(response.error).toBeString();
  expect(result.log).toEqual([]);
  expect(JSON.stringify(result.results)).not.toContain("PRIVATE_FIXTURE");
  expect(JSON.stringify(result.results)).not.toContain("OUTSIDE_FIXTURE");
}, 30_000);

test("Pi uses the catalogue's exact language IDs and starts every supported server on demand", async () => {
  const catalogue = JSON.parse(readFileSync(new URL("../language-servers.json", import.meta.url), "utf8"));
  const actions = Object.values(catalogue).flatMap((server: any) => {
    const extension = Object.keys(server.extensionToLanguage)[0];
    return [{ write: `source${extension}`, content: "value" },
      { operation: "hover", path: `source${extension}`, line: 1, column: 1 }];
  });
  const result = await runLsp(actions);
  expect(result.log.filter((m: any) => m.method === "initialize")).toHaveLength(8);
  expect(result.log.filter((m: any) => m.method === "textDocument/didOpen").map((m: any) => m.params.textDocument.languageId))
    .toEqual(Object.values(catalogue).map((server: any) => Object.values(server.extensionToLanguage)[0]));
  expect(result.results.every((r: any) => r.content?.[0].text.includes("value"))).toBe(true);
}, 30_000);

test("reopening an edited file rejects a delayed versioned report from its earlier opening", async () => {
  const actions: unknown[] = [{ operation: "diagnostics", path: "main.ts" }];
  for (let index = 0; index < 32; index++) actions.push({ write: `file${index}.ts`, content: "value" },
    { operation: "hover", path: `file${index}.ts`, line: 1, column: 1 });
  actions.push({ write: "main.ts", content: "changed" }, { operation: "diagnostics", path: "main.ts" });
  const result = await runLsp(actions, "push-reopen");
  expect(result.results.at(-1).content[0].text).toContain("pushed diagnostic");
  const openings = result.log.filter((m: any) => m.method === "textDocument/didOpen" && m.params.textDocument.uri.endsWith("/main.ts"));
  expect(openings).toHaveLength(2);
  expect(openings[1].params.textDocument.version).toBeGreaterThan(openings[0].params.textDocument.version);
}, 30_000);

test("Pi bounds open documents and reopens an evicted file from disk", async () => {
  const actions: unknown[] = [];
  for (let index = 0; index < 33; index++) actions.push({ write: `file${index}.ts`, content: `const value = ${index};` },
    { operation: "hover", path: `file${index}.ts`, line: 1, column: 1 });
  actions.push({ operation: "hover", path: "file0.ts", line: 1, column: 1 });
  const result = await runLsp(actions);
  expect(result.log.filter((m: any) => m.method === "textDocument/didClose")).toHaveLength(2);
  expect(result.log.filter((m: any) => m.method === "textDocument/didOpen")).toHaveLength(34);
  expect(result.results.at(-1).content[0].text).toContain("const value = 0;");
}, 30_000);

test("Pi reports unsupported server capabilities instead of treating them as empty results", async () => {
  const result = await runLsp([{ operation: "hover", path: "main.ts", line: 1, column: 1 }], "unsupported");
  expect(result.results[0].error).toContain("does not support hover");
  expect(result.log.some((m: any) => m.method === "textDocument/hover")).toBe(false);
}, 30_000);

test("Pi negotiates versioned push diagnostics without a pull-diagnostics capability", async () => {
  const result = await runLsp([{ operation: "diagnostics", path: "main.ts" }], "push");
  expect(result.results[0].content?.[0].text).toContain("pushed diagnostic");
  expect(result.results[0].structuredContent.result.versioned).toBe(true);
  expect(result.log.some((m: any) => m.method === "textDocument/diagnostic")).toBe(false);
}, 30_000);

test("Pi negotiates pull diagnostics and refreshes current disk contents after an edit", async () => {
  const result = await runLsp([
    { write: "main.ts", content: "bad\n" },
    { operation: "diagnostics", path: "main.ts" },
    { write: "main.ts", content: "const answer = 42;\n" },
    { operation: "diagnostics", path: "main.ts" },
  ]);
  expect(result.results[0].content?.[0].text).toContain("bad declaration");
  expect(JSON.parse(result.results[1].content[0].text).items).toEqual([]);
  const change = result.log.find((m: any) => m.method === "textDocument/didChange");
  expect(change.params.textDocument.version).toBe(2);
  expect(change.params.contentChanges).toEqual([{ text: "const answer = 42;\n" }]);
}, 30_000);

test("Pi routes read-only navigation queries with UTF-16 positions and reference context", async () => {
  const result = await runLsp([
    { write: "main.ts", content: "// 😀 answer\n" },
    { operation: "definition", path: "main.ts", line: 1, column: 7 },
    { operation: "references", path: "main.ts", line: 1, column: 7 },
    { operation: "symbols", path: "main.ts" },
  ]);
  expect(result.results[0].content[0].text).toContain('"character":6');
  expect(result.results[1].content[0].text).toContain('"character":6');
  expect(result.results[2].content[0].text).toContain('"name":"answer"');
  const references = result.log.find((m: any) => m.method === "textDocument/references");
  expect(references.params.position).toEqual({ line: 0, character: 6 });
  expect(references.params.context).toEqual({ includeDeclaration: true });
}, 30_000);

test("installed Pi starts a shared server only on demand, reuses it, and shuts it down", async () => {
  const result = await runLsp([
    { operation: "hover", path: "main.ts", line: 1, column: 7 },
    { operation: "hover", path: "main.ts", line: 1, column: 7 },
  ]);
  expect(result.found).toBe(true);
  expect(result.initial).toEqual([]);
  expect(result.results).toHaveLength(2);
  for (const response of result.results) expect(response.content[0].text).toContain("const answer = 42;");
  expect(result.log.filter((m: any) => m.method === "initialize")).toHaveLength(1);
  expect(result.log.filter((m: any) => m.method === "textDocument/didOpen")).toHaveLength(1);
  expect(result.log.map((m: any) => m.method).slice(-2)).toEqual(["shutdown", "exit"]);
}, 30_000);
