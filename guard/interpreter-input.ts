// Utility option semantics only; shell words are supplied by tree-sitter-bash.
import { descriptorPath } from "./bash-command";
export const SHELLS = new Set(["bash", "sh", "dash", "zsh", "ksh", "fish"]);
export const INTERPRETERS = new Set([...SHELLS, "python", "python3", "node", "deno", "bun", "ruby", "perl", "eval", "source", "."]);

// Required-value options from pinned Node 25.8.0, including their aliases.
// Eval/run select programs separately; optional inspector switches are not value-taking.
const NODE_VALUE_OPTIONS = new Set([
  "--allow-fs-read", "--allow-fs-write", "--build-sea", "--build-snapshot-config", "--conditions", "-C",
  "--cpu-prof-dir", "--cpu-prof-interval", "--cpu-prof-name", "--debug-port", "--diagnostic-dir",
  "--disable-proto", "--disable-warning", "--dns-result-order", "--env-file", "--env-file-if-exists",
  "--experimental-config-file", "--experimental-loader", "--experimental-sea-config", "--experimental-test-isolation",
  "--heap-prof-dir", "--heap-prof-interval", "--heap-prof-name", "--heapsnapshot-near-heap-limit", "--heapsnapshot-signal",
  "--icu-data-dir", "--import", "--input-type", "--inspect-port", "--inspect-publish-uid", "--loader", "--localstorage-file",
  "--max-http-header-size", "--max-old-space-size", "--max-old-space-size-percentage", "--max-semi-space-size",
  "--network-family-autoselection-attempt-timeout", "--openssl-config", "--redirect-warnings", "--report-dir",
  "--report-directory", "--report-filename", "--report-signal", "--require", "-r", "--secure-heap", "--secure-heap-min",
  "--security-revert", "--security-reverts", "--snapshot-blob", "--stack-trace-limit", "--test-concurrency",
  "--test-coverage-branches", "--test-coverage-exclude", "--test-coverage-functions", "--test-coverage-include",
  "--test-coverage-lines", "--test-global-setup", "--test-isolation", "--test-name-pattern", "--test-reporter",
  "--test-reporter-destination", "--test-rerun-failures", "--test-shard", "--test-skip-pattern", "--test-timeout",
  "--title", "--tls-cipher-list", "--tls-keylog", "--trace-event-categories", "--trace-event-file-pattern",
  "--trace-require-module", "--unhandled-rejections", "--use-largepages", "--v8-pool-size", "--watch-kill-signal", "--watch-path",
]);

export function optionTakesValue(executable: string, option: string): boolean {
  if (SHELLS.has(executable)) return ["-o", "+o", "-O", "+O", "--rcfile", "--init-file"].includes(option);
  if (executable.startsWith("python")) return ["-W", "-X"].includes(option);
  if (executable === "ruby" && option === "-C") return true;
  if (executable === "node") return NODE_VALUE_OPTIONS.has(option);
  return ["-r", "-I", "--require", "--import", "--loader", "--input-type"].includes(option);
}

function shellInput(words: string[]) {
  let command = false, stdin = false, noexec = false, interactive = false;
  let index = 1;
  for (; index < words.length; index += 1) {
    const word = words[index];
    if (word === "--" || word === "-") { index += 1; break; }
    if (!/^[-+]/.test(word)) break;
    const enable = word.startsWith("-");
    if (optionTakesValue(words[0], word)) {
      if (["-o", "+o"].includes(word) && words[index + 1] === "noexec") noexec = enable;
      index += 1;
      continue;
    }
    if (!/^[-+][a-zA-Z]+$/.test(word)) continue;
    for (const flag of word.slice(1)) {
      if (flag === "c") command = enable;
      if (flag === "s") stdin = enable;
      if (flag === "n") noexec = enable;
      if (flag === "i") interactive = enable;
    }
  }
  return { commandIndex: command ? index : -1,
    scriptIndex: !command && !stdin && index < words.length ? index : -1,
    syntaxOnly: noexec && !interactive };
}

export function shellSyntaxOnly(words: string[]): boolean {
  return words[0] === "bash" && shellInput(words).syntaxOnly;
}

export function shellCommandIndex(words: string[]): number {
  return SHELLS.has(words[0]) ? shellInput(words).commandIndex : -1;
}

function evaluationArgument(words: string[]): { index: number; offset: number } | undefined {
  if (SHELLS.has(words[0])) {
    const index = shellCommandIndex(words);
    return index < 0 ? undefined : { index, offset: 0 };
  }
  if (["deno", "bun"].includes(words[0]) && words[1] === "eval") return { index: 2, offset: 0 };
  if (words[0] === "eval") return { index: 1, offset: 0 };
  const clustered = words[0] === "ruby" ? /^-[acdlnpsvwy]*e/
    : words[0] === "perl" ? /^-[acdflnpstTuUvwWX]*[eE]/ : null;
  const flags = clustered ? [] : words[0]?.startsWith("python") ? ["-c"] : ["-e", "-E", "--eval", "-p", "--print"];
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index];
    if (optionTakesValue(words[0], word)) { index += 1; continue; }
    const prefix = clustered ? word.match(clustered)?.[0] : undefined;
    if (prefix) return prefix.length === word.length ? { index: index + 1, offset: 0 } : { index, offset: prefix.length };
    if (flags.includes(word)) return { index: index + 1, offset: 0 };
    for (const flag of flags) {
      if (flag.startsWith("--") && word.startsWith(flag + "=")) return { index, offset: flag.length + 1 };
      if (!flag.startsWith("--") && word.startsWith(flag) && word.length > flag.length) return { index, offset: flag.length };
    }
    if (word === "--" || word === "-" || word === "-m" || !word.startsWith("-")) return undefined;
  }
  return undefined;
}

export function evaluationArgumentIndex(words: string[]): number {
  return evaluationArgument(words)?.index ?? -1;
}

export function evaluationProgram(words: string[]): string | null {
  const argument = evaluationArgument(words);
  return argument ? (words[argument.index] ?? "").slice(argument.offset) : null;
}

export function scriptOperandIndex(words: string[]): number {
  if (!INTERPRETERS.has(words[0]) || evaluationArgumentIndex(words) >= 0) return -1;
  if (SHELLS.has(words[0])) return shellInput(words).scriptIndex;
  const start = ["deno", "bun"].includes(words[0]) && words[1] === "run" ? 2 : 1;
  for (let index = start; index < words.length; index += 1) {
    const word = words[index];
    if (word === "-m" && words[0].startsWith("python")) return index + 1;
    if (optionTakesValue(words[0], word)) { index += 1; continue; }
    if (word === "--") return index + 1;
    if (word === "-" || !word.startsWith("-")) return index;
  }
  return -1;
}

export function consumesProgramFromStdin(words: string[]): boolean {
  return !shellSyntaxOnly(words) && readsProgramFromStdin(words);
}

export function readsProgramFromStdin(words: string[]): boolean {
  if (!INTERPRETERS.has(words[0]) || ["eval", "source", "."].includes(words[0])) return false;
  if (evaluationArgumentIndex(words) >= 0) return false;
  const script = words[scriptOperandIndex(words)];
  return !script || script === "-" || descriptorPath(script) === "0";
}
