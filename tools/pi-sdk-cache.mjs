// Keep disposable SDK build files inside this checkout; npm owns their dependency tree.
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const sdkName = "@earendil-works/pi-coding-agent";
const projectRoot = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const cacheRoot = join(projectRoot, "target/pi-sdk");

function inside(directory, path) {
  const name = relative(directory, path);
  return name !== ".." && !name.startsWith(`..${sep}`) && !isAbsolute(name);
}

function checkMetadata(directory, file, optional = false) {
  let info;
  try { info = lstatSync(file); }
  catch (error) { if (optional && error.code === "ENOENT") return; throw error; }
  if (!info.isFile() || info.nlink !== 1 || !inside(directory, realpathSync(file))) {
    throw Error(`Refusing unsafe SDK cache metadata: ${relative(directory, file)}`);
  }
}

export function checkSdkCache(directory, create = false) {
  if (dirname(resolve(directory)) !== cacheRoot) throw Error("SDK cache is outside this checkout");
  for (const path of [join(projectRoot, "target"), cacheRoot, resolve(directory)]) {
    let info;
    try { info = lstatSync(path); }
    catch (error) {
      if (!create || error.code !== "ENOENT") throw error;
      mkdirSync(path);
      info = lstatSync(path);
    }
    if (!info.isDirectory() || realpathSync(path) !== path) {
      throw Error(`Refusing unsafe SDK cache directory: ${relative(projectRoot, path)}`);
    }
  }
  const modules = join(directory, "node_modules");
  let info;
  try { info = lstatSync(modules); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (info && (!info.isDirectory() || realpathSync(modules) !== modules)) throw Error("Refusing unsafe SDK node_modules");
  for (const file of ["package.json", "package-lock.json", ".ready"]) checkMetadata(directory, join(directory, file), true);
}

export function sdkCacheDirectory(sdkRoot) {
  const directory = dirname(dirname(dirname(resolve(sdkRoot))));
  return dirname(directory) === cacheRoot && join(directory, "node_modules", sdkName) === resolve(sdkRoot)
    ? directory : undefined;
}

export function validateSdkCache(directory, version) {
  const root = join(directory, "node_modules", sdkName), file = join(root, "package.json");
  checkMetadata(directory, file);
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(descriptor);
    if (info.size > 65536) throw Error("Invalid SDK package metadata");
    const metadata = JSON.parse(readFileSync(descriptor, "utf8"));
    if (metadata.name !== sdkName || metadata.version !== version) throw Error("SDK does not match the selected Pi release");
  } finally { closeSync(descriptor); }
  const entry = join(root, "dist/index.js");
  if (!existsSync(entry) || !statSync(entry).isFile() || !inside(directory, realpathSync(entry))) throw Error("Missing SDK entry");
  return realpathSync(root);
}
