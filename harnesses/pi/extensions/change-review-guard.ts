import { tmpdir } from "node:os";
import * as path from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface ChangeReviewGateContext {
  active: boolean;
  root: string;
  tempRoot: string;
}

interface ToolCall {
  toolName: string;
  input: Record<string, unknown>;
}

interface BlockVerdict {
  reason: string;
}

const READ_ONLY_GIT = new Set([
  "blame", "cat-file", "diff", "diff-tree", "fetch", "for-each-ref", "grep", "log",
  "ls-files", "ls-remote", "merge-base", "name-rev", "rev-list", "rev-parse", "show",
  "show-ref", "status", "symbolic-ref",
]);
const DIRECT_MUTATIONS = new Set([
  "chmod", "chown", "cp", "dd", "install", "ln", "mkdir", "mv", "patch", "rm", "rmdir",
  "rsync", "tar", "tee", "touch", "truncate", "unzip", "zip",
]);
const READ_ONLY_COMMANDS = new Set([
  "basename", "cat", "cut", "dirname", "du", "file", "find", "grep", "head", "ls", "pwd",
  "realpath", "rg", "sort", "stat", "tail", "tr", "uniq", "wc", "which",
]);

export function evaluateChangeReviewToolCall(
  call: ToolCall,
  context: ChangeReviewGateContext,
): BlockVerdict | null {
  if (!context.active) return null;
  const command = stringValue(call.input.command);
  if (call.toolName === "bash" && command) {
    const mutation = classifyShellMutation(command);
    if (mutation) return block(mutation);
  }
  if (!new Set(["write", "edit"]).has(call.toolName)) return null;
  const candidate = stringValue(call.input.path ?? call.input.file_path);
  const resolvedCandidate = candidate ? path.resolve(context.root, candidate) : null;
  if (resolvedCandidate && isWithinRoot(resolvedCandidate, context.tempRoot)) return null;
  if (resolvedCandidate && isWithinRoot(resolvedCandidate, context.root)) {
    return block("Standalone Change review blocks repository writes in its read-only workspace");
  }
  return block("Standalone Change review allows structured writes only in its temporary report directory");
}

function classifyShellMutation(command: string): string | null {
  if (hasCommandSubstitution(command)) {
    return "Standalone Change review blocks shell command substitution";
  }
  if (hasOutputRedirection(command)) {
    return "Standalone Change review blocks shell output redirection outside its report tool path";
  }
  for (const rawSegment of shellSegments(command)) {
    const segment = unwrapCommand(rawSegment);
    if (!segment) return "Standalone Change review blocks an unsupported shell wrapper";
    const executable = path.basename(segment[0] ?? "").toLowerCase();
    if (executable === "git" && isGitMutation(segment.slice(1))) {
      return "Change review blocks Git delivery mutation";
    }
    if (isProviderMutation(executable, segment.slice(1))) {
      return "Change review blocks provider mutation";
    }
    if (isDirectMutation(executable, segment.slice(1))) {
      return "Standalone Change review blocks direct mutation in its read-only workspace";
    }
    if (!isAllowedCommand(executable, segment.slice(1))) {
      return "Standalone Change review blocks an unsupported shell command";
    }
  }
  return null;
}

function isGitMutation(args: string[]): boolean {
  const commandIndex = gitSubcommandIndex(args);
  const command = commandIndex === -1 ? "" : args[commandIndex].toLowerCase();
  const commandArgs = args.slice(commandIndex + 1);
  if (READ_ONLY_GIT.has(command)) return false;
  if (command === "branch") {
    const first = commandArgs[0] ?? "";
    return !new Set(["", "--all", "--contains", "--format", "--list", "--show-current", "-a", "-l"]).has(first)
      && !first.startsWith("--format=");
  }
  if (command === "config") {
    const first = commandArgs[0] ?? "";
    return !first.startsWith("--get") && !new Set(["--list", "--show-origin", "-l"]).has(first);
  }
  if (command === "remote") return !new Set(["", "-v", "get-url", "show"]).has(commandArgs[0] ?? "");
  if (command === "worktree") return !new Set(["add", "list", "remove"]).has(commandArgs[0] ?? "");
  return true;
}

function gitSubcommandIndex(args: string[]): number {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]).has(token)) {
      index += 1;
      continue;
    }
    if (!token.startsWith("-")) return index;
  }
  return -1;
}

