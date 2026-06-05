// guard-core.ts
//
// The shared guard core (ADR-0011): detection logic for every guardrail
// policy, written ONCE and imported unchanged by every harness whose hook API
// can run it. Harnesses route a normalized tool call through `evaluate`; the
// core returns a block verdict or null (allow).
//
// Command detectors are predicates over `anyPipeline` (see bash-command.ts) —
// the statement/pipe/substitution traversal lives there, not here.

import { POLICIES } from "./policy-registry";
import { anyPipeline, tokenize, leadingWord } from "./bash-command";

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

function truncate(s: string, max = 80): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
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

function readsCredentialFile(tokens: string[]): boolean {
  let i = 0;
  // Skip leading env-var assignments (lowercase is valid: http_proxy=…).
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
  if (i >= tokens.length || !CREDENTIAL_READERS.has(tokens[i])) return false;
  for (let j = i + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.startsWith("-") && t !== "--") continue;
    if (isCredentialPath(t)) return true;
  }
  return false;
}

function detectSecretAccess(call: ToolCall): string | null {
  if (call.path && isCredentialPath(call.path)) {
    return `Refused — credential file read: ${call.path.slice(0, 80)}`;
  }
  if (call.command && anyPipeline(call.command, (stages) => stages.some((s) => readsCredentialFile(tokenize(s))))) {
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

function isForcePush(tokens: string[]): boolean {
  const gitIdx = tokens.findIndex((t) => t === "git" || t.endsWith("/git"));
  if (gitIdx === -1) return false;
  if (!tokens.slice(gitIdx + 1).includes("push")) return false;
  return tokens.some(isForceFlag);
}

function detectForcePush(call: ToolCall): string | null {
  if (call.command && anyPipeline(call.command, (stages) => stages.some((s) => isForcePush(tokenize(s))))) {
    return `Refused — force push rewrites shared history: ${truncate(call.command)}`;
  }
  return null;
}

// ── no-curl-pipe-shell ───────────────────────────────────────────────────

const INTERPRETERS = new Set([
  "bash", "sh", "zsh", "ksh", "fish", "dash",
  "python", "python3", "node", "deno", "bun",
  "ruby", "perl", "sudo",
]);

const isCurlOrWget = (stage: string): boolean => ["curl", "wget"].includes(leadingWord(stage));
const isInterpreter = (stage: string): boolean => INTERPRETERS.has(leadingWord(stage));

/** A curl/wget stage with an interpreter stage downstream in the same pipeline. */
function curlPipedToInterpreter(stages: string[]): boolean {
  for (let i = 0; i < stages.length; i++) {
    if (!isCurlOrWget(stages[i])) continue;
    for (let j = i + 1; j < stages.length; j++) {
      if (isInterpreter(stages[j])) return true;
    }
  }
  return false;
}

/** An interpreter stage that process-substitutes a curl/wget: `bash <(curl …)`. */
function interpreterProcessSubstitutesCurl(stage: string): boolean {
  if (!isInterpreter(stage)) return false;
  const procSub = /<\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = procSub.exec(stage)) !== null) {
    if (isCurlOrWget(m[1])) return true;
  }
  return false;
}

function detectCurlPipeShell(call: ToolCall): string | null {
  if (
    call.command &&
    anyPipeline(call.command, (stages) => curlPipedToInterpreter(stages) || stages.some(interpreterProcessSubstitutesCurl))
  ) {
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

function detectBroadRm(call: ToolCall): string | null {
  if (
    call.command &&
    anyPipeline(call.command, (stages) =>
      stages.some((s) => {
        const tokens = tokenize(s);
        return rmHitsBroadTarget(tokens) || findDeletesBroadTarget(tokens);
      }),
    )
  ) {
    return `Refused — recursive delete against a broad target: ${truncate(call.command)}`;
  }
  return null;
}

// ── no-sudo ──────────────────────────────────────────────────────────────

// `\bsudo\s` — sudo as a word followed by whitespace (the invocation shape).
// A regex over the whole command inherently covers wrappers and nesting.
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
