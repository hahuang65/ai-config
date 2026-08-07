#!/usr/bin/env node
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";

export async function rootLinksIntoModule(root, moduleDirectory) {
  const [scanRoot, moduleRoot] = await Promise.all([realpath(root), realpath(moduleDirectory)]);
  return directoryLinksInto(scanRoot, moduleRoot, `${moduleRoot}${path.sep}`);
}

async function directoryLinksInto(directory, moduleRoot, modulePrefix) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink() && await linkTargetsModule(entryPath, moduleRoot, modulePrefix)) return true;
    if (entry.isDirectory() && await directoryLinksInto(entryPath, moduleRoot, modulePrefix)) return true;
  }
  return false;
}

async function linkTargetsModule(link, moduleRoot, modulePrefix) {
  try {
    if (!(await lstat(link)).isSymbolicLink()) return false;
    const target = await realpath(link);
    return target === moduleRoot || target.startsWith(modulePrefix);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function main() {
  if (process.argv.length !== 4) throw new Error("Usage: check-symlink-leak <root> <module-directory>");
  const leaks = await rootLinksIntoModule(process.argv[2], process.argv[3]);
  process.exitCode = leaks ? 0 : 1;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
