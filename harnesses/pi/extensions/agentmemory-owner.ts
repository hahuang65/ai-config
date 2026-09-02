import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  lstatSync,
  readlinkSync,
  realpathSync,
  renameSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MANAGED_AGENTMEMORY_FILES = [
  "client.ts",
  "commands.ts",
  "config.ts",
  "events.ts",
  "footer.ts",
  "index.ts",
  "runtime.ts",
  "support.ts",
  "tools.ts",
  "types.ts",
] as const;

type RepairPaths = {
  sourceDirectory: string;
  targetDirectory: string;
};

type RepairResult = {
  repaired: number;
  error?: string;
};

type OwnerDependencies = {
  repair?: () => RepairResult;
};

function defaultRepairPaths(): RepairPaths {
  const extensionSource = realpathSync(fileURLToPath(import.meta.url));
  return {
    sourceDirectory: path.join(path.dirname(extensionSource), "agentmemory"),
    targetDirectory: path.join(homedir(), ".pi", "agent", "extensions", "agentmemory"),
  };
}

function isCurrentLink(source: string, target: string): boolean {
  const targetState = lstatSync(target, { throwIfNoEntry: false });
  return Boolean(
    targetState?.isSymbolicLink()
      && path.resolve(path.dirname(target), readlinkSync(target)) === source,
  );
}

function replaceWithLink(source: string, target: string): void {
  const targetState = lstatSync(target, { throwIfNoEntry: false });
  if (targetState?.isDirectory()) throw new Error(`${target} must not be a directory`);
  const temporaryLink = `${target}.managed-${process.pid}-${Date.now()}`;
  symlinkSync(source, temporaryLink);
  try {
    renameSync(temporaryLink, target);
  } catch (error) {
    try {
      unlinkSync(temporaryLink);
    } catch {
      // Keep the original repair error.
    }
    throw error;
  }
}

export function repairManagedAgentMemory(paths: RepairPaths): RepairResult {
  const targetState = lstatSync(paths.targetDirectory, { throwIfNoEntry: false });
  if (!targetState?.isDirectory() || targetState.isSymbolicLink()) {
    return { repaired: 0, error: "target directory must be a regular directory" };
  }
  let repaired = 0;
  try {
    for (const file of MANAGED_AGENTMEMORY_FILES) {
      const source = realpathSync(path.join(paths.sourceDirectory, file));
      const target = path.join(paths.targetDirectory, file);
      if (isCurrentLink(source, target)) continue;
      replaceWithLink(source, target);
      repaired += 1;
    }
    return { repaired };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { repaired, error: message };
  }
}

export default function registerAgentMemoryOwner(
  pi: ExtensionAPI,
  dependencies: OwnerDependencies = {},
): void {
  const repair = dependencies.repair ?? (() => repairManagedAgentMemory(defaultRepairPaths()));
  const repairResult = repair();

  pi.registerCommand("agentmemory-managed-reload", {
    description: "Reload pi after restoring the managed agentmemory adapter",
    handler: async (_args, context) => {
      await context.reload();
      return;
    },
  });

  pi.on("session_start", (_event, context) => {
    if (repairResult.error) {
      context.ui.notify(`Could not restore managed agentmemory: ${repairResult.error}`, "warning");
      return;
    }
    if (repairResult.repaired === 0) return;
    context.ui.notify("Restored the managed agentmemory adapter; reloading pi once.", "info");
    pi.sendUserMessage("/agentmemory-managed-reload", { expandPromptTemplates: true });
  });
}
