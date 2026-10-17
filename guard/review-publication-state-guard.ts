import { realpathSync } from "node:fs";
import path from "node:path";

import { anyPipeline, splitStatements, tokenize, stageNode, commandNode, wordValue, redirects, literalWord } from "./bash-command";
import { anyInvocation, invocation, invocationNodes, nestedCommand, SHELLS } from "./command-invocations";
import { field, fields, ShellSyntaxError } from "./shell-parser";
import { staticShellValue } from "./shell-values";
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
const RECURSIVE_FLAG_UTILITIES = new Set(["grep", "cp", "mv", "rm", "ls", "chmod", "chown", "rsync", "scp", "zip", "diff"]);
const PATH_CHANGING_UTILITIES = new Set(["mv", "rename"]);
const WORKER_INTERPRETERS = new Set([...SHELLS, "node", "bun", "python", "python3", "ruby", "perl"]);
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
  let safePrefix = true;
  let assignment: { name: string; value: string } | null = null;
  for (const statement of splitStatements(call.command)) {
    const scopedCall = {
      ...call,
      cwd: effectiveCwd === UNRESOLVED_DIRECTORY ? undefined : effectiveCwd,
    };
    if (pipelineReferencesProtectedState(statement, scopedCall)) return true;
    const directoryChange = isDirectoryChange(statement);
    const executableStatement = anyInvocation(statement, () => true);
    if (resolutionLost && !directoryChange && executableStatement) return true;
    const nextAssignment = safePrefix ? safeDirectoryAssignment(statement, scopedCall) : null;
    if (!directoryChange && !commandNode(stageNode(statement))
      && anyInvocation(statement, ([executable]) => executable === "cd")) return true;
    effectiveCwd = changedDirectory(statement, scopedCall, effectiveCwd, safePrefix ? assignment : null);
    if (directoryChange) {
      if (effectiveCwd !== UNRESOLVED_DIRECTORY && isProtectedStatePath(effectiveCwd, scopedCall)) return true;
      resolutionLost = effectiveCwd === UNRESOLVED_DIRECTORY;
      safePrefix = false;
      assignment = null;
    } else if (safePrefix && statement.trim() === "set -eu") {
      assignment = null;
    } else if (nextAssignment) {
      // Only standalone static assignments before the first directory change can be trusted.
      assignment = nextAssignment;
    } else if (executableStatement) {
      safePrefix = false;
      assignment = null;
    }
  }
  return false;
}

function pipelineReferencesProtectedState(statement: string, call: PublicationStateCall): boolean {
  return anyPipeline(statement, (stages) => stages.some((stage) => {
    const tokens = [...tokenize(stage), ...redirects(stage).flatMap((redirect) => fields(redirect, "destination").map(wordValue))];
    const words = invocation(stage);
    const referencesState = tokens.some((token) => isProtectedStatePath(token, call) || globScopeIntersectsProtectedState(token, call));
    return referencesState
      || invokesProductionWorker(stage)
      || pathChangingOperationIntersectsProtectedState(words, call)
      || shellWrapperReferencesProtectedState(stage, call)
      || recursivelyTraversesShellPath(words, call);
  }));
}

function invokesProductionWorker(stage: string): boolean {
  const [executable, ...args] = invocation(stage);
  if (!executable || !args.includes("--inetd")) return false;
  const nodes = invocationNodes(stage);
  if (isPublicationWorkerToken(executable, literalWord(nodes[0]) === null)) return true;
  return WORKER_INTERPRETERS.has(executable) && args.some((arg, index) =>
    isPublicationWorkerToken(arg, literalWord(nodes[index + 1]) === null));
}

function isPublicationWorkerToken(token: string, expanding: boolean): boolean {
  const basename = path.basename(token.replace(/^["']|["']$/g, ""));
  if (PUBLICATION_WORKER_NAMES.includes(basename)) return true;
  if (!expanding || !GLOB_MAGIC.test(basename)) return false;
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

function expandBracePatterns(pattern: string, budget = { remaining: 64 }, depth = 0): string[] {
  if (pattern.length > 1024 || depth > 16 || budget.remaining-- <= 0) {
    throw new ShellSyntaxError("The Bash pathname pattern exceeds the inspection limits.");
  }
  const match = /\{([^{}]+)\}/.exec(pattern);
  if (!match) return [pattern];
  return match[1].split(",").flatMap((choice) => expandBracePatterns(
    `${pattern.slice(0, match.index)}${choice}${pattern.slice(match.index + match[0].length)}`, budget, depth + 1,
  ));
}

function pathChangingOperationIntersectsProtectedState([executable, ...args]: string[], call: PublicationStateCall): boolean {
  if (!PATH_CHANGING_UTILITIES.has(executable)) return false;
  const operands = args.filter((token) => token !== "--" && !/^-[^-]/.test(token));
  return operands.some((operand) => pathScopeIntersectsProtectedState(operand, call));
}

function shellWrapperReferencesProtectedState(stage: string, call: PublicationStateCall): boolean {
  const command = nestedCommand(stage, invocation(stage));
  return !!command && shellReferencesProtectedPublicationState({ ...call, command });
}

function isDirectoryChange(statement: string): boolean {
  return invocation(statement)[0] === "cd";
}

function safeDirectoryAssignment(statement: string, call: PublicationStateCall): { name: string; value: string } | null {
  const node = stageNode(statement);
  if (node?.type !== "variable_assignment") return null;
  const name = field(node, "name")?.text;
  const valueNode = field(node, "value");
  if (!name || name === "HOME" || !valueNode) return null;
  const value = staticShellValue(valueNode, call.home ? { HOME: call.home } : {});
  return value !== null && path.isAbsolute(value) ? { name, value } : null;
}

function changedDirectory(
  statement: string,
  call: PublicationStateCall,
  current: string | typeof UNRESOLVED_DIRECTORY,
  assignment: { name: string; value: string } | null,
): string | typeof UNRESOLVED_DIRECTORY {
  if (!isDirectoryChange(statement)) return current;
  const command = commandNode(stageNode(statement));
  const args = command?.children.filter((child) => child.field === "argument" && wordValue(child) !== "--") ?? [];
  if (args.length === 0) return call.home ?? UNRESOLVED_DIRECTORY;
  if (args.length !== 1) return UNRESOLVED_DIRECTORY;
  const variables = { ...(call.home ? { HOME: call.home } : {}), ...(assignment ? { [assignment.name]: assignment.value } : {}) };
  const candidate = staticShellValue(args[0], variables);
  if (candidate === null || candidate === "-" || /[$`]/.test(candidate)) return UNRESOLVED_DIRECTORY;
  if (current === UNRESOLVED_DIRECTORY && !path.isAbsolute(candidate)) return UNRESOLVED_DIRECTORY;
  return path.resolve(current === UNRESOLVED_DIRECTORY ? "/" : current, candidate);
}

function globScopeIntersectsProtectedState(candidate: string, call: PublicationStateCall): boolean {
  if (!GLOB_MAGIC.test(candidate)) return false;
  return pathScopeIntersectsProtectedState(fixedGlobPrefix(candidate, call), call);
}

function recursivelyTraversesShellPath([executable, ...args]: string[], call: PublicationStateCall): boolean {
  const recursiveFlag = args.some((token) => /^-[A-Za-z]*[aArR][A-Za-z]*$/.test(token)
    || ["--archive", "--recursive"].includes(token));
  if (!RECURSIVE_SHELL_UTILITIES.has(executable) && !(recursiveFlag && RECURSIVE_FLAG_UTILITIES.has(executable))) return false;
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
