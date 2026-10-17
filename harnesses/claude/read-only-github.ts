import { commandWords, literalWord } from "../../guard/bash-command";
import { named, parseShell } from "../../guard/shell-parser";

const READ_ONLY_METHODS = new Set(["GET", "HEAD"]);
// Field options make `gh api` default to POST unless the method is explicit.
const FIELD_OPTION = /^(?:-f|-F|--field|--raw-field)(?:=|$)/;
// Typed fields and --input can read local files, so they still require review.
const FILE_FIELD_OPTION = /^(?:-F|--field)(?:=|$)/;
const INPUT_OPTION = /^--input(?:=|$)/;

export function isReadOnlyGitHubCommand(command: string): boolean {
  try {
    const statements = named(parseShell(command)).filter((node) => node.type !== "comment");
    if (statements.length !== 1 || statements[0].type !== "command") return false;
    if (statements[0].children.some((node) => node.field === "redirect" || node.type === "variable_assignment")) return false;
    const values = commandWords(statements[0]).map(literalWord);
    if (values.some((value) => value === null)) return false;
    const tokens = values as string[];
    if (tokens[0] !== "gh") return false;
    if (tokens[1] === "pr") return tokens[2] === "view";
    return tokens[1] === "api" && ghApiIsReadOnly(tokens.slice(2));
  } catch { return false; }
}

function ghApiIsReadOnly(args: string[]): boolean {
  if (args.some((token) => INPUT_OPTION.test(token) || FILE_FIELD_OPTION.test(token))) return false;
  const methods = apiMethods(args);
  if (!methods) return false;
  const hasFields = args.some((token) => FIELD_OPTION.test(token));
  const effectiveMethod = methods.at(-1) ?? (hasFields ? "POST" : "GET");
  return READ_ONLY_METHODS.has(effectiveMethod);
}

function apiMethods(args: string[]): string[] | null {
  const methods: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "-X" || token === "--method") {
      const value = args[index + 1];
      if (!value) return null;
      methods.push(value.toUpperCase());
      index += 1;
    } else if (token.startsWith("-X") && token.length > 2) {
      methods.push(token.slice(2).toUpperCase());
    } else if (token.startsWith("--method=")) {
      const value = token.slice("--method=".length);
      if (!value) return null;
      methods.push(value.toUpperCase());
    }
  }
  return methods;
}
