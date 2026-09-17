import path from "node:path";

import { anyPipeline, tokenize } from "./bash-command";

const NODE_INTERPRETERS = new Set(["node", "bun"]);
const RUBY_PERL_INTERPRETERS = new Set(["ruby", "perl"]);
const FILESYSTEM_ACCESS = /\b(?:bun\s*\.\s*(?:file|write)|delete|file\s*\.\s*(?:delete|open|read|rename|unlink|write)|io\s*\.\s*(?:read|write)|open(?:sync)?|readfile(?:sync)?|read_text|remove(?:sync)?|rename(?:sync)?|rmdir(?:sync)?|rmtree|rm(?:sync)?|unlink(?:sync)?|writefile(?:sync)?|write_text)\b/i;
const PROTECTED_NAME = /(?:^|[^A-Za-z0-9_-])\.review-publication(?![A-Za-z0-9_-])|(?:^|[^A-Za-z0-9_-])review-publication-sessions(?![A-Za-z0-9_-])/i;
const SHELL_INPUT_PRODUCERS = new Set(["echo", "printf"]);

export function inlineProgramAccessesProtectedState(command: string): boolean {
  const directSource = inlineProgramSource(command);
  if (directSource !== null && sourceAccessesProtectedState(directSource)) return true;
  return anyPipeline(command, (stages) => stages.some((stage, index) => {
    const source = inlineProgramSource(stage) ?? pipedProgramSource(stages, index);
    return source !== null && sourceAccessesProtectedState(source);
  }));
}

function inlineProgramSource(stage: string): string | null {
  const tokens = tokenize(stage);
  const executableIndex = commandExecutableIndex(tokens);
  if (executableIndex < 0) return null;
  const executable = path.basename(tokens[executableIndex]);
  if (!isSupportedInterpreter(executable)) return null;
  const heredoc = heredocBody(stage);
  if (heredoc !== null) return heredoc;
  const hereString = /<<<\s*([\s\S]+)$/.exec(stage);
  if (hereString) return hereString[1];
  return flaggedProgram(executable, tokens.slice(executableIndex + 1));
}

function flaggedProgram(executable: string, args: string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const assignment = /^(?:--eval|--print|-c|-e|-p)=(.*)$/s.exec(argument);
    if (assignment && flagSupported(executable, argument.slice(0, argument.indexOf("=")))) return assignment[1];
    if (flagSupported(executable, argument)) return args[index + 1] ?? "";
    if (RUBY_PERL_INTERPRETERS.has(executable) && /^-[A-Za-z]*[eE][A-Za-z]*$/.test(argument)) {
      return args[index + 1] ?? "";
    }
    if (/^python\d*$/.test(executable) && argument.startsWith("-c") && argument.length > 2) {
      return argument.slice(2);
    }
  }
  return null;
}

function flagSupported(executable: string, flag: string): boolean {
  if (NODE_INTERPRETERS.has(executable)) return ["-e", "--eval", "-p", "--print"].includes(flag);
  if (/^python\d*$/.test(executable)) return flag === "-c";
  return RUBY_PERL_INTERPRETERS.has(executable) && ["-e", "-E"].includes(flag);
}

function pipedProgramSource(stages: string[], interpreterIndex: number): string | null {
  if (interpreterIndex === 0) return null;
  const interpreterTokens = tokenize(stages[interpreterIndex]);
  const executableIndex = commandExecutableIndex(interpreterTokens);
  if (executableIndex < 0 || !isSupportedInterpreter(path.basename(interpreterTokens[executableIndex]))) return null;
  const args = interpreterTokens.slice(executableIndex + 1);
  if (args.length > 0 && !args.includes("-")) return null;
  const producerTokens = tokenize(stages[interpreterIndex - 1]);
  const producerIndex = commandExecutableIndex(producerTokens);
  if (producerIndex < 0 || !SHELL_INPUT_PRODUCERS.has(path.basename(producerTokens[producerIndex]))) return null;
  return producerTokens.slice(producerIndex + 1).filter((token) => !token.startsWith("-")).join(" ");
}

function heredocBody(stage: string): string | null {
  const marker = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n/.exec(stage);
  if (!marker) return null;
  const bodyStart = marker.index + marker[0].length;
  const terminator = new RegExp(`(?:^|\\n)${escapeExpression(marker[2])}(?:\\n|$)`).exec(stage.slice(bodyStart));
  return terminator ? stage.slice(bodyStart, bodyStart + terminator.index) : stage.slice(bodyStart);
}

function sourceAccessesProtectedState(source: string): boolean {
  if (!FILESYSTEM_ACCESS.test(source)) return false;
  return sourceRepresentations(source).some((representation) => PROTECTED_NAME.test(representation));
}

function sourceRepresentations(source: string): string[] {
  const decoded = decodeOrdinaryEscapes(source)
    .replace(/(['"])\s*(?:\+|\.)\s*(['"])/g, "")
    .replace(/(['"])\s+(['"])/g, "");
  const representations = [decoded];
  const encodedLiterals = [...source.matchAll(/(['"])([A-Fa-f0-9]{16,}|[A-Za-z0-9+/]{16,}={0,2})\1/g)];
  for (const match of encodedLiterals) {
    const context = source.slice(Math.max(0, match.index! - 80), match.index! + match[0].length + 80);
    const encoding = /(?:fromhex|['"]hex['"])/i.test(context) ? "hex"
      : /(?:atob|base64|b64decode)/i.test(context) ? "base64"
        : null;
    if (!encoding) continue;
    try {
      representations.push(Buffer.from(match[2], encoding).toString("utf8"));
    } catch {}
  }
  return representations;
}

function decodeOrdinaryEscapes(source: string): string {
  return source
    .replace(/\\u\{([0-9a-f]{1,6})\}/gi, (_match, value) => safeCodePoint(value))
    .replace(/\\u([0-9a-f]{4})/gi, (_match, value) => safeCodePoint(value))
    .replace(/\\x([0-9a-f]{2})/gi, (_match, value) => safeCodePoint(value))
    .replace(/%([0-9a-f]{2})/gi, (_match, value) => safeCodePoint(value));
}

function safeCodePoint(value: string): string {
  const codePoint = Number.parseInt(value, 16);
  return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : "";
}

function isSupportedInterpreter(executable: string): boolean {
  return NODE_INTERPRETERS.has(executable)
    || RUBY_PERL_INTERPRETERS.has(executable)
    || /^python\d*$/.test(executable);
}

function commandExecutableIndex(tokens: string[]): number {
  let index = tokens.findIndex((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token));
  while (index >= 0 && ["command", "env"].includes(path.basename(tokens[index]))) {
    index += 1;
    while (index < tokens.length && (tokens[index].startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index]))) index += 1;
    if (index >= tokens.length) return -1;
  }
  return index;
}

function escapeExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
