import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const plugin = fileURLToPath(new URL("../harnesses/claude/plugins/ai-local-lsp/", import.meta.url));

test("the shared catalogue has unique file mappings and both generated projections are current", () => {
  const catalogue = JSON.parse(readFileSync(new URL("../language-servers.json", import.meta.url), "utf8"));
  const extensions = Object.values(catalogue).flatMap((server: any) => {
    expect(server.command).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(server.args.every((arg: unknown) => typeof arg === "string")).toBe(true);
    return Object.keys(server.extensionToLanguage);
  });
  expect(new Set(extensions).size).toBe(extensions.length);
  const check = Bun.spawnSync(["bun", fileURLToPath(new URL("../tools/build-language-servers.mjs", import.meta.url)), "--check"]);
  expect(check.exitCode, check.stderr.toString()).toBe(0);
});

test("Claude provides all eight shared language servers, including TypeScript and Rust", () => {
  const { lspServers } = JSON.parse(readFileSync(`${plugin}/.claude-plugin/plugin.json`, "utf8"));
  expect(Object.keys(lspServers).sort()).toEqual(
    ["ty", "ruby", "lua", "go", "shell", "terraform", "typescript", "rust"].sort());
  expect(lspServers.typescript).toEqual({ command: "typescript-language-server", args: ["--stdio"],
    extensionToLanguage: { ".ts": "typescript", ".tsx": "typescriptreact", ".mts": "typescript", ".cts": "typescript",
      ".js": "javascript", ".jsx": "javascriptreact", ".mjs": "javascript", ".cjs": "javascript" } });
  expect(lspServers.rust).toEqual({ command: "rust-analyzer", args: [], extensionToLanguage: { ".rs": "rust" } });
});

test("shared catalogue projections agree and Claude cannot start duplicate upstream servers", () => {
  const catalogue = JSON.parse(readFileSync(new URL("../language-servers.json", import.meta.url), "utf8"));
  const metadata = JSON.parse(readFileSync(`${plugin}/.claude-plugin/plugin.json`, "utf8"));
  expect(metadata.lspServers).toEqual(catalogue);
  expect(JSON.parse(readFileSync(new URL("../tools/install/lsp-plugin.json", import.meta.url), "utf8"))).toEqual(metadata);
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  for (const name of ["lua-lsp@claude-plugins-official", "gopls-lsp@claude-plugins-official",
    "bash-language-server@claude-code-lsps", "terraform-ls@claude-code-lsps"]) {
    expect(manifest.settings.find((s: any) => s.path.join("/") === `enabledPlugins/${name}`).value).toBe(false);
  }
});

test("mise declares every shared server and the TypeScript SDK dependency with fixed versions", () => {
  const { tools } = Bun.TOML.parse(readFileSync(new URL("../mise.toml", import.meta.url), "utf8")) as any;
  for (const name of ["ty", "gem:ruby-lsp", "lua-language-server", "go:golang.org/x/tools/gopls",
    "npm:bash-language-server", "terraform-ls", "npm:typescript-language-server", "rust-analyzer"]) {
    expect(typeof tools[name] === "string" ? tools[name] : tools[name]?.version, name).toMatch(/^\d+[.\d-]+$/);
  }
  // TS 7 no longer ships tsserver; the LSP requires a co-located TS 6 SDK.
  expect(tools["npm:typescript-language-server"].postinstall).toContain("typescript@6.0.3");
  expect(tools["npm:typescript-language-server"].postinstall).toContain('$MISE_TOOL_INSTALL_PATH');
});

test("the local Claude LSP plugin uses mise-managed Ty and Ruby executables without bundled skills", () => {
  const metadata = JSON.parse(readFileSync(`${plugin}/.claude-plugin/plugin.json`, "utf8"));
  expect(readdirSync(plugin)).toEqual([".claude-plugin"]);
  expect(metadata.lspServers.ty).toEqual({
    command: "ty", args: ["server"], extensionToLanguage: { ".py": "python", ".pyi": "python" },
  });
  expect(metadata.lspServers.ruby).toEqual({
    command: "ruby-lsp", args: [], extensionToLanguage: {
      ".rb": "ruby", ".erb": "erb", ".rake": "ruby", ".gemspec": "ruby", ".ru": "ruby",
    },
  });
  expect(metadata.skills).toBeUndefined();
  expect(metadata.commands).toBeUndefined();
});
