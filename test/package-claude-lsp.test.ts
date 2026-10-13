import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const plugin = fileURLToPath(new URL("../harnesses/claude/plugins/ai-local-lsp/", import.meta.url));

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
