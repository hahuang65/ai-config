import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { rootLinksIntoModule } from "../scripts/check-symlink-leak.mjs";

test("reports a missing scan root as an operational error", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "symlink-leak-missing-"));
  try {
    await expect(rootLinksIntoModule(path.join(temporaryRoot, "missing"), temporaryRoot)).rejects.toThrow();
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("detects links to a module root and its descendants", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "symlink-leak-"));
  try {
    const scanRoot = path.join(temporaryRoot, "scan");
    const moduleRoot = path.join(temporaryRoot, "module");
    await Promise.all([mkdir(scanRoot), mkdir(moduleRoot)]);
    await writeFile(path.join(moduleRoot, "entry.txt"), "module\n");

    const exactLink = path.join(scanRoot, "module-root");
    await symlink(moduleRoot, exactLink);
    expect(await rootLinksIntoModule(scanRoot, moduleRoot)).toBe(true);

    await rm(exactLink);
    await symlink(path.join(moduleRoot, "entry.txt"), path.join(scanRoot, "module-entry"));
    expect(await rootLinksIntoModule(scanRoot, moduleRoot)).toBe(true);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
