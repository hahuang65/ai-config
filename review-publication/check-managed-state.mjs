#!/usr/bin/env node

import { lstat as readState } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function validateManagedPublicationState({
  home,
  lstat = readState,
  userId = typeof process.getuid === "function" ? process.getuid() : null,
} = {}) {
  const directory = path.join(home, ".review-publication");
  let state;
  try {
    state = await lstat(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (state.isSymbolicLink()) {
    throw new Error("Review publication managed state must not be a symbolic link. Restore a private user-owned directory, then try again.");
  }
  if (!state.isDirectory() || userId !== null && state.uid !== userId) {
    throw new Error("Review publication managed state has unsafe ownership. Restore ownership to the current user, then try again.");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await validateManagedPublicationState({ home: process.argv[2] }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
