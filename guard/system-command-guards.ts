import { anyInvocation, invocation, nestedCommand } from "./command-invocations";
import { anyPipeline, inputRedirects, literalWord, redirects, wordValue } from "./bash-command";
import { fields, named } from "./shell-parser";
import type { ToolCall } from "./guard-core";

function matches(call: ToolCall, predicate: (words: string[], stage: string) => boolean, reason: string): string | null {
  return anyInvocation(call.command, predicate) ? `Refused — ${reason}` : null;
}

const SHELL_WRITERS = new Set(["echo", "printf", "cat", "tee"]);
const SHELL_WRITE_REASON = "writing a file via shell redirection bypasses per-file approval. Use the write/edit tool instead.";

function fileOutput(stage: string): boolean {
  return redirects(stage).some((redirect) => redirect.type === "file_redirect"
    && redirect.children.some((child) => [">", ">>", ">|", "&>", "&>>"].includes(child.type))
    && fields(redirect, "destination").some((destination) => !deviceOutput(wordValue(destination))));
}

export function detectShellWrite(call: ToolCall): string | null {
  const groupedWrite = call.command && anyPipeline(call.command, (stages) => stages.some((stage) => {
    if (!fileOutput(stage)) return false;
    const nested = nestedCommand(stage, invocation(stage));
    return anyInvocation(nested, ([executable]) => SHELL_WRITERS.has(executable));
  }));
  if (groupedWrite) return `Refused — ${SHELL_WRITE_REASON}`;
  return matches(call, ([executable, ...args], stage) => {
    if (executable === "tee") return args.some((arg) => !arg.startsWith("-") && !deviceOutput(arg));
    return SHELL_WRITERS.has(executable) && fileOutput(stage);
  }, SHELL_WRITE_REASON);
}

function deviceOutput(path: string): boolean {
  return /^\/dev\/(?:null|stderr|stdout|fd)(?:\/|$)/.test(path);
}

export function detectSudo(call: ToolCall): string | null {
  return matches(call, ([executable]) => executable === "sudo", "sudo privilege escalation; the user must run it manually.");
}

export function detectCloudDestroy(call: ToolCall): string | null {
  return matches(call, ([executable, ...args]) => {
    if (executable === "aws") return /^(?:delete|terminate)-[a-z-]+$/.test(args[1] ?? "");
    if (executable === "terraform") return ["apply", "destroy"].includes(args.find((arg) => !arg.startsWith("-")) ?? "");
    if (executable === "gcloud") return args.includes("delete");
    return executable === "kubectl" && args[0] === "delete";
  }, "destroys shared infrastructure; hand the command to the user or produce a plan to review.");
}

export function detectDeploy(call: ToolCall): string | null {
  return matches(call, ([executable, ...args]) => {
    if (executable === "make") return /^(?:apply|deploy[a-z-]*|push-(?:to-prod|staging|live|release)[a-z-]*)$/.test(args[0] ?? "");
    if (executable === "npm") return args[0] === "run" && args[1] === "deploy";
    if (["yarn", "pnpm", "fly", "wrangler", "sls", "serverless"].includes(executable)) return args[0] === "deploy";
    if (executable === "cap") return args[1] === "deploy";
    if (executable === "vercel") return args[0] === "--prod" || args[0] === "deploy" && args.includes("--prod");
    if (executable === "kubectl") return args[0] === "apply";
    return executable === "helm" && ["install", "upgrade"].includes(args[0]);
  }, "changes a production/shared environment; the user should run the deploy.");
}

const DATABASES = new Set(["psql", "mysql", "mariadb", "sqlite", "sqlite3", "mongo", "mongosh", "redis-cli"]);
export function detectDbMutation(call: ToolCall): string | null {
  return matches(call, ([executable, ...args], stage) => {
    if (!DATABASES.has(executable)) return false;
    // SQL content classification is separate from Bash structure and executable selection.
    const input = inputRedirects(stage)[0];
    const body = input?.type === "heredoc_redirect" ? named(input).find((node) => node.type === "heredoc_body")
      : input?.type === "herestring_redirect" ? named(input).find((node) => node.field !== "descriptor") : undefined;
    const literal = body ? literalWord(body) : null;
    const programs = literal === null ? args : [...args, literal];
    if (programs.some((arg) => /\b(?:DROP|TRUNCATE|ALTER\s+TABLE|DELETE\s+FROM)\b/i.test(arg))) return true;
    if (!["mongo", "mongosh", "redis-cli"].includes(executable)
      && programs.some((arg) => /\bUPDATE\s+\w+\s+SET\b/i.test(arg))) return true;
    return ["psql", "mysql", "mariadb"].includes(executable) && inputRedirects(stage).some((redirect) =>
      redirect.type === "file_redirect" && redirect.children.some((child) => child.type === "<")
      && fields(redirect, "destination").some((destination) => wordValue(destination).endsWith(".sql")));
  }, "mutates shared database state via a CLI; use a migration tool or hand the statement to the user.");
}

export function detectDdDisk(call: ToolCall): string | null {
  return matches(call, ([executable, ...args]) => executable === "dd" && args.some((arg) => /^(?:if|of)=\/dev\//.test(arg)),
    "dd against a raw device can overwrite a disk irreversibly; the user must check the device and run it manually.");
}

const BROAD_CHMOD_TARGETS = new Set(["/", "~", "$HOME", "${HOME}", "/etc", "/usr", "/var", "/opt", "/Users", "/home", "*"]);
export function detectBroadChmod(call: ToolCall): string | null {
  return matches(call, ([executable, ...args]) => {
    if (executable !== "chmod") return false;
    let options = true, recursive = false;
    const operands: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (options && arg === "--") { options = false; continue; }
      if (options && arg === "--reference") { index += 1; continue; }
      if (options && arg.startsWith("--reference=")) continue;
      if (options && (/^-[^-]*R/.test(arg) || arg === "--recursive")) { recursive = true; continue; }
      if (options && arg.startsWith("-") && !/^-[rwxXstugo,+=-]+$/.test(arg)) continue;
      operands.push(arg);
    }
    // A mode cannot equal a broad pathname; do not discard the first target when the mode was -x or --reference.
    return recursive && operands.some((arg) => BROAD_CHMOD_TARGETS.has(arg === "/" ? arg : arg.replace(/\/+$/, "")));
  }, "recursive chmod against a broad target can damage the system; name the exact paths instead.");
}
