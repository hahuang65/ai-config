import { describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import registerAgentMemoryOwner, {
  MANAGED_AGENTMEMORY_FILES,
  repairManagedAgentMemory,
} from "../../harnesses/pi/extensions/agentmemory-owner.ts";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agentmemory-owner-"));
  const sourceDirectory = path.join(root, "source");
  const targetDirectory = path.join(root, "target");
  await Promise.all([mkdir(sourceDirectory), mkdir(targetDirectory)]);
  for (const file of MANAGED_AGENTMEMORY_FILES) {
    await writeFile(path.join(sourceDirectory, file), `managed ${file}\n`);
  }
  return { root, sourceDirectory, targetDirectory };
}

describe("managed agentmemory adapter repair", () => {
  test("replaces an upstream adapter with managed links", async () => {
    const paths = await fixture();
    try {
      await writeFile(path.join(paths.targetDirectory, "index.ts"), "upstream automatic recall\n");

      const result = repairManagedAgentMemory(paths);

      expect(result).toEqual({ repaired: MANAGED_AGENTMEMORY_FILES.length });
      expect((await lstat(path.join(paths.targetDirectory, "index.ts"))).isSymbolicLink()).toBe(true);
      expect(await readlink(path.join(paths.targetDirectory, "index.ts"))).toBe(
        path.join(await realpath(paths.sourceDirectory), "index.ts"),
      );
      expect(await readFile(path.join(paths.targetDirectory, "index.ts"), "utf8")).toBe(
        "managed index.ts\n",
      );
    } finally {
      await rm(paths.root, { recursive: true, force: true });
    }
  });

  test("does nothing when every managed link is current", async () => {
    const paths = await fixture();
    try {
      const sourceDirectory = await realpath(paths.sourceDirectory);
      for (const file of MANAGED_AGENTMEMORY_FILES) {
        await symlink(path.join(sourceDirectory, file), path.join(paths.targetDirectory, file));
      }

      expect(repairManagedAgentMemory(paths)).toEqual({ repaired: 0 });
    } finally {
      await rm(paths.root, { recursive: true, force: true });
    }
  });

  test("refuses a symbolic-link target directory", async () => {
    const paths = await fixture();
    const linkedTarget = path.join(paths.root, "linked-target");
    await symlink(paths.targetDirectory, linkedTarget);
    try {
      expect(
        repairManagedAgentMemory({
          sourceDirectory: paths.sourceDirectory,
          targetDirectory: linkedTarget,
        }),
      ).toEqual({ repaired: 0, error: "target directory must be a regular directory" });
    } finally {
      await rm(paths.root, { recursive: true, force: true });
    }
  });
});

describe("agentmemory owner extension", () => {
  test("queues one automatic reload after repairing drift", async () => {
    const commands = new Map<string, (args: string, context: any) => Promise<void>>();
    const messages: string[] = [];
    let reloads = 0;
    let sessionStart: ((event: unknown, context: any) => void) | undefined;
    const pi = {
      registerCommand(name: string, definition: { handler: (args: string, context: any) => Promise<void> }) {
        commands.set(name, definition.handler);
      },
      on(name: string, handler: (event: unknown, context: any) => void) {
        if (name === "session_start") sessionStart = handler;
      },
      sendUserMessage(message: string) {
        messages.push(message);
      },
    };
    registerAgentMemoryOwner(pi as any, {
      repair: () => ({ repaired: 1 }),
    });

    sessionStart?.({}, { ui: { notify() {} } });
    expect(messages).toEqual(["/agentmemory-managed-reload"]);

    await commands.get("agentmemory-managed-reload")?.("", {
      reload: async () => { reloads += 1; },
    });
    expect(reloads).toBe(1);
  });

  test("is installed outside the directory that agentmemory connect replaces", () => {
    const manifest = Bun.file(new URL("../../harnesses/pi/manifest.sh", import.meta.url));
    return expect(manifest.text()).resolves.toContain(
      '"$MOD/extensions/agentmemory-owner.ts"',
    );
  });
});
