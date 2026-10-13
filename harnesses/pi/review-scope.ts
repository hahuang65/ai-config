import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import guardPolicies from "./guard-policies.bundle";

const DENIED = "The reviewer can only read regular snapshot files; outside paths, private files, Git metadata and runtime state are unavailable.";

function insideFile(root: string, path: unknown): string {
  if (typeof path !== "string" || path.includes("\0")) throw new Error(DENIED);
  const canonical = realpathSync(resolve(root, path));
  const local = relative(root, canonical);
  if (!local || local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)
      || local.split(sep).some(part => part === ".git" || part === ".state" || part.includes("auth.json") || /^\.env(?:\.|$)/.test(part))
      || !statSync(canonical).isFile()) throw new Error(DENIED);
  return canonical;
}

export default function reviewScope(pi: ExtensionAPI) {
  const configured = process.env.PI_REVIEW_ROOT;
  const launchRoot = process.env.PI_REVIEW_LAUNCH_ROOT;
  if (!configured || !isAbsolute(configured) || !launchRoot || !isAbsolute(launchRoot)) throw new Error("Reviewer snapshot is not configured");
  const root = realpathSync(configured);
  if (root === sep || !statSync(root).isDirectory()) throw new Error("Reviewer snapshot is invalid");

  pi.on("tool_call", event => {
    if (event.toolName !== "read") return { block: true, reason: "Only snapshot file reads are available to the reviewer." };
    try {
      // Pi requires in-place argument normalization. This also prevents its
      // tilde expansion and ensures the shared guard sees symlink destinations.
      event.input.path = insideFile(root, event.input.path);
    } catch {
      return { block: true, reason: DENIED };
    }
  });
  // Register the same generated Pi guard used in ordinary sessions. If either
  // module fails to load, --no-builtin-tools leaves no tools active.
  // Unlike --no-tools, it permits this extension to activate the reader.
  guardPolicies(pi);
  pi.on("session_start", (_event, ctx) => {
    if (realpathSync(ctx.cwd) !== realpathSync(launchRoot)) throw new Error("Reviewer must start in its trusted launcher directory");
    pi.setActiveTools(["read"]);
  });
  pi.on("before_agent_start", () => {
    pi.appendEntry("review-scope-ready", { root, tools: pi.getActiveTools() });
  });
}
