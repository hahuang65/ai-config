import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchFirefox } from './firefox.mjs';
import { openFirefoxContext } from './firefox-context.mjs';

export function firefoxSuite({ launch = launchFirefox } = {}) {
  let root, startup, stopping;
  const state = { active: false, closed: false, failed: false };
  const start = async () => {
    root = await mkdtemp(join(tmpdir(), 'artifact-review-firefox-suite-'));
    return launch(root);
  };
  const stop = () => stopping ??= (async () => {
    try { await (await startup?.catch(() => undefined))?.close(); }
    finally { if (root) await rm(root, { recursive: true, force: true }); }
  })();
  return {
    async open() {
      if (state.closed || state.failed) throw new Error('Firefox suite is unavailable');
      if (state.active) throw new Error('Firefox cases must run serially');
      state.active = true;
      try {
        const browser = await (startup ??= start());
        if (state.closed) throw new Error('Firefox suite is unavailable');
        const page = await openFirefoxContext(browser);
        if (state.closed) throw new Error('Firefox suite is unavailable');
        return managedPage(page, state, stop);
      } catch (error) {
        state.failed = true;
        try { await stop(); } finally { state.active = false; }
        throw error;
      }
    },
    close() { state.closed = true; return stop(); },
  };
}

function managedPage(page, state, stop) {
  let closing;
  return {
    ...page,
    close: () => closing ??= (async () => {
      try { await page.close(); }
      catch (error) { state.failed = true; await stop(); throw error; }
      finally { state.active = false; }
    })(),
  };
}
