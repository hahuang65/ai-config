import { literalWord } from "./bash-command";
import { named, type ShellNode } from "./shell-parser";

/** Resolve only syntax-proven literals and explicitly supplied variables, never execute expansion. */
export function staticShellValue(node: ShellNode, variables: Readonly<Record<string, string>>, tilde = true): string | null {
  if (node.type === "simple_expansion" || node.type === "expansion") {
    const children = named(node);
    if (children.length !== 1 || children[0].type !== "variable_name") return null;
    const name = children[0].text;
    if (node.text !== `$${name}` && node.text !== `\${${name}}`) return null;
    return variables[name] ?? null;
  }
  if (["string", "translated_string", "concatenation", "command_name"].includes(node.type)) {
    const parts = named(node).map((child, index) => staticShellValue(child, variables,
      tilde && index === 0 && node.type !== "string" && node.type !== "translated_string"));
    return parts.some((part) => part === null) ? null : parts.join("");
  }
  if (node.type === "word" && tilde && (node.text === "~" || node.text.startsWith("~/"))) {
    return variables.HOME ? variables.HOME + node.text.slice(1) : null;
  }
  return literalWord(node);
}
