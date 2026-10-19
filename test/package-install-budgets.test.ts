import { expect, test } from "bun:test";
import { INSTALL_COMMAND_GUARD_MS, installerScenarioGuard } from "./fixtures/install-script";

test("installer scenarios compose the temporary one-minute invocation limit", () => {
  expect(INSTALL_COMMAND_GUARD_MS).toBe(60_000);
  for (const [transactions, budget] of [[1, 120_000], [2, 180_000], [3, 240_000], [5, 360_000]]) {
    expect(installerScenarioGuard(transactions)).toBe(budget);
    expect(installerScenarioGuard(transactions) - transactions * INSTALL_COMMAND_GUARD_MS)
      .toBe(INSTALL_COMMAND_GUARD_MS);
  }
});
