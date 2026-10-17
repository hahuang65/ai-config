import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Language, Node as SyntaxNode, Parser as ParserType } from "web-tree-sitter";

export interface ShellNode {
  type: string;
  text: string;
  start: number;
  end: number;
  named: boolean;
  field: string | null;
  children: ShellNode[];
}

export class ShellSyntaxError extends Error {}
let Parser: typeof ParserType;
let language: Language | undefined;
let initialization: Promise<boolean> | undefined;
let activeCache: Map<string, ShellNode> | undefined;

const INITIALIZATION_MS = 1000;
const MAX_ASSET_BYTES = 2 * 1024 * 1024;

/** Async WASM loading stays outside synchronous policy evaluation. No runtime downloads. */
export function initializeShellParser(): Promise<boolean> {
  initialization ??= startInitialization();
  return initialization;
}

function startInitialization(): Promise<boolean> {
  const controller = new AbortController();
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve(false); }, INITIALIZATION_MS);
  });
  return Promise.race([loadParser(controller.signal, started).catch(() => false), deadline])
    .finally(() => { clearTimeout(timer); controller.abort(); });
}

async function loadParser(signal: AbortSignal, started: number): Promise<boolean> {
  const runtime = await import("./vendor/tree-sitter.mjs");
  signal.throwIfAborted();
  const directory = dirname(await realpath(fileURLToPath(import.meta.url)));
  const assets = basename(directory) === "guard" ? resolve(directory, "vendor") : resolve(directory, "../../guard/vendor");
  const [core, grammar] = await Promise.all(["web-tree-sitter.wasm", "tree-sitter-bash.wasm"]
    .map((file) => readAsset(resolve(assets, file), signal)));
  signal.throwIfAborted();
  await runtime.Parser.init({ wasmBinary: core });
  signal.throwIfAborted();
  const loaded = await runtime.Language.load(grammar);
  if (signal.aborted || performance.now() - started >= INITIALIZATION_MS) return false;
  Parser = runtime.Parser;
  language = loaded;
  return true;
}

async function readAsset(path: string, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    signal.throwIfAborted();
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size === 0 || metadata.size > MAX_ASSET_BYTES) throw new Error("Invalid parser asset.");
    const bytes = Buffer.alloc(metadata.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      signal.throwIfAborted();
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== metadata.size) throw new Error("Parser asset changed while loading.");
    return bytes.subarray(0, offset);
  } finally { await handle.close(); }
}

/** Cache only within one synchronous guard decision, never across tool calls. */
export function withShellAnalysis<T>(command: string | undefined, inspect: () => T): T {
  const previous = activeCache;
  activeCache = new Map();
  try {
    if (command) parseShell(command);
    return inspect();
  } finally { activeCache = previous; }
}

export function parseShell(source: string): ShellNode {
  if (!language) throw new ShellSyntaxError("The Bash parser is unavailable; rebuild the package and reload the harness.");
  if (Buffer.byteLength(source) > 65_536) throw new ShellSyntaxError("The Bash command exceeds the 64 KiB inspection limit.");
  const cached = activeCache?.get(source);
  if (cached) return cached;
  if (activeCache && activeCache.size >= 64) throw new ShellSyntaxError("The Bash command exceeds the nested-program inspection limit.");
  const parser = new Parser();
  let tree;
  try {
    parser.setLanguage(language);
    const started = performance.now();
    tree = parser.parse(source, null, { progressCallback: () => performance.now() - started > 100 });
    if (!tree || tree.rootNode.hasError) throw new ShellSyntaxError("The Bash command is malformed or could not be fully parsed.");
    const root = copyNode(tree.rootNode, null, { count: 0, bytes: 0 }, 0);
    activeCache?.set(source, root);
    return root;
  } finally { tree?.delete(); parser.delete(); }
}

function copyNode(node: SyntaxNode, field: string | null, budget: { count: number; bytes: number }, depth: number): ShellNode {
  budget.count += 1;
  budget.bytes += Buffer.byteLength(node.text);
  if (budget.count > 16_384 || budget.bytes > 2_097_152 || depth > 128) {
    throw new ShellSyntaxError("The Bash syntax tree exceeds the inspection limits.");
  }
  return {
    type: node.type, text: node.text, start: node.startIndex, end: node.endIndex, named: node.isNamed, field,
    children: normalizeDescriptors(node.children.map((child, index) => copyNode(child, node.fieldNameForChild(index), budget, depth + 1))),
  };
}

// The pinned grammar can classify an adjacent numeric descriptor (notably 0) as
// an argument or previous redirect destination. Repair only syntax-proven adjacency.
function normalizeDescriptors(children: ShellNode[]): ShellNode[] {
  for (let index = 1; index < children.length; index += 1) {
    const redirect = children[index];
    if (!redirect.type.endsWith("_redirect") || redirect.children.some((node) => node.field === "descriptor")) continue;
    const previous = children[index - 1];
    let owner = previous;
    while (owner.children.at(-1)?.end === redirect.start && owner.children.at(-1)?.type !== "number") owner = owner.children.at(-1)!;
    const number = previous.type === "number" ? previous : owner.children.at(-1);
    if (number?.type !== "number" || !/^\d+$/.test(number.text) || number.end !== redirect.start) continue;
    redirect.children.unshift({ ...number, type: "file_descriptor", field: "descriptor" });
    if (number === previous) { children.splice(index - 1, 1); index -= 1; }
    else owner.children.pop();
  }
  return children;
}

export const named = (node: ShellNode): ShellNode[] => node.children.filter((child) => child.named);
export const field = (node: ShellNode, name: string): ShellNode | undefined => node.children.find((child) => child.field === name);
export const fields = (node: ShellNode, name: string): ShellNode[] => node.children.filter((child) => child.field === name);

export function descendants(node: ShellNode, type: string): ShellNode[] {
  return (node.type === type ? [node] : []).concat(node.children.flatMap((child) => descendants(child, type)));
}
