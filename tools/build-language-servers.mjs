// Generate both reviewed Claude projections from the harness-neutral catalogue.
import { readFileSync, writeFileSync } from "node:fs";
const root = new URL("../", import.meta.url);
const lspServers = JSON.parse(readFileSync(new URL("language-servers.json", root), "utf8"));
const plugin = JSON.stringify({
  name: "ai-local-lsp",
  description: "Shared language servers only; no skills, prompts, or automatic installation",
  author: { name: "ai-config" }, version: "2.0.0", lspServers,
}, null, 2) + "\n";
for (const target of ["harnesses/claude/plugins/ai-local-lsp/.claude-plugin/plugin.json", "tools/install/lsp-plugin.json"]) {
  const url = new URL(target, root);
  if (process.argv.includes("--check")) {
    if (readFileSync(url, "utf8") !== plugin) throw new Error(`Stale language-server projection: ${target}`);
  } else writeFileSync(url, plugin);
}
