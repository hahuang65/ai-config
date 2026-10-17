import { anyInvocation } from "./command-invocations";
import { redirects, wordValue } from "./bash-command";
import { fields } from "./shell-parser";
import type { ToolCall } from "./guard-core";

// High-confidence credential formats; placeholder strings do not match.
const SECRET_LITERAL_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bgh[pousra]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/,
];

export function detectHardcodedSecret(call: ToolCall): string | null {
  const content = call.content;
  if (content && SECRET_LITERAL_PATTERNS.some((p) => p.test(content))) {
    return "Refused — hardcoded secret literal in written content. Use an environment variable or a secrets manager; never commit a key. If one was staged, rotate it.";
  }
  return null;
}

const CREDENTIAL_PATTERNS: RegExp[] = [
  /\.aws\/credentials/,
  /\.kube\/config/,
  /\.ssh\/id_[A-Za-z0-9]+/,
  /\.netrc(\b|$)/,
  /\.pgpass(\b|$)/,
  /\.npmrc(\b|$)/,
  /\.secrets([./]|$)/,
  /(^|[\\/\\"'])credentials(\.|$|[\\/\\"'])/,
];

function isCredentialPath(path: string): boolean {
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(path));
}

const CREDENTIAL_READERS = new Set([
  "cat", "awk", "grep", "sed", "head", "tail", "less", "more", "tac", "nl", "od",
  "strings", "xxd", "hexdump", "vim", "vi", "nano", "emacs", "cp", "mv", "rsync", "scp",
]);

function readsCredentialFile(tokens: string[]): boolean {
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
  if (i >= tokens.length || !CREDENTIAL_READERS.has(tokens[i])) return false;
  for (let j = i + 1; j < tokens.length; j++) {
    const token = tokens[j];
    if (token.startsWith("-") && token !== "--") continue;
    if (isCredentialPath(token)) return true;
  }
  return false;
}

export function detectSecretAccess(call: ToolCall): string | null {
  if (call.path && isCredentialPath(call.path)) {
    return `Refused — credential file read: ${call.path.slice(0, 80)}`;
  }
  if (call.command && anyInvocation(call.command, (words, stage) => readsCredentialFile(words)
    || redirects(stage).some((redirect) => fields(redirect, "destination").some((destination) => isCredentialPath(wordValue(destination)))))) {
    const command = call.command;
    return `Refused — bash command reads a credential file: ${command.length > 80 ? `${command.slice(0, 80)}…` : command}`;
  }
  return null;
}
