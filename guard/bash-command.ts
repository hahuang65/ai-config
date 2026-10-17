// Bash structure comes only from tree-sitter-bash. No split/regex shell parser fallback.
import { posix } from "node:path";
import { descendants, field, fields, named, parseShell, type ShellNode } from "./shell-parser";

/** Decode a syntax-classified shell word; expansions retain their spelling, not a guessed value. */
export function wordValue(node: ShellNode): string {
  if (node.type === "raw_string") return node.text.slice(1, -1);
  if (node.type === "ansi_c_string") return ansiValue(node.text.slice(2, -1));
  if (node.type === "command_name") return named(node).map(wordValue).join("");
  if (node.type === "concatenation") return node.children.map(wordValue).join("");
  if (node.type === "string" || node.type === "translated_string") return named(node).map(wordValue).join("");
  if (node.type === "string_content") return node.text.replace(/\\([$`"\\\n])/g, (_match, character) => character === "\n" ? "" : character);
  if (node.type === "word") return node.text.replace(/\\([\s\S])/g, (_match, character) => character === "\n" ? "" : character);
  return node.text;
}

function ansiValue(value: string): string {
  const escapes: Record<string, string> = { a: "\x07", b: "\b", e: "\x1b", E: "\x1b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\", "'": "'", '"': '"' };
  return value.replace(/\\(x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8}|[0-7]{1,3}|[\s\S])/g, (match, escape: string) => {
    if (escape in escapes) return escapes[escape];
    if (/^[xuU]/.test(escape)) {
      const code = Number.parseInt(escape.slice(1), 16);
      return code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    if (/^[0-7]/.test(escape)) return String.fromCharCode(Number.parseInt(escape, 8));
    return match;
  });
}

export function literalWord(node: ShellNode): string | null {
  if (["expansion", "simple_expansion", "command_substitution", "process_substitution", "arithmetic_expansion", "brace_expression", "extglob_pattern"].includes(node.type)) return null;
  if (node.type === "word" && /[*?\[{}~]/.test(node.text.replace(/\\./g, ""))) return null;
  if (node.children.some((child) => child.named && literalWord(child) === null)) return null;
  const value = wordValue(node);
  return value.includes("\0") ? null : value;
}

export function stageNode(stage: string): ShellNode | undefined {
  const statements = named(parseShell(stage)).filter((node) => node.type !== "comment");
  return statements.length === 1 ? statements[0] : undefined;
}

export function commandNode(node: ShellNode | undefined): ShellNode | undefined {
  if (!node) return undefined;
  if (node.type === "command") return node;
  if (node.type === "redirected_statement") return commandNode(field(node, "body"));
  return undefined;
}

export function commandWords(node: ShellNode): ShellNode[] {
  const command = commandNode(node);
  if (!command) return node.type === "variable_assignment" ? [node] : [];
  const name = field(command, "name");
  return [...named(command).filter((child) => child.type === "variable_assignment"),
    ...(name ? [name] : []), ...fields(command, "argument")];
}

export function stageWords(stage: string): ShellNode[] {
  const node = stageNode(stage);
  return node ? commandWords(node) : [];
}

export const tokenize = (stage: string): string[] => stageWords(stage).map(wordValue);

export function splitStatements(command: string): string[] {
  const statements = (node: ShellNode): ShellNode[] => node.type === "program" || node.type === "list"
    ? named(node).flatMap(statements) : node.type === "comment" ? [] : [node];
  return statements(parseShell(command)).map((node) => node.text);
}

export function redirects(stage: string): ShellNode[] {
  const node = stageNode(stage);
  if (!node) return [];
  return [...fields(node, "redirect"), ...fields(commandNode(node) ?? node, "redirect")]
    .filter((redirect, index, all) => all.indexOf(redirect) === index)
    .sort((left, right) => left.start - right.start);
}

export function descriptorPath(value: string): string | undefined {
  const path = posix.normalize(value);
  if (path === "/dev/stdin") return "0";
  if (path === "/dev/stdout") return "1";
  if (path === "/dev/stderr") return "2";
  return /^\/(?:dev\/fd|proc\/self\/fd)\/(\d+)$/.exec(path)?.[1];
}

const REDIRECT_OPERATORS = new Set(["<", "<>", "<&", ">", ">>", ">|", ">&", "&>", "&>>", "<<", "<<-", "<<<"]);

/** Descriptor copies capture their source at that point, not its later value. */
function effectiveRedirect(stage: string, descriptor: string): ShellNode | undefined {
  const streams = new Map<string, ShellNode | undefined>();
  for (const node of redirects(stage)) {
    const operator = node.children.find((child) => REDIRECT_OPERATORS.has(child.type))?.type ?? "";
    const target = field(node, "descriptor")?.text ?? (operator.startsWith("<") ? "0" : "1");
    const destination = field(node, "destination");
    const value = destination ? literalWord(destination) : null;
    const duplicate = ["<&", ">&"].includes(operator) && value?.match(/^(\d+)(-?)$/);
    if (duplicate) {
      streams.set(target, streams.get(duplicate[1]));
      if (duplicate[2]) streams.set(duplicate[1], node);
    } else if (value !== null && descriptorPath(value) !== undefined) {
      streams.set(target, streams.get(descriptorPath(value)!));
    } else {
      streams.set(target, node);
      if (["&>", "&>>"].includes(operator)) streams.set("2", node);
    }
  }
  return streams.get(descriptor);
}

export function inputRedirects(stage: string): ShellNode[] {
  const input = effectiveRedirect(stage, "0");
  return input ? [input] : [];
}

export function stdoutRedirects(stage: string): string[] {
  const node = effectiveRedirect(stage, "1");
  if (!node?.children.some((child) => [">", ">>", ">|", "&>", "&>>"].includes(child.type))) return [];
  const destination = field(node, "destination");
  return destination ? [wordValue(destination)] : [];
}

/** Visit syntax-defined pipelines and executable children, never the contents of quoted examples. */
export function anyPipeline(command: string, predicate: (stages: string[]) => boolean): boolean {
  function visit(node: ShellNode, inPipeline = false): boolean {
    const body = node.type === "redirected_statement" ? field(node, "body") : undefined;
    if (body?.type === "pipeline") {
      const stages = named(body).filter((child) => child.type !== "comment");
      const texts = stages.map((stage, index) => index === stages.length - 1
        ? node.text.slice(stage.start - node.start) : stage.text);
      return predicate(texts) || stages.some((stage) => visit(stage, true))
        || fields(node, "redirect").some((redirect) => visit(redirect, true));
    }
    if (node.type === "pipeline") {
      const stages = named(node).filter((child) => child.type !== "comment");
      return predicate(stages.map((stage) => stage.text)) || stages.some((stage) => visit(stage, true));
    }
    if (["command", "redirected_statement", "variable_assignment"].includes(node.type)) {
      if (!inPipeline && predicate([node.text])) return true;
      return named(node).some((child) => visit(child, true));
    }
    return named(node).some((child) => visit(child));
  }
  return visit(parseShell(command));
}

export function executableSubstitutions(node: ShellNode): ShellNode[] {
  return [...descendants(node, "command_substitution"), ...descendants(node, "process_substitution")];
}
