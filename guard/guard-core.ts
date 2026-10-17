// Shared, harness-neutral policy decisions over syntax parsed by tree-sitter-bash.
import { POLICIES } from "./policy-registry";
import { anyInvocation } from "./command-invocations";
import { redirects, wordValue } from "./bash-command";
import { inlineProgramSource } from "./inline-program-state-guard";
import { detectRemoteExecution } from "./remote-execution-guard";
import { resolveGuardHome } from "./guard-home";
import { detectReviewPublicationCredentialAccess } from "./review-publication-state-guard";
import { detectHardcodedSecret, detectSecretAccess } from "./credential-guard";
import { detectDiskFormat, detectHostShutdown, detectUnsafeTermination } from "./dangerous-command-guard";
import { detectRecursiveDelete } from "./recursive-delete-guard";
import { fields, ShellSyntaxError, withShellAnalysis } from "./shell-parser";
import { detectShellWrite, detectSudo, detectCloudDestroy, detectDeploy, detectDbMutation, detectDdDisk, detectBroadChmod } from "./system-command-guards";

export { resolveGuardHome };

/** Every adapter normalizes tool inputs into this shape; parser state is never supplied by a caller. */
export interface ToolCall {
  tool: string;
  command?: string;
  path?: string;
  pattern?: string;
  content?: string;
  cwd?: string;
  home?: string;
}

export interface Verdict { policy: string; reason: string }
type Detector = (call: ToolCall) => string | null;

const STREAM_EDITORS = new Set(["sed", "awk", "gawk", "mawk", "nawk", "ed"]);
function detectHtmlTransform(call: ToolCall): string | null {
  const denied = anyInvocation(call.command, (words, stage) => {
    const [executable, ...args] = words;
    const paths = redirects(stage).flatMap((redirect) => fields(redirect, "destination").map(wordValue));
    const program = inlineProgramSource(stage);
    if (![...args, ...paths, program ?? ""].some((arg) => /\.html?\b/i.test(arg))) return false;
    if (STREAM_EDITORS.has(executable) || program !== null) return true;
    const flags = args.filter((arg) => arg.startsWith("-"));
    if (["perl", "ruby"].includes(executable)) return flags.some((flag) => /^-[a-zA-Z]*i/.test(flag));
    return executable === "deno" && flags.some((flag) => ["-e", "--eval", "-p", "--print"].includes(flag));
  });
  return denied ? "Refused — command-line text transformer aimed at HTML; use the read tool and exact edit-tool replacements." : null;
}

function isForceFlag(token: string): boolean {
  return token === "--force" || token.startsWith("--force-with-lease") || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(token);
}

function isGitDestructive([executable, ...args]: string[]): boolean {
  if (executable !== "git") return false;
  if (args.some((arg) => arg === "--no-verify" || arg === "--no-gpg-sign")) return true;
  let index = 0;
  while (args[index]?.startsWith("-")) {
    const option = args[index++];
    if (["-C", "-c", "--git-dir", "--work-tree", "--namespace"].includes(option)) index += 1;
  }
  const [command, ...flags] = args.slice(index);
  if (command === "push") return flags.some(isForceFlag);
  if (command === "reset") return flags.includes("--hard");
  if (command === "clean") return flags.some((flag) => /^-[a-z]*f/.test(flag) || flag === "--force");
  return command === "commit" && flags.includes("--amend") && flags.includes("--no-edit");
}

function detectGitDestructive(call: ToolCall): string | null {
  return anyInvocation(call.command, isGitDestructive)
    ? "Refused — destructive git command rewrites history or destroys work; make a new commit or hand it to the user." : null;
}

const BROAD_TARGETS = new Set(["/", "~", "*", "$HOME", "${HOME}"]);
function broadTarget(token: string): boolean {
  return BROAD_TARGETS.has(token === "/" ? token : token.replace(/\/+$/, ""));
}

function detectBroadRm(call: ToolCall): string | null {
  const denied = anyInvocation(call.command, ([executable, ...args]) => {
    if (executable === "rm") return args.some((arg) => !arg.startsWith("-") && broadTarget(arg));
    if (executable !== "find") return false;
    const paths: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
      if (["-maxdepth", "-mindepth"].includes(args[index])) { index += 1; continue; }
      if (args[index].startsWith("-")) continue;
      paths.push(args[index]);
      break;
    }
    return paths.some(broadTarget) && (args.includes("-delete") || args.includes("-exec") && args.includes("rm"));
  });
  return denied ? "Refused — deletion against a broad target; the user must run it manually." : null;
}

const DETECTORS: Record<string, Detector> = {
  "no-secret-access": detectSecretAccess,
  "no-review-publication-credential-access": detectReviewPublicationCredentialAccess,
  "no-hardcoded-secret": detectHardcodedSecret,
  "no-shell-write": detectShellWrite,
  "no-html-transform": detectHtmlTransform,
  "no-git-destructive": detectGitDestructive,
  "no-curl-pipe-shell": detectRemoteExecution,
  "no-broad-rm": detectBroadRm,
  "no-recursive-delete": detectRecursiveDelete,
  "no-sudo": detectSudo,
  "no-cloud-destroy": detectCloudDestroy,
  "no-deploy": detectDeploy,
  "no-db-mutation": detectDbMutation,
  "no-dd-disk": detectDdDisk,
  "no-disk-format": detectDiskFormat,
  "no-host-shutdown": detectHostShutdown,
  "no-unsafe-termination": detectUnsafeTermination,
  "no-broad-chmod": detectBroadChmod,
};

export function evaluate(call: ToolCall): Verdict | null {
  try { return withShellAnalysis(call.command, () => evaluatePolicies(call)); }
  catch (error) {
    return { policy: "no-uninspectable-shell", reason: error instanceof ShellSyntaxError
      ? `Refused — ${error.message}` : "Refused — Bash inspection failed; no command was authorized." };
  }
}

function evaluatePolicies(call: ToolCall): Verdict | null {
  // no-uninspectable-shell is enforced by the parser boundary above, before any policy runs.
  for (const policy of POLICIES) {
    const detect = DETECTORS[policy.id];
    if (!detect) continue;
    const reason = detect(call);
    if (reason) return { policy: policy.id, reason };
  }
  return null;
}
