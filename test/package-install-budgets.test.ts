import { expect, test } from "bun:test";
import { INSTALL_COMMAND_GUARD_MS, installerScenarioGuard } from "./fixtures/install-script";

test("installer scenarios budget sequential transactions without extending each invocation", () => {
  expect(INSTALL_COMMAND_GUARD_MS).toBe(30_000);
  for (const [transactions, budget] of [[1, 60_000], [2, 90_000], [3, 120_000], [5, 180_000]]) {
    expect(installerScenarioGuard(transactions)).toBe(budget);
    expect(installerScenarioGuard(transactions) - transactions * INSTALL_COMMAND_GUARD_MS)
      .toBe(INSTALL_COMMAND_GUARD_MS);
  }
});