function isProviderMutation(executable: string, args: string[]): boolean {
  if (new Set(["curl", "http", "https", "wget"]).has(executable)) return isNetworkMutation(executable, args);
  if (executable !== "gh") return new Set(["bb", "glab", "hub"]).has(executable);
  const group = args[0]?.toLowerCase() ?? "";
  const action = args[1]?.toLowerCase() ?? "";
  if (group === "api") return ghApiMutates(args.slice(1));
  if (group === "pr") return !new Set(["checks", "diff", "status", "view"]).has(action);
  if (group === "repo") return action !== "view";
  if (group === "run") return !new Set(["list", "view"]).has(action);
  return !(group === "auth" && action === "status");
}

function ghApiMutates(args: string[]): boolean {
  const method = optionMethod(args, "-X", "--method");
  const hasInput = args.some((token) => /^(?:-f|-F|--field|--raw-field|--input)(?:=|$)/.test(token));
  return hasInput || (!!method && !new Set(["GET", "HEAD"]).has(method));
}

function isNetworkMutation(executable: string, args: string[]): boolean {
  if (executable === "curl") {
    if (args.some((token) => token === "-K" || token.startsWith("-K") || token.startsWith("--config"))) return true;
    const method = optionMethod(args, "-X", "--request");
    const writesBody = args.some((token) => token === "-d" || token.startsWith("-d")
      || token.startsWith("--data") || token === "--json" || token.startsWith("--form")
      || token === "-F" || token.startsWith("-F") || token === "-T"
      || token.startsWith("-T") || token.startsWith("--upload-file"));
    const writesFile = args.some((token) => /^-[^-]*[oO]/.test(token)
      || token.startsWith("--output") || token.startsWith("--remote-name"));
    return writesBody || writesFile || (!!method && !new Set(["GET", "HEAD"]).has(method));
  }
  if (new Set(["http", "https", "wget"]).has(executable)) return true;
  return false;
}

function optionMethod(args: string[], shortFlag: string, longFlag: string): string {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === shortFlag || token === longFlag) return args[index + 1]?.toUpperCase() ?? "";
    if (token.startsWith(shortFlag) && token.length > shortFlag.length) {
      return token.slice(shortFlag.length).toUpperCase();
    }
    if (token.startsWith(`${longFlag}=`)) return token.slice(longFlag.length + 1).toUpperCase();
  }
  return "";
}

function isDirectMutation(executable: string, args: string[]): boolean {
  if (DIRECT_MUTATIONS.has(executable)) return true;
  if (executable === "sed") return args.some((token) => token === "-i" || token.startsWith("-i"));
  if (executable === "perl") return args.some((token) => token.startsWith("-") && /[ei]/.test(token.slice(1)));
  if (new Set(["node", "ruby"]).has(executable)) return hasInlineOption(args, "-e", "--eval");
  if (/^python\d*$/.test(executable)) return hasInlineOption(args, "-c", "--command");
  return new Set(["bash", "sh"]).has(executable) && hasInlineOption(args, "-c", "--command");
}

function unwrapCommand(tokens: string[]): string[] | null {
  let remaining = [...tokens];
  while (isAssignment(remaining[0])) remaining = remaining.slice(1);
  if (path.basename(remaining[0] ?? "") === "command") {
    remaining = remaining.slice(1);
    while (remaining[0] === "-p" || remaining[0] === "--") remaining = remaining.slice(1);
    if (remaining[0]?.startsWith("-")) return null;
  }
  if (path.basename(remaining[0] ?? "") !== "env") return remaining;
  remaining = remaining.slice(1);
  while (remaining.length > 0) {
    const token = remaining[0];
    if (token === "--") { remaining = remaining.slice(1); break; }
    if (isAssignment(token) || new Set(["-i", "--ignore-environment"]).has(token)) {
      remaining = remaining.slice(1); continue;
    }
    if (new Set(["-u", "--unset", "-C", "--chdir"]).has(token)) {
      if (!remaining[1]) return null;
      remaining = remaining.slice(2); continue;
    }
    if (token.startsWith("--unset=") || token.startsWith("--chdir=")) {
      remaining = remaining.slice(1); continue;
    }
    if (token.startsWith("-")) return null;
    break;
  }
  return remaining;
}

