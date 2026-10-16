import { existsSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { open } from "node:fs/promises";
const [sdkPath, root, actionsFile] = process.argv.slice(2);
const sdk = await import(sdkPath);
const cwd = join(root, "project");
// Simulate legal short filesystem reads only inside this disposable Node process.
if (process.env.LSP_TEST_MODE === "short-read") {
  const handle = await open(join(cwd, "main.ts"), "r");
  const prototype = Object.getPrototypeOf(handle);
  const read = prototype.read;
  prototype.read = function (buffer, offset, length, position) {
    return read.call(this, buffer, offset, Math.min(length, 7), position);
  };
  await handle.close();
}
const settingsManager = sdk.SettingsManager.inMemory();
const loader = new sdk.DefaultResourceLoader({ cwd, agentDir: join(root, "home/.pi/agent"), settingsManager });
await loader.reload();
const { extensions, errors } = loader.getExtensions();
if (errors.length) throw new Error(JSON.stringify(errors));
const tool = extensions.flatMap((e) => [...e.tools.values()]).find((t) => t.definition.name === "lsp")?.definition;
const log = () => existsSync(process.env.LSP_TEST_LOG)
  ? readFileSync(process.env.LSP_TEST_LOG, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
const initial = log();
const results = [];
try {
  if (tool) for (const action of JSON.parse(readFileSync(actionsFile, "utf8"))) {
    if (action.write) { writeFileSync(join(cwd, action.write), action.content); continue; }
    if (action.symlink) { symlinkSync(join(cwd, action.target), join(cwd, action.symlink)); continue; }
    try {
      results.push(await tool.execute("fixture", action, undefined, undefined, { cwd }));
    } catch (error) { results.push({ error: error.message }); }
  }
} finally {
  for (const extension of extensions) for (const handler of extension.handlers.get("session_shutdown") ?? []) {
    await handler({ type: "session_shutdown" }, { cwd });
  }
}
console.log(JSON.stringify({ found: !!tool, initial, results, log: log() }));
