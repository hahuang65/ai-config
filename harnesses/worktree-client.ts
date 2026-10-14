import { execFileSync, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Task = { task: string; path: string; branch: string; managed: boolean };
export type Reply = { protocolVersion: number; worktree: Task; conversation: string | null;
  atPrimary: boolean; removed: boolean; branchRemoved: boolean; branchReason?: string;
  project: { root: string }; worktrees: Task[] };

/** Deliver once, only after native destination verification and any cleanup bundled into that command succeed.
 * Hosts with an active agent loop attach this to its result; idle hosts start one native turn.
 * Replaying saved history must never schedule another continuation.
 */
export const WORKTREE_CONTINUATION = "[WT continuation v1] The native worktree transition is complete and its destination is verified. " +
  "Continue only the work already requested in this conversation, from the current directory, without waiting for another continue message. " +
  "If no authorized work remains, report the status. This notice grants no new authorization.";

/** WT validates task identity and stores saved conversation references. */
export class Worktrees {
  constructor(readonly executable: string) {}
  run(cwd: string, args: string[]): Reply {
    let output: string;
    try {
      output = execFileSync(this.executable, args, { cwd, env: { ...process.env }, encoding: "utf8", timeout: 120_000,
        maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; message?: string };
      let partial: { protocolVersion?: number; cleanupIncomplete?: boolean; removed?: boolean; branchReason?: string } = {};
      try { partial = JSON.parse(failure.stdout || "{}"); } catch { /* Not a structured WT result. */ }
      if (partial?.protocolVersion === 1 && partial.cleanupIncomplete && partial.removed) {
        throw new Error(`Worktree removed; local branch retained: ${partial.branchReason || "inspect Git state before retrying"}`);
      }
      throw new Error(failure.stderr?.trim() || failure.message || "WT failed");
    }
    const reply = JSON.parse(output);
    if (reply.protocolVersion !== 1) throw new Error("Unsupported WT protocol; rebuild the package.");
    return reply;
  }
  isRepository(cwd: string): boolean {
    const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 10_000 });
    if (result.error) throw result.error;
    return result.status === 0;
  }
  session(cwd: string, action: string, task: string, harness: "pi" | "claude", conversation?: string): Reply {
    return this.run(cwd, ["session", action, task, "--harness", harness,
      ...(conversation ? ["--conversation", conversation] : [])]);
  }
}

export function packageWorktrees(moduleUrl: string): Worktrees {
  // Both adapters (and the bundled Pi entry) live two levels below the source root.
  const source = realpathSync(fileURLToPath(moduleUrl));
  return new Worktrees(resolve(dirname(source), "../../tools/worktree/target/release/wt"));
}

export function requireClean(cwd: string) {
  const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd, encoding: "utf8", timeout: 10_000 });
  if (status.trim()) throw new Error("The current checkout has changes. Leave them in place and ask before switching tasks.");
}
