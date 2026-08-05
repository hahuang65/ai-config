import path from "node:path";

import { anyPipeline, splitStatements, tokenize } from "./bash-command";

interface BranchGuardCall {
  command?: string;
  cwd?: string;
  home?: string;
}

export function detectOrchardBranchBindingChange(call: BranchGuardCall): string | null {
  if (!call.command || !call.cwd) return null;
  let currentDirectory = call.cwd;
  for (const statement of splitStatements(call.command)) {
    const changedDirectory = readDirectoryChange(statement, currentDirectory, call.home);
    if (changedDirectory) {
      currentDirectory = changedDirectory;
      continue;
    }
    if (anyPipeline(statement, (stages) =>
      stages.some((stage) => changesBranchInOrchard(tokenize(stage), currentDirectory, call.home)))) {
      return "Refused — changing a branch binding beneath Orchard can quarantine the managed worktree. For cross-repository branch changes, use git -C <absolute-repository-path>.";
    }
  }
  return null;
}

function changesBranchInOrchard(
  tokens: string[],
  callerDirectory: string,
  homeDirectory?: string,
): boolean {
  const gitIndex = tokens.findIndex((token) => token === "git" || token.endsWith("/git"));
  if (gitIndex === -1) return false;
  const gitArguments = tokens.slice(gitIndex + 1);
  const hasExplicitDirectory = gitArguments[0] === "-C" && Boolean(gitArguments[1]);
  const targetDirectory = hasExplicitDirectory
    ? resolveTargetDirectory(callerDirectory, gitArguments[1], homeDirectory)
    : callerDirectory;
  const commandIndex = hasExplicitDirectory ? 2 : 0;
  if (!isOrchardPath(targetDirectory)) return false;
  const gitCommand = gitArguments[commandIndex];
  const commandArguments = gitArguments.slice(commandIndex + 1);
  if (commandArguments.includes("--help")) return false;
  if (gitCommand === "switch") return true;
  if (gitCommand === "branch") {
    return commandArguments.includes("-m") || commandArguments.includes("-M");
  }
  if (gitCommand === "symbolic-ref") {
    return commandArguments[0] === "HEAD" && Boolean(commandArguments[1]);
  }
  if (gitCommand === "update-ref") {
    const headIndex = commandArguments.indexOf("HEAD");
    return headIndex >= 0 && Boolean(commandArguments[headIndex + 1]);
  }
  return gitCommand === "checkout" && !commandArguments.includes("--");
}

function resolveTargetDirectory(
  callerDirectory: string,
  target: string,
  homeDirectory?: string,
): string {
  if (homeDirectory && (target === "~" || target.startsWith("~/"))) {
    return path.resolve(homeDirectory, target.slice(2));
  }
  return path.resolve(callerDirectory, target);
}

function readDirectoryChange(
  statement: string,
  currentDirectory: string,
  homeDirectory?: string,
): string | undefined {
  const tokens = tokenize(statement);
  if (tokens[0] !== "cd" || !tokens[1]) return undefined;
  return resolveTargetDirectory(currentDirectory, tokens[1], homeDirectory);
}

function isOrchardPath(candidate: string): boolean {
  return /(^|[/\\])\.orchard(?:[/\\]|$)/.test(candidate);
}
