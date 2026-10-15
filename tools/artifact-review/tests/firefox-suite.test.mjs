import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { firefoxSuite } from './firefox-suite.mjs';

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

test('Firefox suite reuses one process, rejects overlap and makes case close idempotent', async t => {
  const browser = backend();
  let launches = 0, profile;
  const suite = firefoxSuite({ launch: async root => { launches++; profile = root; return browser; } });
  t.after(() => suite.close());
  const pending = suite.open();
  await assert.rejects(suite.open(), /must run serially/);
  const first = await pending;
  await first.close();
  const second = await suite.open();
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
