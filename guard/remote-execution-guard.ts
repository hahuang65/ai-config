import { resolve } from "node:path";
import { anyPipeline, executableSubstitutions, inputRedirects, splitStatements, stdoutRedirects, wordValue } from "./bash-command";
import { anyInvocation, invocation, invocationNodes, nestedCommand, rawInvocation } from "./command-invocations";
import { fields, named, ShellSyntaxError } from "./shell-parser";
import type { ToolCall } from "./guard-core";
import { INTERPRETERS, consumesProgramFromStdin, evaluationArgumentIndex, scriptOperandIndex, shellSyntaxOnly } from "./interpreter-input";

const DOWNLOADERS = new Set(["curl", "wget"]);

function downloadTarget(words: string[], stage: string): string | undefined {
  if (!DOWNLOADERS.has(words[0])) return undefined;
  const target = downloadOption(words);
  return target && target !== "-" ? target : stdoutRedirects(stage)[0];
}

function downloadOption(words: string[]): string | undefined {
  const output = words[0] === "curl" ? "-o" : "-O";
  const longOutput = words[0] === "curl" ? "--output" : "--output-document";
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index];
    if (word === output || word === longOutput) return words[index + 1];
    if (new RegExp(`^-[A-Za-z]*${output[1]}$`).test(word)) return words[index + 1];
    if (word.startsWith(output) && word.length > 2) return word.slice(2);
    if (word.startsWith(longOutput + "=")) return word.slice(longOutput.length + 1);
  }
  return undefined;
}

function downloadedSubstitution(words: string[], stage: string): boolean {
  if (shellSyntaxOnly(words)) return false;
  const nodes = invocationNodes(stage);
  const interpreter = INTERPRETERS.has(words[0]);
  const index = interpreter ? evaluationArgumentIndex(words) : 0;
  const indexes = words[0] === "eval" ? nodes.slice(1).map((_, index) => index + 1)
    : [index < 0 ? scriptOperandIndex(words) : index];
  const substitutions = indexes.flatMap((index) => nodes[index] ? executableSubstitutions(nodes[index]) : []);
  if (consumesProgramFromStdin(words)) substitutions.push(...inputRedirects(stage).slice(-1).flatMap(executableSubstitutions));
  return substitutions.some((substitution) => anyInvocation(named(substitution).map((node) => node.text).join("\n"),
    ([executable]) => DOWNLOADERS.has(executable)));
}

function pipelineEvidence(command: string, inputDownloaded = false, depth = 0): { executes: boolean; downloads: boolean } {
  if (depth > 16) throw new ShellSyntaxError("The Bash command exceeds the nested-program inspection limit.");
  let downloads = false;
  const executes = splitStatements(command).some((statement) => anyPipeline(statement, (stages) => {
    let downloaded = inputDownloaded;
    for (const stage of stages) {
      const words = invocation(stage);
      if (inputRedirects(stage).length) downloaded = false;
      if (downloaded && consumesProgramFromStdin(words)) return true;
      if (DOWNLOADERS.has(words[0])) downloaded = true;
      const nested = nestedCommand(stage, words);
      if (nested !== undefined) {
        const evidence = pipelineEvidence(nested, downloaded, depth + 1);
        if (evidence.executes) return true;
        downloaded ||= evidence.downloads;
      }
    }
    downloads ||= downloaded;
    return false;
  }));
  return { executes, downloads };
}

export function detectRemoteExecution(call: ToolCall): string | null {
  if (!call.command) return null;
  // This is deliberately call-local evidence, not a persistent script trust database.
  const downloads = new Set<string>();
  const pathKey = (file: string) => resolve(call.cwd ?? "/", file);
  const denied = pipelineEvidence(call.command).executes || anyInvocation(call.command, (words, stage) => {
    if (downloadedSubstitution(words, stage)) return true;
    const target = downloadTarget(words, stage);
    if (target && target !== "-") downloads.add(pathKey(target));
    const script = words[scriptOperandIndex(words)];
    if (!shellSyntaxOnly(words) && script && downloads.has(pathKey(script))) return true;
    if (consumesProgramFromStdin(words) && inputRedirects(stage).slice(-1).some((node) =>
      fields(node, "destination").some((file) => downloads.has(pathKey(wordValue(file)))))) return true;
    const executable = rawInvocation(stage)[0];
    return !!executable?.includes("/") && downloads.has(pathKey(executable));
  });
  return denied ? "Refused — recognizable download-and-execute flow; download separately, inspect the code, and have the user authorize execution." : null;
}
