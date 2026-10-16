import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { firefoxSuite } from './firefox-suite.mjs';

// Deliberately cancelled child case: its parent verifies the failure and cleanup.
const CASE_GUARD_MS = 1000;
let cancelled = false;
const suite = firefoxSuite({ launch: (_root, { signal, onStage }) => {
  onStage('session.new');
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => {
      cancelled = true;
      reject(new Error('Firefox startup cancelled'));
    }, { once: true });
  });
} });
after(() => suite.close());

test('controlled Firefox case timeout', { timeout: CASE_GUARD_MS }, async t => {
  await suite.open(t);
});

test('the timed-out case leaves no reusable or overlapping suite', async () => {
  assert.equal(cancelled, true);
  await assert.rejects(suite.open(), /Firefox suite is unavailable/);
});
