import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { firefoxSuite } from './firefox-suite.mjs';

const RUNNER_GUARD_MS = 5000;

function backend({ fail = '', retainContext = false } = {}) {
  let sequence = 0;
  const users = new Set(['default']);
  const tabs = new Map();
  const calls = [];
  const state = { stops: 0, calls };
  return {
    state,
    processId: 123,
    close: async () => { state.stops++; },
    request: async (method, params) => {
      calls.push(method);
      if (method === fail) throw new Error('synthetic protocol failure');
      if (method === 'browser.createUserContext') {
        const userContext = `user-${++sequence}`;
        users.add(userContext);
        return { userContext };
      }
      if (method === 'browsingContext.create') {
        const context = `tab-${++sequence}`;
        tabs.set(context, { context, userContext: params.userContext, url: 'about:blank' });
        return { context };
      }
      if (method === 'browser.removeUserContext' && !retainContext) {
        users.delete(params.userContext);
        for (const [id, tab] of tabs) if (tab.userContext === params.userContext) tabs.delete(id);
      }
      if (method === 'browsingContext.getTree') return { contexts: [...tabs.values()] };
      if (method === 'browser.getUserContexts') return { userContexts: [...users].map(userContext => ({ userContext })) };
      return {};
    },
  };
}

test('a Node case watchdog cancels Firefox acquisition without a serial-overlap cascade', async () => {
  const fixture = fileURLToPath(new URL('./firefox-timeout.fixture.mjs', import.meta.url));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // This is an independent runner, not a child using its parent's test IPC.
  const run = promisify(execFile)(process.execPath, ['--test', '--test-reporter=tap', fixture],
    { env, timeout: RUNNER_GUARD_MS, maxBuffer: 64 * 1024 });
  await assert.rejects(run, error => {
    assert.equal(error.code, 1, 'only the deliberately cancelled case may fail');
    assert.match(error.stdout, /test timed out after 1000ms/);
    assert.match(error.stdout, /# pass 1\n# fail 0\n# cancelled 1/);
    assert.match(error.stdout, /Firefox case cancelled; last stage: session.new/);
    assert.doesNotMatch(error.stdout + error.stderr, /must run serially|asynchronous activity/);
    return true;
  });
});

test('closing a Firefox suite during startup cannot issue late case commands', async t => {
  const started = Promise.withResolvers(), ready = Promise.withResolvers();
  const browser = backend();
  const suite = firefoxSuite({ launch: () => { started.resolve(); return ready.promise; } });
  t.after(() => suite.close());
  const opening = suite.open();
  await started.promise;
  const closing = suite.close();
  const rejected = assert.rejects(opening, /Firefox suite is unavailable/);
  ready.resolve(browser);
  await Promise.all([closing, rejected]);
  assert.deepEqual(browser.state.calls, []);
  assert.equal(browser.state.stops, 1);
});

test('cancelling an opening case aborts startup and makes the suite unavailable', async t => {
  const started = Promise.withResolvers(), ready = Promise.withResolvers();
  const controller = new AbortController();
  const browser = backend();
  let cancelled = false;
  const diagnostics = [];
  const suite = firefoxSuite({ launch: (_root, { signal, onStage } = {}) => {
    onStage?.('session.new');
    started.resolve();
    signal?.addEventListener('abort', () => {
      cancelled = true;
      ready.reject(new Error('Firefox startup cancelled'));
    }, { once: true });
    return ready.promise;
  } });
  t.after(async () => { ready.resolve(browser); await suite.close(); });
  const opening = suite.open({ signal: controller.signal, diagnostic: message => diagnostics.push(message) });
  opening.catch(() => {});
  await started.promise;
  controller.abort(new Error('private cancellation detail'));
  assert.equal(cancelled, true, 'the case must own cancellation before startup completes');
  await assert.rejects(opening, /Firefox .*cancelled/);
  await assert.rejects(suite.open(), /Firefox suite is unavailable/);
  assert.deepEqual(browser.state.calls, []);
  assert.deepEqual(diagnostics, ['Firefox case cancelled; last stage: session.new']);
});

test('Firefox suite reuses one process, rejects overlap and makes case close idempotent', async t => {
  const browser = backend();
  let launches = 0, profile;
  const suite = firefoxSuite({ launch: async root => { launches++; profile = root; return browser; } });
  t.after(() => suite.close());
  const completed = new AbortController();
  const pending = suite.open({ signal: completed.signal });
  await assert.rejects(suite.open(), /must run serially/);
  const first = await pending;
  await first.close();
  const second = await suite.open();
  completed.abort();
  assert.equal(browser.state.stops, 0, 'a completed case must not cancel its successor');
  await first.close();
  await assert.rejects(suite.open(), /must run serially/);
  assert.equal(launches, 1);
  assert.equal(first.processId, second.processId);
  assert.equal(browser.state.calls.filter(method => method === 'browser.createUserContext').length, 2);
  await second.close();
  await suite.close();
  await suite.close();
  assert.equal(browser.state.stops, 1);
  await assert.rejects(access(profile), { code: 'ENOENT' });
  await assert.rejects(suite.open(), /unavailable/);
});

test('a cancelled active case closes through process cleanup without more protocol commands', async t => {
  const controller = new AbortController();
  const browser = backend();
  const suite = firefoxSuite({ launch: async () => browser });
  t.after(() => suite.close());
  const page = await suite.open({ signal: controller.signal });
  const calls = [...browser.state.calls];
  controller.abort();
  await page.close();
  assert.deepEqual(browser.state.calls, calls);
  assert.equal(browser.state.stops, 1);
  await assert.rejects(suite.open(), /Firefox suite is unavailable/);
});

test('cancellation during context creation rejects late setup instead of issuing another command', async t => {
  const creating = Promise.withResolvers(), ready = Promise.withResolvers();
  const controller = new AbortController();
  const browser = backend();
  const request = browser.request;
  browser.request = async (method, params) => {
    if (method === 'browser.createUserContext') { creating.resolve(); await ready.promise; }
    return request(method, params);
  };
  const suite = firefoxSuite({ launch: async () => browser });
  t.after(async () => { ready.resolve(); await suite.close(); });
  const opening = suite.open({ signal: controller.signal });
  opening.catch(() => {});
  await creating.promise;
  controller.abort();
  await assert.rejects(suite.open(), /Firefox suite is unavailable/);
  ready.resolve();
  await assert.rejects(opening, /Firefox case cancelled/);
  assert.deepEqual(browser.state.calls, ['browser.createUserContext']);
  assert.equal(browser.state.stops, 1);
});

for (const fail of ['browser.createUserContext', 'browsingContext.create']) {
  test(`Firefox context setup failure (${fail}) stops the browser without retry`, async t => {
    const browser = backend({ fail });
    let launches = 0;
    const suite = firefoxSuite({ launch: async () => { launches++; return browser; } });
    t.after(() => suite.close());
    await assert.rejects(suite.open(), /synthetic protocol failure/);
    await assert.rejects(suite.open(), /unavailable/);
    assert.equal(launches, 1);
    assert.equal(browser.state.stops, 1);
  });
}

for (const options of [{ fail: 'browser.removeUserContext' }, { retainContext: true }]) {
  test(`Firefox cleanup failure (${JSON.stringify(options)}) stops the browser and forbids reuse`, async t => {
    const browser = backend(options);
    const suite = firefoxSuite({ launch: async () => browser });
    t.after(() => suite.close());
    const page = await suite.open();
    await assert.rejects(page.close(), /protocol failure|cleanup was incomplete/);
    await assert.rejects(page.close(), /protocol failure|cleanup was incomplete/);
    await assert.rejects(suite.open(), /unavailable/);
    assert.equal(browser.state.stops, 1);
  });
}
