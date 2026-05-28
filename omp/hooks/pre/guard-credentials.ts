// guard-credentials.ts
//
// Pre-hook: blocks reads of credential files across read, edit, and bash
// tools with per-tool structured input checks. Replaces the deleted
// rules/no-credentials-read.md, which had a broad regex on stream text
// that over-fired on prose mentions of credential paths.
//
// Bypass-fix: this hook only triggers when an actual tool input parameter
// matches a credential path. A prose comment like "see ~/.aws/credentials
// for config" no longer fires — only an actual `read`/`edit` call with
// that path, or a `bash` call running cat/awk/grep/etc. against it.
//
// See docs/adr/0006 for migration rationale.

import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

const CREDENTIAL_PATTERNS: RegExp[] = [
  /\.aws\/credentials/,
  /\.kube\/config/,
  /\.ssh\/id_[A-Za-z0-9]+/,
  /\.netrc(\b|$)/,
  /\.pgpass(\b|$)/,
  /\.npmrc(\b|$)/,
  /\.secrets([./]|$)/,
  /(^|[/\\"'])credentials(\.|$|[/\\"'])/,
];

const CREDENTIAL_READERS = new Set([
  "cat", "awk", "grep", "sed", "head", "tail",
  "less", "more", "tac", "nl", "od",
  "strings", "xxd", "hexdump",
  "vim", "vi", "nano", "emacs",
  "cp", "mv", "rsync", "scp",
]);

function isCredentialPath(path: string): boolean {
  return CREDENTIAL_PATTERNS.some(p => p.test(path));
}

// Tokenize with quote awareness — same shape as guard-rm.ts.
function tokenize(cmd: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  for (const c of cmd) {
    if (inSingle) {
      if (c === "'") inSingle = false;
      else current += c;
    } else if (inDouble) {
      if (c === '"') inDouble = false;
      else current += c;
    } else if (c === "'") {
      inSingle = true;
    } else if (c === '"') {
      inDouble = true;
    } else if (/\s/.test(c)) {
      if (current) { tokens.push(current); current = ""; }
    } else {
      current += c;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

// Split on `|` and `;` and `&&` and `||` — any of these separates one
// command from another. We want to inspect each independent command.
function splitOnSeparators(cmd: string): string[] {
  const segments: string[] = [];
  let current = "";
  let parens = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (inSingle) { if (c === "'") inSingle = false; current += c; continue; }
    if (inDouble) { if (c === '"') inDouble = false; current += c; continue; }
    if (inBacktick) { if (c === "`") inBacktick = false; current += c; continue; }
    if (c === "'") { inSingle = true; current += c; continue; }
    if (c === '"') { inDouble = true; current += c; continue; }
    if (c === "`") { inBacktick = true; current += c; continue; }
    if (c === "(") { parens++; current += c; continue; }
    if (c === ")") { parens--; current += c; continue; }
    if (parens === 0 && (c === "|" || c === ";" || c === "&")) {
      // Eat doubled operators (||, &&) and the second char too
      if (cmd[i + 1] === c) i++;
      segments.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  if (current) segments.push(current);
  return segments;
}

function bashCommandReadsCredentials(cmd: string): boolean {
  const segments = splitOnSeparators(cmd);
  for (const segment of segments) {
    const tokens = tokenize(segment);
    // Find a credential-reader command at the start (after env-var assignments)
    let cmdIdx = 0;
    while (cmdIdx < tokens.length && /^[A-Z_][A-Z0-9_]*=/.test(tokens[cmdIdx])) cmdIdx++;
    if (cmdIdx >= tokens.length) continue;
    if (!CREDENTIAL_READERS.has(tokens[cmdIdx])) continue;
    // Any non-flag argument that matches a credential path triggers
    for (let i = cmdIdx + 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.startsWith("-") && t !== "--") continue;
      if (isCredentialPath(t)) return true;
    }
  }
  // Recurse into substitutions (e.g. `bash <(cat ~/.aws/credentials)`)
  const procSub = /[<>]\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
  const cmdSub = /\$\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
  const backtick = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = procSub.exec(cmd)) !== null) if (bashCommandReadsCredentials(m[1])) return true;
  while ((m = cmdSub.exec(cmd)) !== null) if (bashCommandReadsCredentials(m[1])) return true;
  while ((m = backtick.exec(cmd)) !== null) if (bashCommandReadsCredentials(m[1])) return true;
  return false;
}

export default function (pi: HookAPI): void {
  pi.on("tool_call", (event) => {
    if (event.toolName === "read" || event.toolName === "edit") {
      const path = String(event.input.path ?? "");
      if (path && isCredentialPath(path)) {
        return {
          block: true,
          reason: `Refused — credential file read: ${path.slice(0, 80)}`,
        };
      }
      return;
    }
    if (event.toolName === "bash") {
      const cmd = String(event.input.command ?? "");
      if (bashCommandReadsCredentials(cmd)) {
        return {
          block: true,
          reason: `Refused — bash command reads a credential file: ${cmd.slice(0, 80)}${cmd.length > 80 ? "…" : ""}`,
        };
      }
    }
  });
}
