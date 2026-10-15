import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

test("tool inventory accounts for every installed CLI alias and its executable", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const inventory = read("docs/tool-inventory.md");
  const links = manifest.links.filter((link: { destination: string }) => link.destination.startsWith(".local/bin/"));
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) {
    const row = inventory.split("\n").find(line => line.startsWith("|") && line.includes(`\`~/${link.destination}\``));
    expect(row, `Missing CLI catalogue row: ${link.destination}`).toBeDefined();
    expect(row).toContain(`\`${link.target}\``);
  }
});

// Include Cargo's implicit main.rs and src/bin targets, not just [[bin]].
test("tool inventory accounts for every production Rust executable source", () => {
  const inventory = read("docs/tool-inventory.md");
  for (const directory of readdirSync(new URL("tools/", root))) {
    const prefix = `tools/${directory}/`;
    if (!existsSync(new URL(`${prefix}Cargo.toml`, root))) continue;
    const cargo = Bun.TOML.parse(read(`${prefix}Cargo.toml`)) as { bin?: { path: string }[] };
    const sources = (cargo.bin ?? []).map(target => target.path);
    if (existsSync(new URL(`${prefix}src/main.rs`, root))) sources.push("src/main.rs");
    const binDirectory = new URL(`${prefix}src/bin/`, root);
    if (existsSync(binDirectory)) {
      for (const file of readdirSync(binDirectory)) {
        sources.push(file.endsWith(".rs") ? `src/bin/${file}` : `src/bin/${file}/main.rs`);
      }
    }
    for (const source of sources) expect(inventory).toContain(`../${prefix}${source}`);
  }
});

test("harness inventory accounts for literal Pi tool registrations and bare Claude denials", () => {
  const inventory = read("docs/harness-tool-inventory.md");
  for (const file of readdirSync(new URL("harnesses/pi/", root))) {
    if (!file.endsWith(".ts") || file.endsWith(".bundle.ts")) continue;
    const source = read(`harnesses/pi/${file}`);
    for (const match of source.matchAll(/registerTool\(\{\s*name:\s*"([^"]+)"/g)) {
      expect(inventory).toContain(`\`${match[1]}\``);
      expect(inventory).toContain(`../harnesses/pi/${file}`);
    }
  }
  const manifest = JSON.parse(read("manifest.json"));
  for (const setting of manifest.settings) {
    if (setting.destination === ".claude/settings.json" &&
        setting.path.join(".") === "permissions.deny" && /^[A-Za-z]+$/.test(setting.value)) {
      expect(inventory).toContain(`\`${setting.value}\``);
    }
  }
});
