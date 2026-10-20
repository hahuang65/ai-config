import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const packageManifest = () => ({ ...JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8")), source: "/safe/source" });
function validate(value: unknown, filter = "native_package($permissions[0])") {
  return spawnSync("jq", ["-L", resolve(root, "tools/install"), "--slurpfile", "permissions",
    resolve(root, "tools/install/permissions.json"), "-ce", `include "manifest"; ${filter}`], {
    input: JSON.stringify(value), encoding: "utf8", timeout: 10_000,
  });
}

test("shell installer catalogue accepts the package and retains recorded old command ownership", () => {
  expect(validate(packageManifest()).status).toBe(0);
  const old = { version: 1, source: "/previous/source", links: [
    { destination: ".local/bin/artifact-review", target: "tools/artifact-review/target/release/artifact-review" },
    { destination: ".local/bin/review-change-eval", target: "tools/evaluation/target/release/review-change-eval" },
  ] };
  expect(validate(old, "record").status).toBe(0);
});

test("shell installer rejects missing safety resources and public aliases for private helpers", () => {
  for (const destination of [".claude/CLAUDE.md", ".pi/agent/AGENTS.md", ".claude/hooks/guard.ts",
    ".claude/skills/code", ".pi/agent/agents/fact-checker.md", ".pi/agent/extensions/lsp.ts", ".local/bin/review-change"]) {
    const value = packageManifest();
    value.links = value.links.filter((link: { destination: string }) => link.destination !== destination);
    expect(validate(value).status, destination).not.toBe(0);
  }
  const value = packageManifest();
  value.links.push({ destination: ".local/bin/consult", target: "tools/evaluation/target/release/consult" });
  expect(validate(value).status).not.toBe(0);
});

test("shell installer requires synchronous feedback workspace focus at startup and worktree transitions", () => {
  for (const event of ["SessionStart", "PostToolUse"]) {
    const value = packageManifest();
    value.settings = value.settings.filter(setting => !(setting.path[1] === event
      && setting.value.hooks?.[0].command === "bun ~/.claude/hooks/review-feedback.ts --focus"));
    expect(validate(value).status, event).not.toBe(0);
  }
});

test("shell installer rejects unsafe paths, duplicate declarations, and unrelated settings ownership", () => {
  for (const patch of [
    { source: "/" }, { source: "relative" }, { source: "/safe/../source" }, { source: "/safe\nsource" },
    { settings: null }, { version: 3 }, { unexpected: true },
    { links: [{ destination: ".claude/skills/../settings.json", target: "baseline.md" }] },
    { links: [{ destination: ".claude/CLAUDE.md", target: "../outside" }] },
    { settings: [{ destination: ".pi/agent/settings.json", path: ["defaultModel"], mode: "value", value: "override" }] },
  ]) expect(validate({ ...packageManifest(), ...patch }, "record").status, JSON.stringify(patch)).not.toBe(0);
  const duplicate = packageManifest();
  duplicate.links.push(duplicate.links[0]);
  expect(validate(duplicate, "record").status).not.toBe(0);
});

test("shell record validation rejects private destinations, preference ownership and invalid setting shapes", () => {
  for (const destination of ["../outside", "/tmp/outside", ".claude/settings.json", ".pi/agent/settings.json",
    ".claude/projects/history", ".pi/agent/sessions/history", ".pi/agent/trust.json",
    ".local/state/ai-config/installation.json"]) {
    const value = packageManifest();
    value.links.push({ destination, target: "baseline.md" });
    expect(validate(value, "record").status, destination).not.toBe(0);
  }
  for (const [destination, path] of [
    ...["defaultModel", "defaultProvider", "defaultThinkingLevel", "enabledModels", "defaultProjectTrust", "sessionDir"]
      .map(name => [".pi/agent/settings.json", [name]]),
    [".claude/settings.json", ["model"]], [".claude/settings.json", ["env", "ANTHROPIC_API_KEY"]],
    [".pi/agent/auth.json", ["theme"]], [".claude.json", ["theme"]],
  ]) {
    const value = packageManifest();
    value.settings.push({ destination, path, mode: "value", value: "not-owned" });
    expect(validate(value, "record").status, JSON.stringify(path)).not.toBe(0);
  }
  for (const claim of [
    { path: ["theme"], mode: "value", value: true },
    { path: ["theme"], mode: "value", value: { unrelated: "value" } },
    { path: ["permissions"], mode: "array_entry", value: "Read(example)" },
  ]) {
    const value = packageManifest();
    value.settings.push({ destination: ".claude/settings.json", ...claim });
    expect(validate(value, "record").status).not.toBe(0);
  }
  expect(validate({ ...packageManifest(), version: 1 }, "record").status).not.toBe(0);
});

test("shell installer retains permission floors and native guard and task hooks", () => {
  const original = packageManifest();
  for (let index = 0; index < original.settings.length; index++) {
    const claim = original.settings[index];
    if (!["hooks", "permissions"].includes(claim.path[0])) continue;
    const modified = { ...original, settings: original.settings.filter((_: unknown, i: number) => i !== index) };
    expect(validate(modified).status, JSON.stringify(claim.path)).not.toBe(0);
  }
});

test("shell installer refuses overlapping link destinations across an ownership switch", () => {
  const value = packageManifest();
  value.links.push({ destination: ".claude/skills/code/nested", target: "skills/code" });
  const result = validate(value, 'link_plan({version:2,source:"/old/source",links:[],settings:[]})');
  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe("");
});
