import { basename } from "node:path";
import { anyPipeline, inputRedirects, literalWord, stageNode, stageWords, wordValue } from "./bash-command";
import { field, named, parseShell, type ShellNode, ShellSyntaxError } from "./shell-parser";
import { SHELLS, readsProgramFromStdin, shellCommandIndex, shellSyntaxOnly } from "./interpreter-input";
export { SHELLS } from "./interpreter-input";

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const WRAPPERS = new Set(["command", "env", "exec", "nohup", "nice", "timeout"]);

/** Wrapper options are utility semantics; Bash words and redirections come from the syntax tree. */
export function invocationNodes(stage: string): ShellNode[] {
  let nodes = stageWords(stage);
  while (nodes[0]?.type === "variable_assignment") nodes = nodes.slice(1);
  while (nodes.length) {
    const executable = basename(wordValue(nodes[0]));
    if (!WRAPPERS.has(executable)) return nodes;
    nodes = nodes.slice(1);
    while (nodes.length && wordValue(nodes[0]).startsWith("-")) {
      const option = wordValue(nodes.shift()!);
      if (executable === "command" && /^-[p]*[vV]/.test(option)) return [];
      if (option === "--") break;
      if (executable === "env" && ["-u", "--unset", "-C", "--chdir"].includes(option)) nodes.shift();
      if (executable === "exec" && option === "-a") nodes.shift();
      if (executable === "nice" && ["-n", "--adjustment"].includes(option)) nodes.shift();
      if (executable === "timeout" && ["-k", "-s", "--kill-after", "--signal"].includes(option)) nodes.shift();
    }
    if (executable === "timeout") nodes.shift();
    if (executable === "env") while (nodes.length && ASSIGNMENT.test(wordValue(nodes[0]))) nodes.shift();
  }
  return [];
}

export const rawInvocation = (stage: string): string[] => invocationNodes(stage).map(wordValue);
export function invocation(stage: string): string[] {
  const words = rawInvocation(stage);
  return words.length ? [basename(words[0]), ...words.slice(1)] : [];
}

export function nestedCommand(stage: string, words: string[]): string | undefined {
  let node = stageNode(stage);
  while (node?.type === "redirected_statement") node = field(node, "body");
  if (node && ["subshell", "compound_statement"].includes(node.type)) return named(node).map((child) => child.text).join("\n");
  const nodes = invocationNodes(stage);
  if (words[0] === "eval") {
    const values = nodes.slice(words[1] === "--" ? 2 : 1).map(literalWord);
    return values.every((value) => value !== null) ? values.join(" ") : undefined;
  }
  const body = nodes[shellCommandIndex(words)];
  if (body) return literalProgram(body, words);
  if (!SHELLS.has(words[0]) || !readsProgramFromStdin(words)) return undefined;
  const redirect = inputRedirects(stage).at(-1);
  if (!redirect || redirect.type === "file_redirect") return undefined;
  const input = named(redirect).find((child) => child.type === "heredoc_body")
    ?? named(redirect).find((child) => child.field !== "descriptor");
  return input ? literalProgram(input, words) : undefined;
}

function literalProgram(node: ShellNode, words: string[]): string | undefined {
  const source = literalWord(node);
  if (source === null) return undefined;
  if (shellSyntaxOnly(words)) { parseShell(source); return undefined; }
  return source;
}

export function anyInvocation(command: string | undefined, predicate: (words: string[], stage: string) => boolean, depth = 0): boolean {
  if (!command) return false;
  if (depth > 16) throw new ShellSyntaxError("The Bash command exceeds the nested-program inspection limit.");
  return anyPipeline(command, (stages) => stages.some((stage) => {
    const words = invocation(stage);
    if (words.length && predicate(words, stage)) return true;
    const nested = nestedCommand(stage, words);
    return nested !== undefined && anyInvocation(nested, predicate, depth + 1);
  }));
}
