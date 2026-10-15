import { expect, test } from "bun:test";
import { existsSync, lstatSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installFixture } from "./fixtures/install-script";

test("shell installation retires only recorded old command aliases, including dangling links", () => {
  const setup = installFixture();
  try {
    // Exercise the macOS system find as well: GNU findutils is not a dependency.
    if (process.platform === "darwin") symlinkSync("/usr/bin/find", join(setup.bin, "find"));
    expect(setup.run().status).toBe(0);
    const record = join(setup.home, ".local/state/ai-config/installation.json");
    const owned = JSON.parse(readFileSync(record, "utf8"));
    const review = owned.links.find((link: { destination: string }) => link.destination === ".local/bin/review-change");
    review.destination = ".local/bin/review-change-eval";
    review.target = "tools/evaluation/target/release/review-change-eval";
    owned.links.push({ destination: ".local/bin/artifact-review", target: "tools/artifact-review/target/release/artifact-review" });
    unlinkSync(join(setup.home, ".local/bin/review-change"));
    for (const link of owned.links.filter((link: { destination: string }) =>
      [".local/bin/review-change-eval", ".local/bin/artifact-review"].includes(link.destination))) {
      symlinkSync(join(setup.source, link.target), join(setup.home, link.destination));
      expect(lstatSync(join(setup.home, link.destination)).isSymbolicLink()).toBe(true);
      expect(existsSync(join(setup.home, link.destination))).toBe(false);
    }
    writeFileSync(record, JSON.stringify(owned));
    const personal = join(setup.home, ".local/bin/personal");
    symlinkSync("/unrelated/personal-tool", personal);
    const result = setup.run();
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
    for (const name of ["review-change-eval", "artifact-review", "consult", "review-artifact"]) {
      expect(() => lstatSync(join(setup.home, ".local/bin", name))).toThrow();
    }
    expect(readlinkSync(join(setup.home, ".local/bin/review-change")))
      .toBe(join(setup.source, "tools/evaluation/target/release/review-change"));
    expect(readlinkSync(personal)).toBe("/unrelated/personal-tool");
  } finally { setup.clean(); }
}, 30_000);
