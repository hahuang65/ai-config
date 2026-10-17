import { lstatSync, realpathSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { commandWords, literalWord, stageNode } from "./bash-command";
import { anyInvocation } from "./command-invocations";
import type { ToolCall } from "./guard-core";

// Deliberately narrow package policy, not a heuristic that any build/tmp directory is disposable.
const CLEANUP_DIRECTORY = "build/cache";

function rmArguments(args: string[]) {
  let options = true;
  let recursive = false;
  const paths: string[] = [];
  for (const arg of args) {
    if (options && arg === "--") { options = false; continue; }
    if (options && arg.startsWith("-")) {
      if (/^-[^-]*[rR]/.test(arg) || arg.length > 2 && "--recursive".startsWith(arg)) recursive = true;
    } else paths.push(arg);
  }
  return { recursive, paths };
}

function designatedPath(candidate: string, cwd: string): boolean {
  if (candidate.split("/").includes("..")) return false;
  const root = resolve(cwd, CLEANUP_DIRECTORY);
  const target = resolve(cwd, candidate);
  if (target !== root && !target.startsWith(root + sep)) return false;
  try {
    let current = realpathSync(cwd);
    for (const component of relative(cwd, target).split(sep)) {
      current = join(current, component);
      try {
        if (lstatSync(current).isSymbolicLink()) return false;
      } catch (error) {
        // A missing suffix cannot be redirected by a currently existing symlink.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
        return false;
      }
    }
    return true;
  } catch { return false; }
}

function simpleCleanup(call: ToolCall, paths: string[]): boolean {
  if (!call.cwd || !isAbsolute(call.cwd) || !call.command || paths.length === 0) return false;
  // No cwd simulation or variable expansion: the exception is only for one direct rm invocation.
  const node = stageNode(call.command);
  if (node?.type !== "command" || node.children.some((child) => child.type === "variable_assignment" || child.field === "redirect")) return false;
  const values = commandWords(node).map(literalWord);
  if (values.some((value) => value === null) || basename(values[0] ?? "") !== "rm") return false;
  return paths.every((candidate) => designatedPath(candidate, call.cwd!));
}

export function detectRecursiveDelete(call: ToolCall): string | null {
  const denied = anyInvocation(call.command, ([executable, ...args]) => {
    if (executable === "rm") {
      const { recursive, paths } = rmArguments(args);
      return recursive && !simpleCleanup(call, paths);
    }
    return executable === "find" && (args.includes("-delete")
      || args.some((arg) => ["-exec", "-execdir", "-ok", "-okdir"].includes(arg))
        && args.some((arg) => /(?:^|\/)rm$/.test(arg)));
  });
  return denied ? "Refused — recursive deletion is limited to a direct rm of build/cache below the tool working directory, with no redirected path; the user must run other recursive deletions manually." : null;
}
