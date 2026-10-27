import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { installFixture, installerScenarioGuard } from "./fixtures/install-script";

const destination = ".pi/agent/extensions/worklog.ts";
const target = "harnesses/pi/worklog.bundle.ts";

test("recorded upgrades add Worklog capture without changing personal settings or extensions", () => {
  const setup = installFixture();
  try {
    const initial = setup.run();
    expect(initial.status, initial.stderr).toBe(0);
    const recordFile = join(setup.home, ".local/state/ai-config/installation.json");
    const record = JSON.parse(readFileSync(recordFile, "utf8"));
    expect(record.links).toContainEqual({ destination, target });
    record.links = record.links.filter((link: { destination: string }) => link.destination !== destination);
    writeFileSync(recordFile, JSON.stringify(record));
    unlinkSync(join(setup.home, destination));
    const settingsFile = join(setup.home, ".pi/agent/settings.json");
    const settings = { ...JSON.parse(readFileSync(settingsFile, "utf8")), defaultModel: "personal",
      defaultTools: ["read"], extensions: ["./extensions/personal.ts"] };
    writeFileSync(settingsFile, JSON.stringify(settings));
    const personal = join(setup.home, ".pi/agent/extensions/personal.ts");
    writeFileSync(personal, "export default function () {}\n");
    const result = setup.run();
    expect(result.status, result.stderr).toBe(0);
    expect(readlinkSync(join(setup.home, destination))).toBe(join(setup.source, target));
    expect(JSON.parse(readFileSync(settingsFile, "utf8"))).toEqual(settings);
    expect(readFileSync(personal, "utf8")).toBe("export default function () {}\n");
    expect(JSON.parse(readFileSync(recordFile, "utf8")).links).toContainEqual({ destination, target });
  } finally { setup.clean(); }
}, installerScenarioGuard(2));

test("the installer refuses an unowned matching Worklog extension instead of adopting it", () => {
  const setup = installFixture();
  try {
    const file = join(setup.home, destination);
    const content = readFileSync(join(setup.source, target), "utf8");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    expect(setup.run().status).not.toBe(0);
    expect(readFileSync(file, "utf8")).toBe(content);
    expect(existsSync(join(setup.home, ".local/state/ai-config/installation.json"))).toBe(false);
  } finally { setup.clean(); }
}, installerScenarioGuard(1));
