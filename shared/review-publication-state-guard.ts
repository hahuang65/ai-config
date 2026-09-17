import { realpathSync } from "node:fs";
import path from "node:path";

import { anyPipeline, splitStatements, tokenize, tokenizeDetailed } from "./bash-command";
import { inlineProgramAccessesProtectedState } from "./inline-program-state-guard";

interface PublicationStateCall {
  tool: string;
  command?: string;
  path?: string;
  pattern?: string;
  cwd?: string;
  home?: string;
  protectedRoots?: Array<{ canonical: string | null; lexical: string }>;
}

const PROTECTED_STATE_DIRECTORIES = [
  ".review-publication",
  path.join(".claude", "review-publication-sessions"),
];
const RECURSIVE_FILE_TOOLS = new Set(["find", "glob", "grep", "list", "search"]);
const RECURSIVE_SHELL_UTILITIES = new Set(["du", "find", "rg", "tar"]);
const PATH_CHANGING_UTILITIES = new Set(["mv", "rename"]);
const SHELL_WRAPPERS = new Set(["bash", "dash", "ksh", "sh", "zsh"]);
const PUBLICATION_WORKER_NAMES = [
  "review-publication",
  "review-publication.mjs",
  "review-publication-worker.bundle.mjs",
  "review-publication-worker.mjs",
];
const GLOB_MAGIC = /[*?{\[]/;
const UNRESOLVED_DIRECTORY = Symbol("unresolved-directory");

export function detectReviewPublicationCredentialAccess(call: PublicationStateCall): string | null {
  const preparedCall = {
    ...call,
    protectedRoots: protectedRoots(call).map((lexical) => ({
      canonical: canonicalProtectedRoot(lexical),
      lexical,
    })),
  };
  const targetsProtectedState = !!call.path && isProtectedStatePath(call.path, preparedCall);
  const shellRunsInsideProtectedState = call.tool.toLowerCase() === "bash"
    && !!call.cwd
    && isProtectedStatePath(call.cwd, preparedCall);
  if (targetsProtectedState || shellRunsInsideProtectedState
    || recursiveFileToolCanReachProtectedState(preparedCall) || shellReferencesProtectedPublicationState(preparedCall)) {
    return "Refused — Review publication state and production worker mode are protected from model tool access.";
  }
  return null;
}

function protectedRoots(call: PublicationStateCall): string[] {
  if (!call.home) return [];
  return PROTECTED_STATE_DIRECTORIES.map((directory) => path.resolve(call.home!, directory));
}

function normalizedCandidate(candidate: string, call: PublicationStateCall, cwd = call.cwd): string | null {
  const optionValue = candidate.includes("=") ? candidate.slice(candidate.indexOf("=") + 1) : candidate;
  const unquoted = optionValue.replace(/^[<>]+/, "").replace(/^(['"])(.*)\1$/, "$2");
  if (!call.home) {
    if (/^(?:~|\$HOME|\$\{HOME\})(?:\/|$)/.test(unquoted) || !cwd && !path.isAbsolute(unquoted)) return null;
    return path.resolve(cwd ?? path.parse(unquoted).root, unquoted);
  }
  const expanded = unquoted
    .replace(/^~(?=\/|$)/, call.home)
    .replace(/^(?:\$HOME|\$\{HOME\})(?=\/|$)/, call.home);
  return path.resolve(cwd ?? call.home, expanded);
}

function canonicalizeExistingPath(candidate: string): string | null {
  let existing = candidate;
  const missingSegments: string[] = [];
  while (true) {
    try {
      return path.join(realpathSync.native(existing), ...missingSegments.reverse());
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return null;
      const parent = path.dirname(existing);
      if (parent === existing) return null;
      missingSegments.push(path.basename(existing));
      existing = parent;
    }
  }
}

function canonicalProtectedRoot(root: string): string | null {
  try {
    return realpathSync.native(root);
  } catch {
    return null;
  }
}

function isProtectedStatePath(candidate: string, call: PublicationStateCall): boolean {
  const normalized = normalizedCandidate(candidate, call);
  if (normalized === null) return false;
  return protectedRootEntries(call).some(({ lexical: root, canonical: canonicalRoot }) => {
    if (isPathWithin(normalized, root)) return true;
    if (!canonicalRoot) return false;
    const canonicalCandidate = canonicalizeExistingPath(normalized);
    return canonicalCandidate !== null && isPathWithin(canonicalCandidate, canonicalRoot);
  });
}

function pathScopeIntersectsProtectedState(candidate: string, call: PublicationStateCall, cwd = call.cwd): boolean {
  const normalized = normalizedCandidate(candidate, call, cwd);
  if (normalized === null) return false;
  return protectedRootEntries(call).some(({ lexical: root, canonical: canonicalRoot }) => {
    if (scopesIntersect(normalized, root)) return true;
    if (!canonicalRoot) return false;
    const canonicalCandidate = canonicalizeExistingPath(normalized);
    return canonicalCandidate !== null && scopesIntersect(canonicalCandidate, canonicalRoot);
  });
}

function protectedRootEntries(call: PublicationStateCall) {
  return call.protectedRoots ?? protectedRoots(call).map((lexical) => ({
    canonical: canonicalProtectedRoot(lexical),
    lexical,
  }));
}

function scopesIntersect(first: string, second: string): boolean {
  return isPathWithin(first, second) || isPathWithin(second, first);
}

function isPathWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function recursiveFileToolCanReachProtectedState(call: PublicationStateCall): boolean {
  if (!RECURSIVE_FILE_TOOLS.has(call.tool.toLowerCase())) return false;
  const searchRoot = call.path ?? call.cwd;
  if (!searchRoot) return !!call.home;
  if (pathScopeIntersectsProtectedState(searchRoot, call)) return true;
  if (call.tool.toLowerCase() !== "glob" || !call.pattern) return false;
  const normalizedRoot = normalizedCandidate(searchRoot, call);
  if (!normalizedRoot) return false;
  return pathScopeIntersectsProtectedState(fixedGlobPrefix(call.pattern, call), call, normalizedRoot);
}

function fixedGlobPrefix(pattern: string, call: PublicationStateCall): string {
  const expanded = pattern
    .replace(/^~(?=\/|$)/, call.home ?? "~")
    .replace(/^(?:\$HOME|\$\{HOME\})(?=\/|$)/, call.home ?? "$HOME");
  const magicIndex = expanded.search(GLOB_MAGIC);
  if (magicIndex < 0) return expanded;
  const fixed = expanded.slice(0, magicIndex);
  if (fixed.endsWith(path.sep)) return fixed;
  const separator = fixed.lastIndexOf(path.sep);
  return separator < 0 ? "." : fixed.slice(0, separator + 1);
}

function shellReferencesProtectedPublicationState(call: PublicationStateCall): boolean {
  if (!call.command) return false;
  if (inlineProgramAccessesProtectedState(call.command)) return true;
  let effectiveCwd: string | typeof UNRESOLVED_DIRECTORY = call.cwd ?? UNRESOLVED_DIRECTORY;
  let resolutionLost = false;
  for (const statement of splitStatements(call.command, true)) {
    const scopedCall = {
      ...call,
      cwd: effectiveCwd === UNRESOLVED_DIRECTORY ? undefined : effectiveCwd,
    };
    if (pipelineReferencesProtectedState(statement, scopedCall)) return true;
    const directoryChange = isDirectoryChange(statement);
    if (resolutionLost && !directoryChange && tokenize(statement).length > 0) return true;
    effectiveCwd = changedDirectory(statement, scopedCall, effectiveCwd);
    if (directoryChange) resolutionLost = effectiveCwd === UNRESOLVED_DIRECTORY;
  }
  return false;
}

function pipelineReferencesProtectedState(statement: string, call: PublicationStateCall): boolean {
  return anyPipeline(statement, (stages) => stages.some((stage) => {
    const tokens = publicationCheckTokens(stage);
    const referencesState = tokens.some((token) => [token, ...token.split(/\s+/)].some((part) => (
      isProtectedStatePath(part, call) || globScopeIntersectsProtectedState(part, call)
    )));
    return referencesState
      || invokesProductionWorker(tokens)
      || pathChangingOperationIntersectsProtectedState(tokens, call)
      || shellWrapperReferencesProtectedState(tokens, call)
      || recursivelyTraversesShellPath(tokens, call);
  }));
}

function publicationCheckTokens(stage: string): string[] {
  const tokenization = tokenizeDetailed(stage);
  if (!tokenization.malformed) return tokenization.tokens;
  return tokenization.tokens.map((token) => token
    .replace(/\\([\s\S])/g, "$1")
    .replace(/\\$/, ""));
}

function invokesProductionWorker(tokens: string[]): boolean {
  const parts = tokens.flatMap((token) => token.split(/\s+/)).filter(Boolean);
  return parts.includes("--inetd") && parts.some(isPublicationWorkerToken);
}

function isPublicationWorkerToken(token: string): boolean {
  const basename = path.basename(token.replace(/^["']|["']$/g, ""));
  if (PUBLICATION_WORKER_NAMES.includes(basename)) return true;
  if (!GLOB_MAGIC.test(basename)) return false;
  return expandBracePatterns(basename).some((pattern) => {
    try {
      const expression = new RegExp(`^${pattern
        .replace(/[.+^$()|{}\\]/g, "\\$&")
        .replaceAll("*", ".*")
        .replaceAll("?", ".")}$`);
      return PUBLICATION_WORKER_NAMES.some((name) => expression.test(name));
    } catch {
      return false;
    }
  });
}

function expandBracePatterns(pattern: string): string[] {
  const match = /\{([^{}]+)\}/.exec(pattern);
  if (!match) return [pattern];
  return match[1].split(",").flatMap((choice) => expandBracePatterns(
    `${pattern.slice(0, match.index)}${choice}${pattern.slice(match.index + match[0].length)}`,
  ));
}

function pathChangingOperationIntersectsProtectedState(tokens: string[], call: PublicationStateCall): boolean {
  const executableIndex = commandExecutableIndex(tokens);
  if (executableIndex < 0) return false;
  const executable = path.basename(tokens[executableIndex]);
  if (!PATH_CHANGING_UTILITIES.has(executable)) return false;
  const operands = tokens.slice(executableIndex + 1).filter((token) => token !== "--" && !/^-[^-]/.test(token));
  return operands.some((operand) => pathScopeIntersectsProtectedState(operand, call));
}

function shellWrapperReferencesProtectedState(tokens: string[], call: PublicationStateCall): boolean {
  const executableIndex = commandExecutableIndex(tokens);
  if (executableIndex < 0 || !SHELL_WRAPPERS.has(path.basename(tokens[executableIndex]))) return false;
  const args = tokens.slice(executableIndex + 1);
  const commandFlag = args.findIndex((argument) => /^-[A-Za-z]*c[A-Za-z]*$/.test(argument));
  const nestedCommand = commandFlag < 0 ? undefined : args[commandFlag + 1];
  return !!nestedCommand && shellReferencesProtectedPublicationState({
    ...call,
    command: nestedCommand,
  });
}

function commandExecutableIndex(tokens: string[]): number {
  let index = tokens.findIndex((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token));
  while (index >= 0 && ["command", "env"].includes(path.basename(tokens[index]))) {
    index += 1;
    while (index < tokens.length && (tokens[index].startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index]))) {
      index += 1;
    }
    if (index >= tokens.length) return -1;
  }
  return index;
}

function isDirectoryChange(statement: string): boolean {
  let stages: string[] = [];
  anyPipeline(statement, (candidateStages) => {
    stages = candidateStages;
    return true;
  });
  if (stages.length !== 1) return false;
  const tokens = tokenize(stages[0]);
  const executable = tokens.find((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token));
  return executable?.replace(/^.*\//, "") === "cd";
}

function changedDirectory(
  statement: string,
  call: PublicationStateCall,
  current: string | typeof UNRESOLVED_DIRECTORY,
): string | typeof UNRESOLVED_DIRECTORY {
  let stages: string[] = [];
  anyPipeline(statement, (candidateStages) => {
    stages = candidateStages;
    return true;
  });
  if (stages.length !== 1) return current;
  const tokens = tokenize(stages[0]);
  const executableIndex = tokens.findIndex((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token));
  if (executableIndex < 0 || tokens[executableIndex].replace(/^.*\//, "") !== "cd") return current;
  const args = tokens.slice(executableIndex + 1).filter((token) => token !== "--");
  if (args.length === 0) return call.home ?? UNRESOLVED_DIRECTORY;
  if (args.length !== 1 || !isSafeDirectoryLiteral(args[0])) return UNRESOLVED_DIRECTORY;
  const homeRelative = /^(?:\$HOME|\$\{HOME\}|~)(?:\/|$)/.test(args[0]);
  if (current === UNRESOLVED_DIRECTORY && !path.isAbsolute(args[0]) && !homeRelative) {
    return UNRESOLVED_DIRECTORY;
  }
  return normalizedCandidate(args[0], call, call.cwd) ?? UNRESOLVED_DIRECTORY;
}

function isSafeDirectoryLiteral(candidate: string): boolean {
  if (["-", ".", ".."].includes(candidate)) return true;
  if (/^(?:\$HOME|\$\{HOME\}|~)(?:\/|$)/.test(candidate)) return !GLOB_MAGIC.test(candidate);
  return !/[`$*?{\[]/.test(candidate);
}

function globScopeIntersectsProtectedState(candidate: string, call: PublicationStateCall): boolean {
  if (!GLOB_MAGIC.test(candidate)) return false;
  return pathScopeIntersectsProtectedState(fixedGlobPrefix(candidate, call), call);
}

function recursivelyTraversesShellPath(tokens: string[], call: PublicationStateCall): boolean {
  const executableIndex = tokens.findIndex((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token));
  if (executableIndex < 0) return false;
  const executable = tokens[executableIndex].replace(/^.*\//, "");
  const args = tokens.slice(executableIndex + 1);
  const recursiveFlag = args.some((token) => /^-[A-Za-z]*[aArR][A-Za-z]*$/.test(token)
    || ["--archive", "--recursive"].includes(token));
  if (!RECURSIVE_SHELL_UTILITIES.has(executable) && !recursiveFlag) return false;
  if (args.some((token) => !token.startsWith("-") && pathScopeIntersectsProtectedState(token, call))) {
    return true;
  }
  if (!recursiveShellUsesWorkingDirectory(executable, args, recursiveFlag)) return false;
  return !call.cwd ? !!call.home : pathScopeIntersectsProtectedState(call.cwd, call);
}

function recursiveShellUsesWorkingDirectory(executable: string, args: string[], recursiveFlag: boolean): boolean {
  if (executable === "find") return args.length === 0 || args[0].startsWith("-");
  const positional = args.filter((token) => !token.startsWith("-"));
  if (executable === "rg") return positional.length <= 1;
  if (executable === "grep" && recursiveFlag) return positional.length <= 1;
  if (executable === "du") return positional.length === 0;
  return positional.length === 0;
}
