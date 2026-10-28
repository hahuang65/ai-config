// Preserve the pinned engine's layout and reuse the already installed Pi host.
import { cpSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { projectPiHost, projectPiPackage, projectPiPeer } from "./project-pi.mjs";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = join(project, "target/pi-subagents");
const host = projectPiHost();
const sdkRoot = projectPiPackage(host.executable);
const metadata = path => JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
const engine = realpathSync(join(project, "node_modules/pi-subagents"));
if (metadata(engine).version !== "0.83.0") throw Error("Restore the locked pi-subagents 0.83.0 build dependency");

function copyPackage(name, destination) {
  const source = realpathSync(join(project, "node_modules", name));
  if (metadata(source).name !== name) throw Error(`Unexpected build dependency: ${name}`);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true, filter: path => basename(path) !== "node_modules" });
}

const peers = {};
for (const name of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai", "@earendil-works/pi-tui", "typebox"]) {
  const isSdk = name.endsWith("/pi-coding-agent");
  const path = isSdk ? sdkRoot : projectPiPeer(sdkRoot, name);
  if (isSdk && metadata(path).name !== name) throw Error(`The installed Pi host is missing its ${name} peer`);
  peers[name] = path;
}
copyPackage("pi-subagents", join(runtime, "package"));
for (const name of ["@js-temporal/polyfill", "acorn", "jiti", "undici", "yaml", "jsbi"]) {
  copyPackage(name, join(runtime, "node_modules", name));
}
function linkPeer(name, path) {
  const destination = join(runtime, "node_modules", name);
  mkdirSync(dirname(destination), { recursive: true });
  try {
    if (!lstatSync(destination).isSymbolicLink()) throw Error(`Refusing to replace an unexpected runtime peer: ${name}`);
    unlinkSync(destination);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  symlinkSync(path, destination, "dir");
}
for (const [name, path] of Object.entries(peers)) linkPeer(name, path);
writeFileSync(join(runtime, "host.json"), JSON.stringify({ engineVersion: "0.83.0", sdkRoot,
  sdkVersion: metadata(sdkRoot).version, packageRoot: host.packageRoot,
  executable: host.executable, standalone: host.standalone, peers }, null, 2) + "\n");
console.log("Built pinned specialist runtime using the installed Pi host; no client provisioning");
