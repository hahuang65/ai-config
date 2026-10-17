// Package only the pinned WASM runtime and Bash grammar, never native addons.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = resolve(root, "guard/vendor");
mkdirSync(vendor, { recursive: true });
const runtime = resolve(root, "node_modules/web-tree-sitter");
const grammar = resolve(root, "node_modules/tree-sitter-bash");
const result = spawnSync("bun", ["build", resolve(runtime, "web-tree-sitter.js"),
  "--target", "node", "--format", "esm", "--outfile", resolve(vendor, "tree-sitter.mjs")],
{ cwd: root, stdio: "inherit", timeout: 30_000 });
if (result.error || result.status !== 0) throw new Error("Cannot bundle the pinned Tree-sitter runtime.");
for (const [source, destination] of [
  [resolve(runtime, "web-tree-sitter.wasm"), "web-tree-sitter.wasm"],
  [resolve(runtime, "LICENSE"), "web-tree-sitter.LICENSE"],
  [resolve(grammar, "tree-sitter-bash.wasm"), "tree-sitter-bash.wasm"],
  [resolve(grammar, "LICENSE"), "tree-sitter-bash.LICENSE"],
]) copyFileSync(source, resolve(vendor, destination));
