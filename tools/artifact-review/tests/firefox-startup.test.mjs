import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchFirefox } from './firefox.mjs';

test('Firefox launch honors an override, uses Linux PATH, and retains the macOS application fallback', async t => {
  const root = await mkdtemp(join(tmpdir(), 'firefox-platform-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [platform, env, expected] of [
    ['linux', {}, 'firefox'],
    ['darwin', {}, '/Applications/Firefox.app/Contents/MacOS/firefox'],
    ['linux', { FIREFOX_BIN: '/fixture browser/firefox' }, '/fixture browser/firefox'],
  ]) {
    let executable;
    const child = Object.assign(new EventEmitter(), { stderr: new PassThrough() });
    await assert.rejects(launchFirefox(root, {
      platform, env,
      spawnProcess: command => {
        executable = command;
        setImmediate(() => child.emit('error', new Error('fixture launch stopped')));
        return child;
      },
      stop: async () => {},
    }), { message: 'Firefox endpoint discovery failed' });
    assert.equal(executable, expected);
  }
});

test('cancelling Firefox endpoint discovery stops its process before the startup deadline', async t => {
  const root = await mkdtemp(join(tmpdir(), 'firefox-startup-cancel-'));
  const child = Object.assign(new EventEmitter(), { pid: 123, stderr: new PassThrough() });
  const controller = new AbortController();
  const started = Promise.withResolvers();
  let stops = 0, failure;
  const opening = launchFirefox(root, {
    signal: controller.signal,
    spawnProcess: () => { started.resolve(); return child; },
    stop: async pid => { assert.equal(pid, 123); stops++; },
  });
  opening.catch(error => { failure = error.message; });
  t.after(async () => {
    child.emit('exit', 0);
    await opening.catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  await started.promise;
  controller.abort(new Error('private abort reason'));
  await new Promise(setImmediate);
  assert.equal(stops, 1);
  assert.equal(failure, 'Firefox endpoint discovery cancelled');
  await assert.rejects(opening, { message: failure });
  assert.equal(child.stderr.listenerCount('data'), 0);
  assert.equal(child.listenerCount('exit'), 0);
});

test('cancelling a Firefox connection attempt closes the socket and stops its process', async t => {
  const root = await mkdtemp(join(tmpdir(), 'firefox-connection-cancel-'));
  const child = Object.assign(new EventEmitter(), { pid: 123, stderr: new PassThrough() });
  const peer = new EventTarget();
  const spawned = Promise.withResolvers(), connecting = Promise.withResolvers();
  const controller = new AbortController();
  let stops = 0, closes = 0, failure;
  peer.close = () => { closes++; };
  const opening = launchFirefox(root, {
    signal: controller.signal,
    spawnProcess: () => { spawned.resolve(); return child; },
    createSocket: () => { connecting.resolve(); return peer; },
    stop: async () => { stops++; },
  });
  opening.catch(error => { failure = error.message; });
  t.after(async () => {
    controller.abort();
    await opening.catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  await spawned.promise;
  child.stderr.write('WebDriver BiDi listening on ws://127.0.0.1:1');
  await connecting.promise;
  controller.abort();
  await new Promise(setImmediate);
  assert.equal(failure, 'Firefox connection cancelled');
  await assert.rejects(opening, { message: failure });
  assert.equal(stops, 1);
  assert.equal(closes, 1);
});
