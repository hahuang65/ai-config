// Bundle Pi's own terminal-column utilities into the symlink-safe native footer.
import { realpathSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(project, "harnesses/pi/status-footer.ts");
const destination = resolve(project, "harnesses/pi/status-footer.bundle.ts");

function installedPiTui() {
  const pi = Bun.which("pi");
  if (!pi) throw new Error("A managed Pi executable is required to bundle the footer");
  let cli = realpathSync(pi);
  for (let hop = 0; hop < 4; hop++) {
    try { return createRequire(cli).resolve("@earendil-works/pi-tui"); }
    catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; }
    if (statSync(cli).size > 4096) break;
    const wrapper = readFileSync(cli, "utf8").match(/\bexec\s+"([^"\n]+)"\s+"\$@"/);
    if (!wrapper) break;
    cli = realpathSync(wrapper[1]);
  }
  throw new Error("Installed Pi does not provide its terminal-width helpers");
}

export async function buildStatusFooter() {
  const tuiPackage = installedPiTui();
  const tui = join(dirname(tuiPackage), "utils.js");
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
  return text.replace(/^\/\/ (?:\.\.\/|native\/pi\/)[^\n]+$/gm, "// bundled source");
}

if (import.meta.main) {
  await Bun.write(destination, await buildStatusFooter());
  console.log("Built the self-contained Pi footer for Node");
}
