import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// Failure watchdogs, not successful-path sleeps; see test/timings.md.
const ACTIVITY_GUARD_MS = 3000;
const CASE_GUARD_MS = 15000;

function page(_request, response) {
  response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
  response.end('<!doctype html><title>Isolated fixture</title><body>Fixture</body>');
}

async function origin(t, handler = page) {
  const server = createServer(handler);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

export function registerFirefoxIsolationCases(suite) {
  registerStorageCase(suite);
  registerBackgroundCase(suite);
}

async function observe(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Firefox background activity did not transition')), ACTIVITY_GUARD_MS);
    })]);
  } finally { clearTimeout(timer); }
}

function registerBackgroundCase(suite) {
  test('closing a Firefox case removes extra tabs and stops a live worker request', { timeout: CASE_GUARD_MS }, async t => {
    const connected = Promise.withResolvers(), disconnected = Promise.withResolvers();
    const url = await origin(t, (request, response) => {
      if (request.url === '/worker.js') {
        response.writeHead(200, { 'Content-Type': 'text/javascript' });
        response.end("fetch('/stream').then(response => response.text());");
      } else if (request.url === '/stream') {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.write('live');
        response.once('close', disconnected.resolve);
        connected.resolve();
      } else page(request, response);
    });
    const browser = await suite.open();
    t.after(() => browser.close());
    await browser.navigate(url);
    await browser.openTab();
    assert.equal((await browser.contexts()).length, 2);
    await browser.evaluate("globalThis.worker = new Worker('/worker.js'); return true;");
    await observe(connected.promise);
    await browser.close();
    await observe(disconnected.promise);
    await assert.rejects(browser.evaluate('return true;'), /Firefox case is closed/);
    const next = await suite.open();
    t.after(() => next.close());
    assert.equal(next.processId, browser.processId);
    assert.equal((await next.contexts()).length, 1);
  });
}

function registerStorageCase(suite) {
  test('shared Firefox isolates same-origin storage and resets the viewport between cases', { timeout: CASE_GUARD_MS }, async t => {
    const url = await origin(t);
    const first = await suite.open();
    t.after(() => first.close());
    await first.navigate(url);
    await first.narrow();
    await first.evaluate(`
      document.cookie = 'fixture=first; Path=/';
      localStorage.setItem('fixture', 'first');
      sessionStorage.setItem('fixture', 'first');
      globalThis.fixtureMarker = 'first';
      const cache = await caches.open('fixture');
      await cache.put('/cached', new Response('first'));
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('fixture', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('entries');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => { request.result.close(); resolve(); };
      });
      return true;
    `);
    assert.equal(await first.evaluate("return (await caches.keys()).includes('fixture') && (await indexedDB.databases()).some(db => db.name === 'fixture');"), true);
    await first.close();
    const second = await suite.open();
    t.after(() => second.close());
    assert.ok(Number.isSafeInteger(first.processId));
    assert.equal(second.processId, first.processId, 'cases must share the browser process');
    await second.navigate(url);
    assert.deepEqual(await second.evaluate(`return {
      cookie: document.cookie, local: localStorage.getItem('fixture'),
      session: sessionStorage.getItem('fixture'), marker: globalThis.fixtureMarker ?? null,
      caches: await caches.keys(), databases: (await indexedDB.databases()).map(db => db.name),
      width: innerWidth, height: innerHeight,
    };`), { cookie: '', local: null, session: null, marker: null, caches: [], databases: [], width: 1280, height: 900 });
  });
}
