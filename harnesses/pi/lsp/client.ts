import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import catalogue from "../../../language-servers.json";
import { position, readDocument } from "./documents";
import { LspTransport } from "./transport";
import { Diagnostics } from "./diagnostics";

export const servers = catalogue;
const operations = { hover: "hover", definition: "definition", references: "references", symbols: "documentSymbol", diagnostics: "diagnostic" } as const;
export type Input = { operation: keyof typeof operations; path: string; line?: number; column?: number };
type Server = { rpc: LspTransport; diagnostics: Diagnostics; capabilities: Record<string, any>; nextVersion: number;
  documents: Map<string, { text: string; version: number }> };

/** One server per catalogue entry and workspace, owned by this extension instance. */
export class LanguageServers {
  private running = new Map<string, Server>();

  async execute(cwd: string, input: Input, signal?: AbortSignal) {
    if (signal?.aborted) throw new Error("Language-server request cancelled.");
    const document = await readDocument(cwd, input.path);
    const selected = Object.entries(servers).find(([, server]) => extname(document.path) in server.extensionToLanguage);
    if (!selected) throw new Error("No shared language server supports this file extension.");
    if (!Object.hasOwn(operations, input.operation)) throw new Error("Unsupported read-only language-server operation.");
    const cursor = ["symbols", "diagnostics"].includes(input.operation) ? undefined : position(document.text, input.line, input.column);
    const [name, config] = selected;
    const server = await this.get(name, document.root, signal);
    const capability = `${operations[input.operation]}Provider`;
    if (input.operation !== "diagnostics" && !server.capabilities[capability]) {
      throw new Error(`Language server does not support ${input.operation}.`);
    }
    this.makeRoom(server, document.uri);
    const previous = server.documents.get(document.uri);
    const changed = previous?.text !== document.text;
    const version = changed ? ++server.nextVersion : previous!.version;
    if (!previous) server.rpc.notify("textDocument/didOpen", { textDocument: { uri: document.uri,
      languageId: (config.extensionToLanguage as Record<string, string>)[extname(document.path)], version, text: document.text } });
    else if (previous.text !== document.text) server.rpc.notify("textDocument/didChange", {
      textDocument: { uri: document.uri, version }, contentChanges: [{ text: document.text }] });
    if (changed) server.diagnostics.changed(document.uri, version);
    server.documents.set(document.uri, { text: document.text, version });
    if (input.operation === "diagnostics" && !server.capabilities.diagnosticProvider) {
      return server.diagnostics.read(document.uri, signal);
    }
    return server.rpc.request(`textDocument/${operations[input.operation]}`, { textDocument: { uri: document.uri },
      ...(cursor ? { position: cursor } : {}), ...(input.operation === "references" ? { context: { includeDeclaration: true } } : {}) }, signal);
  }

  private makeRoom(server: Server, uri: string) {
    if (server.documents.has(uri) || server.documents.size < 32) return;
    const oldest = server.documents.keys().next().value!;
    server.rpc.notify("textDocument/didClose", { textDocument: { uri: oldest } });
    server.documents.delete(oldest);
    server.diagnostics.forget(oldest);
  }

  private async get(name: string, root: string, signal?: AbortSignal) {
    const key = `${root}\0${name}`;
    const prior = this.running.get(key);
    if (prior?.rpc.alive) return prior;
    if (prior) await prior.rpc.stop();
    const config = servers[name as keyof typeof servers];
    const rootUri = pathToFileURL(root).href;
    const rpc = new LspTransport(config.command, config.args, root, rootUri);
    const server: Server = { rpc, documents: new Map(), capabilities: {}, diagnostics: new Diagnostics(), nextVersion: 0 };
    rpc.onNotification = (method, params) => {
      if (method === "textDocument/publishDiagnostics") server.diagnostics.publish(params);
    };
    rpc.onFailure = (error) => server.diagnostics.stop(error);
    this.running.set(key, server);
    try {
      const initialized = await rpc.request("initialize", { processId: process.pid, rootUri, clientInfo: { name: "ai-config-pi" },
        workspaceFolders: [{ uri: rootUri, name: "workspace" }], capabilities: {
          general: { positionEncodings: ["utf-16"] }, workspace: { configuration: true, workspaceFolders: true },
          textDocument: { synchronization: { dynamicRegistration: false }, hover: { contentFormat: ["plaintext"] },
            diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
            publishDiagnostics: { versionSupport: true } },
        } }, signal);
      server.capabilities = initialized?.capabilities ?? {};
      if (server.capabilities.positionEncoding && server.capabilities.positionEncoding !== "utf-16") {
        throw new Error("Language server did not negotiate UTF-16 positions.");
      }
      rpc.notify("initialized", {});
      return server;
    } catch (error) { await rpc.stop(); throw error; }
  }

  async stop() {
    const servers = [...this.running.values()];
    this.running.clear();
    for (const server of servers) server.diagnostics.stop();
    await Promise.all(servers.map((server) => server.rpc.stop()));
  }
}
