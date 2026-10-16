import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { evaluate, resolveGuardHome } from "../../../guard/guard-core";

const MAX_DOCUMENT = 1024 * 1024;
export function checkPath(path: string, cwd: string) {
  const home = resolveGuardHome(process.env.HOME, homedir());
  if (!home) throw new Error("Cannot establish a safe home for language-server path checks.");
  const verdict = evaluate({ tool: "read", path, cwd, home });
  if (verdict) throw new Error(verdict.reason);
}

export async function readDocument(cwd: string, input: string) {
  const root = await realpath(cwd);
  const lexical = resolve(cwd, input);
  checkPath(lexical, cwd);
  const path = await realpath(lexical);
  checkPath(path, cwd);
  const child = relative(root, path);
  if (!child || child === ".." || child.startsWith("../") || isAbsolute(child)) {
    throw new Error("Language-server input must be a file inside the current workspace.");
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > MAX_DOCUMENT) throw new Error("Language-server input must be a regular file of at most 1 MiB.");
    const buffer = Buffer.alloc(MAX_DOCUMENT + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await file.read(buffer, total, buffer.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > MAX_DOCUMENT) throw new Error("Language-server input exceeds 1 MiB.");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, total));
    if (text.includes("\0")) throw new Error("Language-server input must be text.");
    return { root, path, uri: pathToFileURL(path).href, text };
  } finally { await file.close(); }
}

export function position(text: string, line?: number, column?: number) {
  if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column) || line! < 1 || column! < 1) {
    throw new Error("A position requires positive, 1-based line and UTF-16 column numbers.");
  }
  const lines = text.split(/\r\n|\r|\n/);
  if (line! > lines.length || column! > lines[line! - 1].length + 1) throw new Error("Position is outside the document.");
  return { line: line! - 1, character: column! - 1 };
}
