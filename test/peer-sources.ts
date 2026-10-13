import { resolve } from "node:path";

const evaluationRoot = resolve(import.meta.dir, "..");

export function peerSource(name: "wt" | "wl"): string {
  return resolve(evaluationRoot, process.env[`${name.toUpperCase()}_SOURCE`] ?? `tools/${name === "wt" ? "worktree" : "worklog"}`);
}
