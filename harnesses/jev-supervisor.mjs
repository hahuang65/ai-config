// Keep the process-group leader alive until its owner has stopped the whole group.
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";

const empty = '{"status":"unavailable"}';
let sent = false;
const stop = () => {
  try { process.kill(-process.pid, "SIGKILL"); } catch { process.exit(1); }
};

// Only the owner holds the other end. SDK workers never inherit this pipe.
const owner = createReadStream("", { fd: 3, autoClose: false });
owner.once("end", stop);
owner.once("error", stop);
owner.resume();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
process.stdout.once("error", stop);
setTimeout(stop, 6000);

function publish(raw = empty) {
  if (sent) return;
  sent = true;
  let text = empty;
  try {
    const encoded = JSON.stringify(JSON.parse(raw));
    if (Buffer.byteLength(encoded) < 65536) text = encoded;
  } catch { /* Never forward raw worker diagnostics. */ }
  process.stdout.write(`${text}\n`);
}

async function input() {
  let size = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 32768) throw Error("Worker request exceeds its limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function start(body) {
  const args = [...(process.versions.bun ? ["--no-env-file", "--config=/dev/null"] : []), process.argv[2], "--stdin"];
  const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "ignore"] });
  const chunks = [];
  let size = 0;
  child.once("error", () => publish());
  child.stdin.once("error", () => publish());
  child.stdout.once("error", () => publish());
  child.stdout.on("data", chunk => {
    if (sent) return;
    size += chunk.length;
    if (size > 65536) { publish(); return; }
    chunks.push(chunk);
    const bytes = Buffer.concat(chunks), newline = bytes.indexOf(10);
    if (newline >= 0) publish(bytes.subarray(0, newline).toString("utf8"));
  });
  // Do not wait for EOF: descendants can retain the worker's stdout after exit.
  child.once("exit", () => setImmediate(() => publish(Buffer.concat(chunks).toString("utf8"))));
  child.stdin.end(body);
}

try { start(await input()); }
catch { publish(); }
