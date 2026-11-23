// Native Pi model/auth adapter for trusted Rust orchestration and Claude hooks.
// No conversation model, tools, resource discovery, or reviewed-source execution.
import { constants, openSync, closeSync, fstatSync, readSync, realpathSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { classifyJev, unavailable } from "../jev-client.ts";
import { runJevBridge } from "../jev-process.ts";

export function classifyNative(request, parent, sources = []) {
  return runJevBridge(import.meta.url, request, parent, sources);
}

async function classifyInProcess(request, parent) {
  const signal = AbortSignal.any([AbortSignal.timeout(5000), ...(parent ? [parent] : [])]);
  try {
    const { projectPiPackage } = await import("../../tools/project-pi.mjs");
    const sdk = await import(pathToFileURL(join(projectPiPackage(), "dist/index.js")).href);
    const runtime = await sdk.ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false, signal });
    return await classifyJev({ findOfType: (...args) => runtime.getModelOfType(...args),
      classify: runtime.classify.bind(runtime) }, request, signal);
  } catch { return unavailable(); }
}

function requestFile(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 32768) throw Error("Invalid Jev request");
    const bytes = Buffer.alloc(32769);
    const size = readSync(fd, bytes, 0, bytes.length, 0);
    if (size > 32768) throw Error("Invalid Jev request");
    const value = JSON.parse(bytes.subarray(0, size).toString("utf8"));
    if (!value || !value.state || !value.questions) throw Error("Invalid Jev request");
    return value;
  } finally { closeSync(fd); }
}

async function stdinRequest() {
  let size = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 32768) throw Error("Invalid Jev request");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const entry = process.argv[1] && realpathSync(resolve(process.argv[1]));
if (entry === fileURLToPath(import.meta.url)) {
  let result;
  try { result = await classifyInProcess(process.argv[2] === "--stdin" ? await stdinRequest() : requestFile(process.argv[2])); }
  catch { result = unavailable(); }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
