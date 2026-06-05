// guard-core.ts
//
// The shared guard core (ADR-0011): detection logic for every guardrail
// policy, written ONCE and imported unchanged by every harness whose hook API
// can run it. Harnesses route a normalized tool call through `evaluate`; the
// core returns a block verdict or null (allow). This consolidates logic that
// previously lived duplicated across the per-harness hooks.

import { POLICIES } from "./policy-registry";

/** Harness-neutral shape every adapter normalizes its tool call into. */
export interface ToolCall {
  /** Canonical tool name, e.g. "read", "edit", "write", "bash". */
  tool: string;
  /** The command string, for command-running tools. */
  command?: string;
  /** The target path, for file tools. */
  path?: string;
}

/** A refusal: which policy fired and why. */
export interface Verdict {
  policy: string;
  reason: string;
}

/** Returns a refusal reason for the given call, or null to allow. */
type Detector = (call: ToolCall) => string | null;

// ── shared shell-parsing helpers ─────────────────────────────────────────

function truncate(s: string, max = 80): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Quote-aware word split of a single command segment. */
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

/** Split a command on `|`, `;`, `&&`, `||` outside quotes/parens. */
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

/** Inner contents of process/command substitutions and backticks. */
function extractSubstitutions(cmd: string): string[] {
  const found: string[] = [];
  const patterns = [
    /[<>]\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g, // <(…) >(…)
    /\$\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g,    // $(…)
    /`([^`]+)`/g,                               // `…`
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(cmd)) !== null) found.push(m[1]);
  }
  return found;
}

// ── no-secret-access ─────────────────────────────────────────────────────

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

function isCredentialPath(path: string): boolean {
  return CREDENTIAL_PATTERNS.some((p) => p.test(path));
}

const CREDENTIAL_READERS = new Set([
  "cat", "awk", "grep", "sed", "head", "tail",
  "less", "more", "tac", "nl", "od",
  "strings", "xxd", "hexdump",
  "vim", "vi", "nano", "emacs",
  "cp", "mv", "rsync", "scp",
]);

function bashCommandReadsCredentials(cmd: string): boolean {
  for (const segment of splitOnSeparators(cmd)) {
    const tokens = tokenize(segment);
    let cmdIdx = 0;
    // Skip leading env-var assignments (lowercase is valid: http_proxy=…).
    while (cmdIdx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[cmdIdx])) cmdIdx++;
    if (cmdIdx >= tokens.length) continue;
    if (!CREDENTIAL_READERS.has(tokens[cmdIdx])) continue;
    for (let i = cmdIdx + 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.startsWith("-") && t !== "--") continue;
      if (isCredentialPath(t)) return true;
    }
  }
  // Recurse into substitutions, e.g. `diff <(cat ~/.aws/credentials) …`.
  for (const inner of extractSubstitutions(cmd)) {
    if (bashCommandReadsCredentials(inner)) return true;
  }
  return false;
}

function detectSecretAccess(call: ToolCall): string | null {
  if (call.path && isCredentialPath(call.path)) {
    return `Refused — credential file read: ${call.path.slice(0, 80)}`;
  }
  if (call.command && bashCommandReadsCredentials(call.command)) {
    return `Refused — bash command reads a credential file: ${truncate(call.command)}`;
  }
  return null;
}

// ── no-force-push ────────────────────────────────────────────────────────

function isForceFlag(token: string): boolean {
  // --force, --force-with-lease[=ref], -f, and merged short clusters (-fv, -vf).
  return (
    token === "--force" ||
    token.startsWith("--force-with-lease") ||
    /^-[a-zA-Z]*f[a-zA-Z]*$/.test(token)
  );
}

function detectForcePush(call: ToolCall): string | null {
  if (!call.command) return null;
  for (const segment of splitOnSeparators(call.command)) {
    const tokens = tokenize(segment);
    const gitIdx = tokens.findIndex((t) => t === "git" || t.endsWith("/git"));
    if (gitIdx === -1) continue;
    if (!tokens.slice(gitIdx + 1).includes("push")) continue;
    if (tokens.some(isForceFlag)) {
      return `Refused — force push rewrites shared history: ${truncate(segment.trim())}`;
    }
  }
  return null;
}

// ── no-curl-pipe-shell ───────────────────────────────────────────────────

const INTERPRETERS = new Set([
  "bash", "sh", "zsh", "ksh", "fish", "dash",
  "python", "python3", "node", "deno", "bun",
  "ruby", "perl", "sudo",
]);

/** First non-env-assignment word of a segment. */
function leadingWord(segment: string): string {
  for (const token of tokenize(segment)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
    return token;
  }
  return "";
}

const isCurlOrWget = (segment: string): boolean => ["curl", "wget"].includes(leadingWord(segment));
const isInterpreter = (segment: string): boolean => INTERPRETERS.has(leadingWord(segment));

/** Split on a single `|` outside quotes/parens; `||` is not a pipe. */
function splitOnPipe(cmd: string): string[] {
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
    if (c === "|" && parens === 0 && cmd[i + 1] !== "|") {
      segments.push(current);
      current = "";
      if (cmd[i + 1] === "&") i++; // bash's `|&`
      continue;
    }
    current += c;
  }
  if (current) segments.push(current);
  return segments;
}

function curlPipesToInterpreter(cmd: string): boolean {
  const segments = splitOnPipe(cmd);
  for (let i = 0; i < segments.length; i++) {
    if (!isCurlOrWget(segments[i])) continue;
    for (let j = i + 1; j < segments.length; j++) {
      if (isInterpreter(segments[j])) return true;
    }
  }
  return false;
}

function interpreterProcessSubstitutesCurl(cmd: string): boolean {
  if (!isInterpreter(cmd)) return false;
  const procSub = /<\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = procSub.exec(cmd)) !== null) {
    if (isCurlOrWget(m[1])) return true;
  }
  return false;
}

function isCurlPipeShell(cmd: string): boolean {
  if (curlPipesToInterpreter(cmd)) return true;
  if (interpreterProcessSubstitutesCurl(cmd)) return true;
  for (const inner of extractSubstitutions(cmd)) {
    if (isCurlPipeShell(inner)) return true;
  }
  return false;
}

function detectCurlPipeShell(call: ToolCall): string | null {
  if (call.command && isCurlPipeShell(call.command)) {
    return `Refused — remote download piped to an interpreter: ${truncate(call.command)}`;
  }
  return null;
}

// ── no-broad-rm ──────────────────────────────────────────────────────────

// `.` and `..` are deliberately omitted — `find . -name "*.pyc" -delete` is a
// common, safe cleanup pattern that should not be blocked.
const BROAD_TARGETS = new Set([
  "/", "~", "*",
  "$HOME", "${HOME}",
  "~/", "$HOME/", "${HOME}/",
]);

function isBroadTarget(token: string): boolean {
  const normalized = token.replace(/\/+$/, "");
  return BROAD_TARGETS.has(token) || BROAD_TARGETS.has(normalized);
}

function rmHitsBroadTarget(tokens: string[]): boolean {
  const rmIdx = tokens.indexOf("rm");
  if (rmIdx === -1) return false;
  for (let i = rmIdx + 1; i < tokens.length; i++) {
    if (tokens[i].startsWith("-")) continue;
    if (isBroadTarget(tokens[i])) return true;
  }
  return false;
}

// find global options that take a value, which can precede the path.
const FIND_VALUE_FLAGS = new Set(["-maxdepth", "-mindepth"]);

function findDeletesBroadTarget(tokens: string[]): boolean {
  const findIdx = tokens.indexOf("find");
  if (findIdx === -1) return false;
  let pathIdx = findIdx + 1;
  while (pathIdx < tokens.length && tokens[pathIdx].startsWith("-")) {
    if (FIND_VALUE_FLAGS.has(tokens[pathIdx])) pathIdx++; // also skip the flag's value
    pathIdx++;
  }
  if (pathIdx >= tokens.length || !isBroadTarget(tokens[pathIdx])) return false;
  for (let i = findIdx; i < tokens.length; i++) {
    if (tokens[i] === "-delete") return true;
    if (tokens[i] === "-exec" && tokens[i + 1] === "rm") return true;
  }
  return false;
}

function isBroadRm(cmd: string): boolean {
  // Split on separators first so a no-space chain (echo;rm -rf ~) is caught.
  for (const segment of splitOnSeparators(cmd)) {
    const tokens = tokenize(segment);
    if (rmHitsBroadTarget(tokens)) return true;
    if (findDeletesBroadTarget(tokens)) return true;
  }
  for (const inner of extractSubstitutions(cmd)) {
    if (isBroadRm(inner)) return true;
  }
  return false;
}

function detectBroadRm(call: ToolCall): string | null {
  if (call.command && isBroadRm(call.command)) {
    return `Refused — recursive delete against a broad target: ${truncate(call.command)}`;
  }
  return null;
}

// ── no-sudo ──────────────────────────────────────────────────────────────

// `\bsudo\s` — sudo as a word followed by whitespace (the invocation shape).
// Catches wrapper variants (process subst, find -exec, python -c "…") because
// they all contain the literal "sudo " substring; excludes "sudoers", a bare
// path, and prose without a following space.
const SUDO_PATTERN = /\bsudo\s/;

function detectSudo(call: ToolCall): string | null {
  if (call.command && SUDO_PATTERN.test(call.command)) {
    return `Refused — sudo privilege escalation: ${truncate(call.command)}`;
  }
  return null;
}

// ── registry → detector wiring ───────────────────────────────────────────

const DETECTORS: Record<string, Detector> = {
  "no-secret-access": detectSecretAccess,
  "no-force-push": detectForcePush,
  "no-curl-pipe-shell": detectCurlPipeShell,
  "no-broad-rm": detectBroadRm,
  "no-sudo": detectSudo,
};

export function evaluate(call: ToolCall): Verdict | null {
  for (const policy of POLICIES) {
    const detect = DETECTORS[policy.id];
    if (!detect) continue;
    const reason = detect(call);
    if (reason) return { policy: policy.id, reason };
  }
  return null;
}
