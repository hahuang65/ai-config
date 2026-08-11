import { afterAll, beforeAll } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { startFirefoxBidiPool } from "./firefox-bidi";

const MAC_FIREFOX = "/Applications/Firefox.app/Contents/MacOS/firefox";
const FIREFOX = Bun.which("firefox") ?? (existsSync(MAC_FIREFOX) ? MAC_FIREFOX : null);
const TEST_TIMEOUT_MS = 20_000;
if (!FIREFOX) throw new Error("Firefox is required for review-artifact browser evidence");

export let changeBrowserPool: Awaited<ReturnType<typeof startFirefoxBidiPool>>;
let browserPoolDirectory: string;

beforeAll(async () => {
  browserPoolDirectory = await mkdtemp(path.join(tmpdir(), "review-artifact-change-pool-"));
  changeBrowserPool = await startFirefoxBidiPool({
    executable: FIREFOX,
    profile: path.join(browserPoolDirectory, "firefox-profile"),
  });
}, TEST_TIMEOUT_MS);

afterAll(async () => {
  try {
    await changeBrowserPool?.close();
  } finally {
    await rm(browserPoolDirectory, { recursive: true, force: true });
  }
}, TEST_TIMEOUT_MS);
