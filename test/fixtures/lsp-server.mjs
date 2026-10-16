// Disposable stdio server: never loads a real language server or a provider.
import { appendFileSync } from "node:fs";
let buffer = Buffer.alloc(0);
const documents = new Map();
const firstVersions = new Map();
const mode = process.env.LSP_TEST_MODE;
let versionSupport = false;
const send = (message) => {
  const body = JSON.stringify({ jsonrpc: "2.0", ...message });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
};
function receive(message) {
  appendFileSync(process.env.LSP_TEST_LOG, JSON.stringify({ pid: process.pid, ...message }) + "\n");
  const { id, method, params } = message;
  if (!method) return; // Client responses to server-initiated requests.
  if (method === "initialize") {
    versionSupport = params.capabilities?.textDocument?.publishDiagnostics?.versionSupport === true;
    send({ id, result: { capabilities: { hoverProvider: process.env.LSP_TEST_MODE !== "unsupported",
    positionEncoding: process.env.LSP_TEST_MODE === "utf8" ? "utf-8" : "utf-16",
    definitionProvider: true, referencesProvider: true, documentSymbolProvider: true,
    ...(mode?.startsWith("push") || !params.capabilities?.textDocument?.diagnostic ? {}
      : { diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false } }), textDocumentSync: 1 } } });
  } else if (method === "textDocument/didOpen" || method === "textDocument/didChange") {
    documents.set(params.textDocument.uri, params.textDocument.text ?? params.contentChanges[0].text);
    if (mode === "push-malformed") {
      process.stdout.write("Content-Length: 4\r\n\r\nnope");
      return;
    }
    if (mode?.startsWith("push")) {
      const { uri, version } = params.textDocument;
      if (mode === "push-reopen" && method === "textDocument/didOpen" && firstVersions.has(uri)) {
        send({ method: "textDocument/publishDiagnostics", params: { uri, ...(versionSupport ? { version: firstVersions.get(uri) } : {}), diagnostics: [] } });
      }
      if (!firstVersions.has(uri)) firstVersions.set(uri, version);
      send({ method: "textDocument/publishDiagnostics", params: { uri, ...(versionSupport ? { version } : {}), diagnostics: [{ message: "pushed diagnostic" }] } });
    }
  }
  else if (method === "initialized" && process.env.LSP_TEST_MODE === "edit") send({ id: "server-edit", method: "workspace/applyEdit",
    params: { edit: { changes: {} } } });
  else if (method === "textDocument/hover") send({ id, result: { contents: process.env.LSP_TEST_MODE === "large"
    ? "x".repeat(100_000) : documents.get(params.textDocument.uri) } });
  else if (method === "textDocument/definition" || method === "textDocument/references") send({ id, result: [
    { uri: params.textDocument.uri, range: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } } },
  ] });
  else if (method === "textDocument/documentSymbol") send({ id, result: [{ name: "answer", kind: 14,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 18 } },
    selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } } }] });
  else if (method === "textDocument/diagnostic" && process.env.LSP_TEST_MODE === "push") send({ id, error: { code: -32601, message: "Unsupported" } });
  else if (method === "textDocument/diagnostic") send({ id, result: { kind: "full", items: documents.get(params.textDocument.uri).includes("bad")
    ? [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, severity: 1, message: "bad declaration" }] : [] } });
  else if (method === "shutdown") send({ id, result: null });
  else if (method === "exit") process.exit(0);
  else if (id !== undefined) send({ id, result: [] });
}
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const end = buffer.indexOf("\r\n\r\n");
    if (end < 0) return;
    const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())[1]);
    if (buffer.length < end + 4 + length) return;
    const body = buffer.subarray(end + 4, end + 4 + length);
    buffer = buffer.subarray(end + 4 + length);
    receive(JSON.parse(body.toString()));
  }
});
