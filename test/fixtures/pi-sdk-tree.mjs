import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function restoreSdkTree(directory) {
  const file = join(directory, "package-lock.json"), retained = readFileSync(file, "utf8");
  const lock = JSON.parse(retained);
  rmSync(join(directory, "node_modules"), { recursive: true, force: true });
  writeSdkTree(directory, lock.packages[""].dependencies["@earendil-works/pi-coding-agent"], false);
  writeFileSync(file, retained);
}

export function writeSdkTree(directory, version = "1.4.0", ready = true) {
  const name = "@earendil-works/pi-coding-agent";
  const peers = ["@earendil-works/pi-agent-core", "@earendil-works/pi-ai", "@earendil-works/pi-tui", "typebox"];
  const packages = { "": { dependencies: { [name]: version } } };
  for (const dependency of [name, ...peers]) {
    const root = join(directory, "node_modules", dependency);
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: dependency, version,
      type: "module", main: "dist/index.js", exports: { ".": "./dist/index.js" },
      ...(dependency === name ? { dependencies: Object.fromEntries(peers.map(peer => [peer, version])) } : {}) }));
    writeFileSync(join(root, "dist/index.js"), "throw Error('discovery must not load fixture packages');\n");
    if (dependency === "@earendil-works/pi-tui") {
      writeFileSync(join(root, "dist/utils.js"), "throw Error('discovery must not load terminal helpers');\n");
    }
    packages[`node_modules/${dependency}`] = { version,
      ...(dependency === name ? { dependencies: Object.fromEntries(peers.map(peer => [peer, version])) } : {}) };
  }
  writeFileSync(join(directory, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages }));
  if (ready) writeFileSync(join(directory, ".ready"), version);
  return join(directory, "node_modules", name);
}
