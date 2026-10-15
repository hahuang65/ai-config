import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stopProcessGroup, SHUTDOWN_GRACE_MS, SHUTDOWN_POLL_MS } from './firefox-process.mjs';

function fixture(goneAfter) {
  let elapsed = 0;
  const signals = [];
  return {
    signals,
    elapsed: () => elapsed,
    hooks: {
      now: () => elapsed,
      wait: async ms => { elapsed += ms; },
      signal: (pid, action) => {
        assert.equal(pid, -123);
        signals.push(action);
        if (action === 0 && elapsed >= goneAfter) {
          throw Object.assign(new Error('group exited'), { code: 'ESRCH' });
        }
      },
    },
  };
}

test('browser shutdown returns immediately when the process group is already gone', async () => {
  const f = fixture(0);
  await stopProcessGroup(123, f.hooks);
  assert.equal(f.elapsed(), 0);
  assert.deepEqual(f.signals, ['SIGTERM', 0]);
});

test('browser shutdown stops waiting when all group members exit during the grace period', async () => {
  const f = fixture(SHUTDOWN_POLL_MS * 2);
  await stopProcessGroup(123, f.hooks);
  assert.equal(f.elapsed(), SHUTDOWN_POLL_MS * 2);
  assert.equal(f.signals.includes('SIGKILL'), false);
});

test('browser shutdown still force-kills a surviving group after the full grace period', async () => {
  const f = fixture(Infinity);
  await stopProcessGroup(123, f.hooks);
  assert.equal(f.elapsed(), SHUTDOWN_GRACE_MS);
  assert.equal(f.signals.at(-1), 'SIGKILL');
});

test('permission errors probing a group are not mistaken for confirmed exit', async () => {
  const f = fixture(Infinity);
  const signal = f.hooks.signal;
  f.hooks.signal = (pid, action) => {
    signal(pid, action);
    if (action === 0) throw Object.assign(new Error('not permitted'), { code: 'EPERM' });
  };
  await stopProcessGroup(123, f.hooks);
  assert.equal(f.elapsed(), SHUTDOWN_GRACE_MS);
  assert.equal(f.signals.at(-1), 'SIGKILL');
});

test('a browser that never acquired a PID cannot signal another process group', async () => {
  const f = fixture(0);
  for (const pid of [undefined, 0, -1]) await stopProcessGroup(pid, f.hooks);
  assert.deepEqual(f.signals, []);
  assert.equal(f.elapsed(), 0);
});
