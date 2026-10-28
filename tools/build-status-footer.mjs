// Bundle Pi's own terminal-column utilities into the symlink-safe native footer.
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectPiPackage, projectPiPeer } from "./project-pi.mjs";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(project, "harnesses/pi/status-footer.ts");
const destination = resolve(project, "harnesses/pi/status-footer.bundle.ts");

export async function buildStatusFooter() {
  const tui = join(projectPiPeer(projectPiPackage(), "@earendil-works/pi-tui"), "dist/utils.js");
  const eastAsianWidth = createRequire(tui).resolve("get-east-asian-width");
  const built = await Bun.build({
    entrypoints: [source], target: "node", format: "esm",
    plugins: [{ name: "installed-pi-tui", setup(build) {
      build.onResolve({ filter: /^@earendil-works\/pi-tui$/ }, () => ({ path: tui }));
      build.onResolve({ filter: /^get-east-asian-width$/ }, () => ({ path: eastAsianWidth }));
    } }],
  });
  if (!built.success || built.outputs.length !== 1) throw new Error("Could not bundle Pi footer");
  const text = await built.outputs[0].text();
  return text.replace(/^\/\/ (?:\.\.\/|native\/pi\/|target\/pi-sdk\/)[^\n]+$/gm, "// bundled source");
}

if (import.meta.main) {
  await Bun.write(destination, await buildStatusFooter());
  console.log("Built the self-contained Pi footer for Node");
}
