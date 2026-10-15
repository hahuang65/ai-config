import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { installFixture } from "./fixtures/install-script";

async function ready(path: string) {
  const deadline = Date.now() + 15_000;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error("Installer did not reach the controlled transaction barrier");
    await sleep(20);
  }
}

test("a live installer holds the lock until its transaction ends and refuses a second process", async () => {
  const setup = installFixture();
  const marker = join(setup.temporary, "ready");
  const release = join(setup.temporary, "release");
  writeFileSync(join(setup.bin, "mv"), '#!/bin/bash\nif [[ $1 == --version ]]; then exec "$REAL_MV" "$@"; fi\nprintf ready > "$READY"\nwhile [[ ! -e $RELEASE ]]; do sleep 0.02; done\nexec "$REAL_MV" "$@"\n', { mode: 0o755 });
  const child = setup.launch({ REAL_MV: Bun.which("mv")!, READY: marker, RELEASE: release });
  const ended = new Promise<number | null>((resolve, reject) => {
    child.once("exit", resolve); child.once("error", reject);
  });
  child.stdout!.resume(); child.stderr!.resume();
  const timer = setTimeout(() => { if (child.pid) process.kill(-child.pid, "SIGKILL"); }, 25_000);
  try {
    await ready(marker);
    const lock = join(setup.home, ".local/state/ai-config/install.lock.d");
    const owner = readFileSync(join(lock, "workspace"), "utf8");
    const second = setup.run([], { REAL_MV: Bun.which("mv")!, READY: marker, RELEASE: release });
    expect(second.status).toBe(1);
    expect(second.stderr).toContain("Another installer is running");
    expect(readFileSync(join(lock, "workspace"), "utf8")).toBe(owner);
    expect(existsSync(join(setup.home, ".local/state/ai-config/installation.json"))).toBe(false);
    writeFileSync(release, "continue\n");
    expect(await ended).toBe(0);
    expect(existsSync(lock)).toBe(false);
    expect(existsSync(owner.trim())).toBe(false);
  } finally {
    clearTimeout(timer);
    if (child.pid) {
      try { process.kill(-child.pid, "SIGKILL"); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    await ended;
    setup.clean();
  }
}, 30_000);
