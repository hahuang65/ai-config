// Fault injection over real pipes, without servers or network access.
import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
const [mode, log] = process.argv.slice(2);
appendFileSync(log, `${process.pid}\n`);
if (mode === "descendant" || mode === "inherited-pipes") {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: mode === "inherited-pipes" ? ["ignore", "inherit", "inherit"] : "ignore",
  });
  appendFileSync(log, `${child.pid}\n`);
}
if (mode === "flood") setInterval(() => {}, 1000);
let received = false;
process.stdin.on("data", () => {
  if (received && mode === "descendant") {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 2, result: null });
    process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`, () => process.exit(0));
    return;
  }
  if (received) return;
  received = true;
  if (mode === "malformed") process.stdout.write("Content-Length: 4\r\n\r\nnope");
  if (mode === "oversized") process.stdout.write("Content-Length: 999999999\r\n\r\n");
  if (mode === "exit") process.exit(3);
  if (mode === "invalid-utf8") {
    const body = Buffer.concat([Buffer.from('{"jsonrpc":"2.0","id":1,"result":"'), Buffer.from([0xff]), Buffer.from('"}')]);
    process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
    process.stdout.write(body);
  }
  const envelopes = {
    "empty-response": {},
    "object-id": { id: {}, result: null },
    "boolean-id": { id: true, result: null },
    "array-id": { id: [], result: null },
    "both-fields": { result: null, error: { code: 1, message: "error" } },
    "invalid-error": { error: { code: "not-a-number", message: 17 } },
    "null-error": { error: null },
    "valid-null": { result: null },
  };
  if (mode in envelopes) {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, ...envelopes[mode] });
    process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }
  if (mode === "flood") {
    process.stdin.pause();
    const result = JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} });
    process.stdout.write(`Content-Length: ${Buffer.byteLength(result)}\r\n\r\n${result}`);
    for (let id = 0; id < 12_000; id++) {
      const request = JSON.stringify({ jsonrpc: "2.0", id: `server-${id}`, method: "workspace/configuration", params: { items: Array(100).fill({}) } });
      process.stdout.write(`Content-Length: ${Buffer.byteLength(request)}\r\n\r\n${request}`);
    }
  }
  if (mode === "fragmented" || mode === "descendant" || mode === "inherited-pipes") {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { unicode: "😀" } });
    const wire = Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    let index = 0;
    const next = () => {
      if (index < wire.length) { process.stdout.write(wire.subarray(index, ++index)); setImmediate(next); }
      else if (mode === "inherited-pipes") process.exit(0);
    };
    next();
  }
});
