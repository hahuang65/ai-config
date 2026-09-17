import { afterEach, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { runReviewPublicationRequest } from "../../skills/review-change/runtime/review-publication-worker.mjs";

const temporaryRoots: string[] = [];
afterEach(async () => Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true }))));

for (const fixture of [
  { name: "removed GitHub executable", break: async (state: Awaited<ReturnType<typeof workerState>>) => rm(state.githubExecutable), code: "provider_unavailable" },
  { name: "unsafe GitHub executable", break: async (state: Awaited<ReturnType<typeof workerState>>) => chmod(state.githubExecutable, 0o722), code: "provider_unavailable" },
  { name: "broken managed configuration", break: async (state: Awaited<ReturnType<typeof workerState>>) => writeFile(state.configurationPath, "{broken", { mode: 0o600 }), code: "publisher_configuration_invalid" },
  { name: "broken signing key", break: async (state: Awaited<ReturnType<typeof workerState>>) => writeFile(state.signingKeyPath, "short", { mode: 0o600 }), code: "publisher_signing_key_unavailable" },
  { name: "removed confirmation executable", break: async (state: Awaited<ReturnType<typeof workerState>>) => rm(state.confirmationExecutable), code: "os_confirmation_unavailable" },
]) {
  test(`production worker returns one safe corrective page for a ${fixture.name}`, async () => {
    const state = await workerState();
    await fixture.break(state);

    const response = await runWorkerRequest(state.home);
    const providerCalls = await fileLines(state.providerLog);

    expect({
      responses: response.match(/HTTP\/1\.1/g)?.length,
      typedPage: response.includes(`data-publication-error="${fixture.code}"`),
      corrective: response.includes("Repair") || response.includes("repair"),
      noStore: response.includes("cache-control: no-store"),
      leakedHome: response.includes(state.home),
      leakedRawError: response.includes("ENOENT") || response.includes("SyntaxError") || response.includes("EACCES"),
      providerCalls,
    }).toEqual({
      responses: 1,
      typedPage: true,
      corrective: true,
      noStore: true,
      leakedHome: false,
      leakedRawError: false,
      providerCalls: [],
    });
  });
}

test("production worker preserves malformed-request handling before initialization", async () => {
  const state = await workerState();
  await writeFile(state.configurationPath, "{broken", { mode: 0o600 });
  const input = new PassThrough();
  const output = responseStream();
  input.end("not http\r\n\r\n");

  await runReviewPublicationRequest({ input, output, home: state.home });
  const response = output.text();

  expect({
    invalidRequest: response.includes('data-publication-error="invalid_http_request_line"'),
    configurationError: response.includes("publisher_configuration_invalid"),
    providerCalls: await fileLines(state.providerLog),
  }).toEqual({ invalidRequest: true, configurationError: false, providerCalls: [] });
});

async function workerState() {
  const home = await mkdtemp(path.join(tmpdir(), "review-publication-worker-init-"));
  temporaryRoots.push(home);
  const stateDirectory = path.join(home, ".review-publication");
  const bin = path.join(home, "bin");
  await mkdir(stateDirectory, { mode: 0o700 });
  await mkdir(bin, { mode: 0o700 });
  const providerLog = path.join(home, "provider-calls");
  const githubExecutable = path.join(bin, "gh");
  const confirmationExecutable = path.join(bin, "confirm");
  await writeFile(githubExecutable, `#!${process.execPath}\nrequire("node:fs").appendFileSync(${JSON.stringify(providerLog)}, "called\\n");\n`, { mode: 0o700 });
  await writeFile(confirmationExecutable, `#!${process.execPath}\n`, { mode: 0o700 });
  const configurationPath = path.join(stateDirectory, "worker-config.json");
  await writeFile(configurationPath, `${JSON.stringify({
    managedBy: "Managed by ai-config: review-publication",
    version: 1,
    confirmationExecutable,
    githubExecutable,
  })}\n`, { mode: 0o600 });
  const signingKeyPath = path.join(stateDirectory, "signing-key");
  await writeFile(signingKeyPath, Buffer.alloc(32, 8), { mode: 0o600 });
  return {
    home,
    providerLog,
    githubExecutable,
    confirmationExecutable,
    configurationPath,
    signingKeyPath,
  };
}

async function runWorkerRequest(home: string) {
  const input = new PassThrough();
  const output = responseStream();
  const body = "publication_token=invalid";
  input.write([
    "POST /api/v1/review-publication-confirmations HTTP/1.1",
    "Host: 127.0.0.1:4392",
    "Content-Type: application/x-www-form-urlencoded",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "",
    body,
  ].join("\r\n"));
  await runReviewPublicationRequest({ input, output, home });
  input.destroy();
  return output.text();
}

function responseStream() {
  const stream = new PassThrough() as PassThrough & { chunks: Buffer[]; text(): string };
  stream.chunks = [];
  stream.on("data", (chunk) => stream.chunks.push(Buffer.from(chunk)));
  stream.text = () => Buffer.concat(stream.chunks).toString("utf8");
  return stream;
}

async function fileLines(file: string) {
  try {
    return (await readFile(file, "utf8")).trim().split("\n").filter(Boolean);
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}