function hasInlineOption(args: string[], shortFlag: string, longFlag: string): boolean {
  return args.some((token) => token === shortFlag || token.startsWith(shortFlag)
    || token === longFlag || token.startsWith(`${longFlag}=`));
}

function isAssignment(token: string | undefined): boolean {
  return !!token && /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function isAllowedCommand(executable: string, args: string[]): boolean {
  if (READ_ONLY_COMMANDS.has(executable)) {
    if (executable === "find") return !args.some((token) => /^-(?:delete|exec|execdir|fls|fprint|fprintf|ok)/.test(token));
    if (executable === "sort") return !args.some((token) => /^-[^-]*o/.test(token) || token.startsWith("--output"));
    return true;
  }
  if (new Set(["git", "gh", "curl"]).has(executable)) return true;
  if (executable === "node") return args[0] === "--test";
  if (executable === "bun") return args[0] === "test" || (args[0] === "run" && isCheckTarget(args[1]));
  if (new Set(["npm", "pnpm", "yarn"]).has(executable)) {
    return args[0] === "test" || (args[0] === "run" && isCheckTarget(args[1]));
  }
  if (executable === "make") return args.slice(0, 2).some(isCheckTarget);
  if (executable === "go") return new Set(["build", "test", "vet"]).has(args[0]);
  if (executable === "cargo") return new Set(["build", "check", "clippy", "test"]).has(args[0]);
  if (executable === "deno") return new Set(["check", "lint", "test"]).has(args[0]);
  if (/^pytest(?:-\d+)?$/.test(executable) || executable === "rspec" || executable === "rubocop") return true;
  return executable === "bundle" && args[0] === "exec" && new Set(["rspec", "rubocop"]).has(args[1]);
}

function isCheckTarget(value: string | undefined): boolean {
  return !!value && /^(?:build|check|lint|test|typecheck)(?:[:/-].*)?$/.test(value);
}

function hasCommandSubstitution(command: string): boolean {
  let singleQuoted = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (char === "'") {
      if (singleQuoted) singleQuoted = false;
      else if (!isEscaped(command, index)) singleQuoted = true;
    }
    if (!singleQuoted && (char === "`" || (new Set(["$", "<", ">"]).has(char)
      && command[index + 1] === "("))) return true;
  }
  return false;
}

function isEscaped(value: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

function hasOutputRedirection(command: string): boolean {
  let quote = "";
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char !== ">") continue;
    const suffix = command.slice(index + 1).replace(/^\|?\s*/, "");
    if (/^&\d/.test(suffix) || /^\/dev\/(?:null|stdout|stderr)(?:\s|$)/.test(suffix)) continue;
    return true;
  }
  return false;
}

function shellSegments(command: string): string[][] {
  const segments: string[][] = [[]];
  let token = "";
  let quote = "";
  const flush = () => { if (token) segments.at(-1)?.push(token); token = ""; };
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) quote = ""; else token += char;
    } else if (char === "'" || char === '"') quote = char;
    else if (char === "\n" || char === "\r") { flush(); segments.push([]); }
    else if (/\s/.test(char)) flush();
    else if (new Set([";", "|", "&"]).has(char)) { flush(); segments.push([]); }
    else if (char === "\\" && index + 1 < command.length) token += command[++index];
    else token += char;
  }
  flush();
  return segments.filter((segment) => segment.length > 0);
}

function isWithinRoot(candidate: string, root: string): boolean {
  const absoluteRoot = path.resolve(root);
  const absoluteCandidate = path.resolve(absoluteRoot, candidate);
  const relative = path.relative(absoluteRoot, absoluteCandidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function block(reason: string): BlockVerdict {
  return { reason };
}

export default function (pi: ExtensionAPI): void {
  const context: ChangeReviewGateContext = {
    active: process.env.CHANGE_REVIEW_GATE === "1",
    root: process.env.CHANGE_REVIEW_GATE_ROOT ?? process.cwd(),
    tempRoot: process.env.CHANGE_REVIEW_REPORT_ROOT ?? tmpdir(),
  };
  if (!context.active) return;
  pi.on("tool_call", (event) => {
    const verdict = evaluateChangeReviewToolCall({
      toolName: String(event.toolName ?? ""),
      input: (event.input ?? {}) as Record<string, unknown>,
    }, context);
    if (verdict) return { block: true, reason: verdict.reason };
  });
}
