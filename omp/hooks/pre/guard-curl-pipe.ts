// guard-curl-pipe.ts
//
// Pre-hook: blocks remote download → interpreter pipelines. Replaces the
// deleted rules/no-curl-pipe-interpreter.md, broader via structured
// pipe-splitting and process-substitution detection. Catches:
//
//   curl URL | bash                     (direct pipe)
//   curl URL | tee /tmp/x | bash        (tee interposer)
//   bash <(curl URL)                    (process substitution)
//   wget URL | sh                       (wget variant)
//
// See docs/adr/0006 for why this lives as a hook rather than a TTSR rule.

import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

const INTERPRETERS = new Set([
  "bash", "sh", "zsh", "ksh", "fish", "dash",
  "python", "python3", "node", "deno", "bun",
  "ruby", "perl", "sudo",
]);

// Returns the first non-env-var word of a segment. Skips leading env-var
// assignments like `FOO=bar BAZ=qux cmd` or `http_proxy=… curl …` (case-
// insensitive — bash convention is uppercase but lowercase is valid syntax
// and commonly used for HTTP proxy vars).
function leadingWord(segment: string): string {
  const trimmed = segment.trim();
  if (!trimmed) return "";
  for (const part of trimmed.split(/\s+/)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(part)) continue;
    return part;
  }
  return "";
}

function isCurlOrWget(segment: string): boolean {
  const w = leadingWord(segment);
  return w === "curl" || w === "wget";
}

function isInterpreter(segment: string): boolean {
  return INTERPRETERS.has(leadingWord(segment));
}

// Splits on `|` that's not inside parens, quotes, or backticks. Treats `||`
// (logical OR) as not-a-pipe.
function splitOnPipe(cmd: string): string[] {
  const segments: string[] = [];
  let current = "";
  let parens = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (inSingle) {
      if (c === "'") inSingle = false;
      current += c;
      continue;
    }
    if (inDouble) {
      if (c === '"') inDouble = false;
      current += c;
      continue;
    }
    if (inBacktick) {
      if (c === "`") inBacktick = false;
      current += c;
      continue;
    }
    if (c === "'") { inSingle = true; current += c; continue; }
    if (c === '"') { inDouble = true; current += c; continue; }
    if (c === "`") { inBacktick = true; current += c; continue; }
    if (c === "(") { parens++; current += c; continue; }
    if (c === ")") { parens--; current += c; continue; }
    if (c === "|" && parens === 0 && cmd[i + 1] !== "|") {
      segments.push(current);
      current = "";
      // Also consume the `&` of bash's `|&` (pipe stdout+stderr).
      if (cmd[i + 1] === "&") i++;
      continue;
    }
    current += c;
  }
  if (current) segments.push(current);
  return segments;
}

// Direct or tee-interposed pipe: any downstream segment after a curl/wget
// segment is an interpreter.
function isPipeToInterpreter(cmd: string): boolean {
  const segments = splitOnPipe(cmd);
  for (let i = 0; i < segments.length; i++) {
    if (!isCurlOrWget(segments[i])) continue;
    for (let j = i + 1; j < segments.length; j++) {
      if (isInterpreter(segments[j])) return true;
    }
  }
  return false;
}

// Process substitution: <interpreter> <(curl URL)
function isProcSubstInterpreter(cmd: string): boolean {
  if (!isInterpreter(cmd)) return false;
  const procSub = /<\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = procSub.exec(cmd)) !== null) {
    if (isCurlOrWget(m[1])) return true;
  }
  return false;
}

function isDangerous(cmd: string): boolean {
  if (isPipeToInterpreter(cmd)) return true;
  if (isProcSubstInterpreter(cmd)) return true;
  // Recurse into substitutions in case the dangerous shape is nested
  const procSub = /[<>]\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
  const cmdSub = /\$\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
  const backtick = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = procSub.exec(cmd)) !== null) if (isDangerous(m[1])) return true;
  while ((m = cmdSub.exec(cmd)) !== null) if (isDangerous(m[1])) return true;
  while ((m = backtick.exec(cmd)) !== null) if (isDangerous(m[1])) return true;
  return false;
}

export default function (pi: HookAPI): void {
  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash") return;
    const cmd = String(event.input.command ?? "");
    if (isDangerous(cmd)) {
      return {
        block: true,
        reason: `Refused — curl/wget piped to interpreter: ${cmd.slice(0, 80)}${cmd.length > 80 ? "…" : ""}`,
      };
    }
  });
}
