import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const MAX_FRAME = 8 * 1024 * 1024;
const MAX_QUEUED_OUTPUT = 2 * 1024 * 1024;
const REQUEST_TIMEOUT = 15_000;
type Pending = { resolve(value: any): void; reject(error: Error): void; cleanup(): void };

/** Bounded stdio JSON-RPC; no shell, protocol/stderr logging, or server-directed execution. */
export class LspTransport {
  private child: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private pending = new Map<number, Pending>();
  private nextId = 0;
  private queuedBytes = 0;
  private failure?: Error;
  private closed: Promise<void>;
  private exited = false;
  private stopping?: Promise<void>;

  constructor(command: string, args: string[], cwd: string, private rootUri: string,
    private timeout = REQUEST_TIMEOUT) {
    this.child = spawn(command, args, { cwd, shell: false, detached: process.platform !== "win32", stdio: "pipe" });
    this.closed = new Promise((resolve) => this.child.once("close", () => {
      this.kill("SIGKILL"); // Terminate helpers (e.g. tsserver) even after their parent exits.
      this.exited = true;
      this.fail("Language server exited; retry to start a new process.");
      resolve();
    }));
    this.child.on("exit", () => this.fail("Language server exited; retry to start a new process."));
    this.child.on("error", () => this.fail(`Cannot start ${command}; provision the tools declared in mise.toml.`));
    this.child.stdin.on("error", () => this.fail("Language server input closed."));
    this.child.stdout.on("data", (chunk: Buffer) => {
      try { this.receive(chunk); } catch { this.fail("Invalid or oversized language-server response."); }
    });
    this.child.stderr.resume(); // Never return raw server logs (paths, source, or credentials).
  }

  get alive() { return !this.failure && !this.stopping; }

  private send(message: object) {
    if (this.failure) throw this.failure;
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    if (Buffer.byteLength(body) > MAX_FRAME) throw new Error("Language-server request exceeds the size limit.");
    const frame = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    const bytes = Buffer.byteLength(frame);
    if (bytes > MAX_QUEUED_OUTPUT) throw new Error("Language-server serialized input exceeds 2 MiB; use a smaller document.");
    if (this.queuedBytes + bytes > MAX_QUEUED_OUTPUT) {
      this.fail("Language-server output queue exceeds 2 MiB; the server is not consuming input.");
      throw this.failure!;
    }
    // Track complete frames until flushed, including writes queued under backpressure.
    this.queuedBytes += bytes;
    this.child.stdin.write(frame, () => { this.queuedBytes -= bytes; });
  }

  notify(method: string, params?: unknown) { this.send({ method, ...(params === undefined ? {} : { params }) }); }

  request(method: string, params?: unknown, signal?: AbortSignal): Promise<any> {
    if (signal?.aborted) return Promise.reject(new Error("Language-server request cancelled."));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const abort = () => this.fail("Language-server request cancelled.");
      const timer = setTimeout(() => this.fail(`Language-server request timed out: ${method}.`), this.timeout);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
      this.pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener("abort", abort, { once: true });
      try { this.send({ id, method, ...(params === undefined ? {} : { params }) }); }
      catch (error) { this.pending.delete(id); cleanup(); reject(error); }
    });
  }

  private receive(chunk: Buffer) {
    if (this.failure) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length) {
      const end = this.buffer.indexOf("\r\n\r\n");
      if (end < 0) {
        if (this.buffer.length > 8192) throw new Error("Header limit");
        return;
      }
      if (end > 8192) throw new Error("Header limit");
      const lengths = [...this.buffer.subarray(0, end).toString("ascii").matchAll(/^Content-Length: (\d+)\r?$/gim)];
      const length = lengths.length === 1 ? Number(lengths[0][1]) : NaN;
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_FRAME) throw new Error("Frame limit");
      if (this.buffer.length < end + 4 + length) return;
      const text = new TextDecoder("utf-8", { fatal: true }).decode(this.buffer.subarray(end + 4, end + 4 + length));
      const message = JSON.parse(text);
      this.buffer = this.buffer.subarray(end + 4 + length);
      this.dispatch(message);
    }
  }

  onNotification?: (method: string, params: any) => void;
  onFailure?: (error: Error) => void;

  private dispatch(message: any) {
    if (!message || message.jsonrpc !== "2.0") throw new Error("Invalid JSON-RPC");
    if (typeof message.method === "string") {
      if (message.id !== undefined) this.respond(message);
      else this.onNotification?.(message.method, message.params);
      return;
    }
    const hasResult = Object.hasOwn(message, "result");
    const hasError = Object.hasOwn(message, "error");
    const validId = message.id === null || typeof message.id === "string" ||
      (typeof message.id === "number" && Number.isFinite(message.id));
    if (hasResult === hasError || !validId ||
      (hasError && (!message.error || !Number.isInteger(message.error.code) || typeof message.error.message !== "string"))) {
      throw new Error("Invalid JSON-RPC response");
    }
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    entry.cleanup();
    if (hasError) entry.reject(new Error(`Language server rejected request (code ${Number(message.error.code)}).`));
    else entry.resolve(message.result);
  }

  private respond({ id, method, params }: any) {
    if (method === "workspace/configuration" && Array.isArray(params?.items) && params.items.length <= 100) {
      this.send({ id, result: params.items.map(() => null) });
    } else if (method === "workspace/workspaceFolders") {
      this.send({ id, result: [{ uri: this.rootUri, name: "workspace" }] });
    } else if (method === "workspace/applyEdit") {
      this.send({ id, result: { applied: false, failureReason: "Read-only language-server client" } });
    } else if (method === "window/showMessageRequest") {
      this.send({ id, result: null });
    } else this.send({ id, error: { code: -32601, message: "Client method not supported" } });
  }

  private fail(message: string) {
    if (this.failure) return;
    this.failure = new Error(message);
    for (const entry of this.pending.values()) { entry.cleanup(); entry.reject(this.failure); }
    this.pending.clear();
    this.onFailure?.(this.failure);
    this.buffer = Buffer.alloc(0);
    this.kill("SIGKILL");
  }

  private kill(signal: NodeJS.Signals) {
    if (!this.child.pid || this.exited) return;
    try {
      if (process.platform !== "win32") process.kill(-this.child.pid, signal);
      else this.child.kill(signal);
    } catch { /* The process can exit between the status check and kill. */ }
  }

  stop(): Promise<void> { return this.stopping ??= this.finish(); }

  private async finish() {
    try {
      if (!this.failure) { await this.request("shutdown"); this.notify("exit"); }
    } catch { /* Cleanup still kills an unresponsive server. */ }
    const timer = setTimeout(() => this.kill("SIGKILL"), 500);
    try { await this.closed; } finally { clearTimeout(timer); }
  }
}
