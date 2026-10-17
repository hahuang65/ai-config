import { anyPipeline, inputRedirects, wordValue } from "./bash-command";
import { invocation } from "./command-invocations";
import { named } from "./shell-parser";
import { evaluationProgram, readsProgramFromStdin } from "./interpreter-input";

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

export function inlineProgramSource(stage: string): string | null {
  const [executable, ...args] = invocation(stage);
  if (!isSupportedInterpreter(executable)) return null;
  const flagged = evaluationProgram([executable, ...args]);
  if (flagged !== null) return flagged;
  if (!readsProgramFromStdin([executable, ...args])) return null;
  for (const redirect of inputRedirects(stage).slice(-1)) {
    const body = named(redirect).find((node) => node.type === "heredoc_body");
    if (redirect.type === "heredoc_redirect" && body) return body.text;
    if (redirect.type === "herestring_redirect") {
      const value = named(redirect).find((node) => node.type !== "file_descriptor");
      if (value) return wordValue(value);
    }
  }
  return null;
}

function pipedProgramSource(stages: string[], interpreterIndex: number): string | null {
  if (interpreterIndex === 0) return null;
  const [executable, ...args] = invocation(stages[interpreterIndex]);
  if (!isSupportedInterpreter(executable) || !readsProgramFromStdin([executable, ...args])
    || inputRedirects(stages[interpreterIndex]).length) return null;
  const [producer, ...input] = invocation(stages[interpreterIndex - 1]);
  if (!SHELL_INPUT_PRODUCERS.has(producer)) return null;
  return input.filter((token) => !token.startsWith("-")).join(" ");
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
