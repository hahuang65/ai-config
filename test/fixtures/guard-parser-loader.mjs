// Actual Node/Pi extension loading in a disposable home. No provider or tool execution.
import { resolve } from "node:path";
const [sdkFile, agentDir, cwd, recheckDelay] = process.argv.slice(2);
const sdk = await import(sdkFile);
const settingsManager = sdk.SettingsManager.inMemory({ retry: { enabled: false }, cacheWarming: "off" });
const loader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager });
await loader.reload();
const loaded = loader.getExtensions();
const handlers = loaded.extensions.flatMap((extension) => extension.handlers.get("tool_call") ?? []);
const blocked = await Promise.all(["git status --short", "mkfs.ext4 /dev/example"].map(async (command) => {
  for (const handler of handlers) {
    const verdict = await handler({ type: "tool_call", toolName: "bash", input: { command } }, { cwd: resolve(cwd) });
    if (verdict?.block) return true;
  }
  return false;
}));
const later = {};
if (recheckDelay) {
  await new Promise((resolve) => setTimeout(resolve, Number(recheckDelay)));
  later.blockedAfterDelay = false;
  for (const handler of handlers) {
    const verdict = await handler({ type: "tool_call", toolName: "bash", input: { command: "git status --short" } }, { cwd });
    later.blockedAfterDelay ||= verdict?.block === true;
  }
}
console.log(JSON.stringify({ errors: loaded.errors.length, handlers: handlers.length, blocked, ...later }));
