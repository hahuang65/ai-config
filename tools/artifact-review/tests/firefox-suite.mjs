import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchFirefox } from './firefox.mjs';
import { openFirefoxContext } from './firefox-context.mjs';

export function firefoxSuite({ launch = launchFirefox } = {}) {
  let root, startup, stopping, stage = 'profile preparation';
  const lifetime = new AbortController();
  const state = { active: false, closed: false, failed: false };
  const available = () => {
    if (state.closed || state.failed) throw new Error('Firefox suite is unavailable');
  };
  const start = async () => {
    root = await mkdtemp(join(tmpdir(), 'artifact-review-firefox-suite-'));
    available();
    return launch(root, { signal: lifetime.signal, onStage: name => { stage = name; } });
  };
  const stop = () => stopping ??= (async () => {
    lifetime.abort();
    try { await (await startup?.catch(() => undefined))?.close(); }
    finally { if (root) await rm(root, { recursive: true, force: true }); }
  })();
  return {
    async open(context = {}) {
      const { signal } = context;
      available();
      if (signal?.aborted) throw new Error('Firefox case cancelled');
      if (state.active) throw new Error('Firefox cases must run serially');
      state.active = true;
      const detach = cancelCase(context, state, stop, () => stage);
      try {
        const browser = await (startup ??= start());
        available();
        const request = (method, params) => {
          available(); stage = method;
          return browser.request(method, params);
        };
        const page = await openFirefoxContext({ ...browser, request });
        available();
        return managedPage(page, state, stop, detach);
      } catch (error) {
        state.failed = true;
        detach();
        try { await stop(); } finally { state.active = false; }
        if (signal?.aborted) throw new Error('Firefox case cancelled');
        throw error;
      }
    },
    close() { state.closed = true; return stop(); },
  };
}

function cancelCase(context, state, stop, stage) {
  const cancel = () => {
    state.failed = true;
    void stop().catch(() => {});
    context.diagnostic?.(`Firefox case cancelled; last stage: ${stage()}`);
  };
  context.signal?.addEventListener('abort', cancel, { once: true });
  return () => context.signal?.removeEventListener('abort', cancel);
}

function managedPage(page, state, stop, detach) {
  let closing;
  return {
    ...page,
    close: () => closing ??= (async () => {
      try {
        if (state.failed || state.closed) await stop();
        else await page.close();
      }
      catch (error) { state.failed = true; await stop(); throw error; }
      finally { detach(); state.active = false; }
    })(),
  };
}
