import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { installFixture, installerScenarioGuard } from "./fixtures/install-script";

const resources = [
  { destination: ".pi/agent/extensions/specialists.ts", target: "harnesses/pi/specialists.bundle.ts" },
  { destination: ".pi/agent/extensions/subagent/config.json", target: "harnesses/pi/specialists/policy.json" },
];

test("recorded upgrades add specialists without adopting model or unrelated extension settings", () => {
  const setup = installFixture();
  try {
    expect(setup.run().status).toBe(0);
    const recordFile = join(setup.home, ".local/state/ai-config/installation.json");
    const record = JSON.parse(readFileSync(recordFile, "utf8"));
    record.links = record.links.filter((link: { destination: string }) => !resources.some(resource => resource.destination === link.destination));
    writeFileSync(recordFile, JSON.stringify(record));
    for (const resource of resources) unlinkSync(join(setup.home, resource.destination));
    const settingsFile = join(setup.home, ".pi/agent/settings.json");
    const settings = { ...JSON.parse(readFileSync(settingsFile, "utf8")), defaultModel: "personal-model",
      extensions: ["personal-extension.ts"], subagents: { defaultModel: "personal-specialist-model" } };
    writeFileSync(settingsFile, JSON.stringify(settings));
    const installed = setup.run();
    expect(installed.status, installed.stderr).toBe(0);
    for (const resource of resources) {
      expect(readlinkSync(join(setup.home, resource.destination))).toBe(join(setup.source, resource.target));
      expect(JSON.parse(readFileSync(recordFile, "utf8")).links).toContainEqual(resource);
    }
    expect(JSON.parse(readFileSync(settingsFile, "utf8"))).toEqual(settings);
  } finally { setup.clean(); }
}, installerScenarioGuard(2));

for (const resource of resources) {
  test(`specialist installation refuses an unowned matching ${resource.destination}`, () => {
    const setup = installFixture();
    try {
      const file = join(setup.home, resource.destination);
      const content = readFileSync(join(setup.source, resource.target), "utf8");
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
      expect(setup.run().status).not.toBe(0);
      expect(readFileSync(file, "utf8")).toBe(content);
      expect(existsSync(join(setup.home, ".local/state/ai-config/installation.json"))).toBe(false);
    } finally { setup.clean(); }
  }, installerScenarioGuard(1));
}
