// guard-rm.ts
//
// Pre-hook: blocks `rm -rf` and `find … -delete` / `find … -exec rm …`
// against broad targets (/, ~, $HOME, *, ., ..). Catches what the prior
// TTSR rule (rules/no-rm-rf-root.md, deleted) missed via structured argv
// parsing — process substitution and command substitution recurse into
// their inner commands. See docs/adr/0006 for the migration rationale.

import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

// Targets we consider "broad" for rm -rf / find -delete purposes.
// `.` and `..` are deliberately omitted — `find . -name "*.pyc" -delete`
// is a common, safe cleanup pattern and shouldn't be blocked.
const BROAD_TARGETS = new Set([
  "/", "~", "*",
  "$HOME", "${HOME}",
  "~/", "$HOME/", "${HOME}/",
]);

function isBroadTarget(token: string): boolean {
  // Normalize trailing slashes: `rm -rf ~/` is equivalent to `rm -rf ~`.
  const normalized = token.replace(/\/+$/, "");
  return BROAD_TARGETS.has(token) || BROAD_TARGETS.has(normalized);
}

// Naive whitespace tokenizer that preserves single- and double-quoted
// strings as single tokens. Sufficient for safety checks — the model is
// unlikely to obfuscate destructive intent with creative quoting.
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
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += c;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

// Extract the inner commands from process substitution `<(…)` / `>(…)`,
// command substitution `$(…)`, and backticks. Returns the inner command
// strings so the caller can recurse.
function extractSubstitutions(cmd: string): string[] {
  const subs: string[] = [];
  const procSub = /[<>]\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
  const cmdSub = /\$\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
  const backtick = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = procSub.exec(cmd)) !== null) subs.push(m[1]);
  while ((m = cmdSub.exec(cmd)) !== null) subs.push(m[1]);
  while ((m = backtick.exec(cmd)) !== null) subs.push(m[1]);
  return subs;
}

function isDangerousRm(tokens: string[]): boolean {
  const rmIdx = tokens.indexOf("rm");
  if (rmIdx === -1) return false;
  for (let i = rmIdx + 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith("-")) continue;  // also matches "--"
    if (isBroadTarget(t)) return true;
  }
  return false;
}

function isDangerousFind(tokens: string[]): boolean {
  const findIdx = tokens.indexOf("find");
  if (findIdx === -1) return false;
  let pathIdx = findIdx + 1;
  while (pathIdx < tokens.length && tokens[pathIdx].startsWith("-")) pathIdx++;
  if (pathIdx >= tokens.length) return false;
  if (!isBroadTarget(tokens[pathIdx])) return false;
  for (let i = findIdx; i < tokens.length; i++) {
    if (tokens[i] === "-delete") return true;
    if (tokens[i] === "-exec" && i + 1 < tokens.length && tokens[i + 1] === "rm") return true;
  }
  return false;
}

function isDangerous(cmd: string): boolean {
  const tokens = tokenize(cmd);
  if (isDangerousRm(tokens)) return true;
  if (isDangerousFind(tokens)) return true;
  for (const sub of extractSubstitutions(cmd)) {
    if (isDangerous(sub)) return true;
  }
  return false;
}

export default function (pi: HookAPI): void {
  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash") return;
    const cmd = String(event.input.command ?? "");
    if (isDangerous(cmd)) {
      return {
        block: true,
        reason: `Refused — broad rm/find detected: ${cmd.slice(0, 80)}${cmd.length > 80 ? "…" : ""}`,
      };
    }
  });
}
