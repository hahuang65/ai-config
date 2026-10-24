import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { installFixture, installerScenarioGuard } from "./fixtures/install-script";

const destination = ".pi/agent/extensions/ask-user-question.ts";
const target = "harnesses/pi/ask-user-question.bundle.ts";

test("a recorded installation adds the Pi question extension without taking personal settings or extensions", () => {
  const setup = installFixture();
  try {
    const initial = setup.run();
    expect(initial.status, initial.stderr).toBe(0);
    const recordFile = join(setup.home, ".local/state/ai-config/installation.json");
    const record = JSON.parse(readFileSync(recordFile, "utf8"));
    record.links = record.links.filter((link: { destination: string }) => link.destination !== destination);
    writeFileSync(recordFile, JSON.stringify(record));
    unlinkSync(join(setup.home, destination));
    const settingsFile = join(setup.home, ".pi/agent/settings.json");
    const settings = { ...JSON.parse(readFileSync(settingsFile, "utf8")), defaultModel: "personal-model",
      extensions: ["./extensions/personal-extension.ts"], defaultTools: ["read"] };
    writeFileSync(settingsFile, JSON.stringify(settings));
    const personal = join(setup.home, ".pi/agent/extensions/personal-extension.ts");
    writeFileSync(personal, "export default function () {}\n");
    const upgraded = setup.run();
    expect(upgraded.status, upgraded.stderr).toBe(0);
    expect(readlinkSync(join(setup.home, destination))).toBe(join(setup.source, target));
    expect(JSON.parse(readFileSync(settingsFile, "utf8"))).toEqual(settings);
    expect(readFileSync(personal, "utf8")).toBe("export default function () {}\n");
    expect(JSON.parse(readFileSync(recordFile, "utf8")).links).toContainEqual({ destination, target });
  } finally { setup.clean(); }
}, installerScenarioGuard(2));

test("installation refuses an unowned question extension even when its bytes match the bundle", () => {
  const setup = installFixture();
  try {
    const file = join(setup.home, destination);
    const content = readFileSync(join(setup.source, target), "utf8");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    const result = setup.run();
    expect(result.status).not.toBe(0);
    expect(readFileSync(file, "utf8")).toBe(content);
    expect(existsSync(join(setup.home, ".local/state/ai-config/installation.json"))).toBe(false);
  } finally { setup.clean(); }
}, installerScenarioGuard(1));
