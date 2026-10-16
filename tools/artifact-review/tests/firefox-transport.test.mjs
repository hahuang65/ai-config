import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requester } from './firefox-transport.mjs';

function socket() {
  const peer = new EventTarget();
  peer.send = () => {};
  return peer;
}

test('Firefox timeout identifies the pending method without exposing its parameters', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const request = requester(socket());
  const pending = request('script.evaluate', { expression: 'private fixture content' });
  const rejected = assert.rejects(pending, { message: 'Firefox script.evaluate timed out' });
  t.mock.timers.tick(15000);
  await rejected;
});

test('Firefox cancellation rejects pending and future commands without waiting for their deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  const peer = socket();
  let sends = 0, failure;
  peer.send = () => { sends++; };
  const request = requester(peer, { signal: controller.signal });
  request('browser.createUserContext', {}).catch(error => { failure = error.message; });
  controller.abort(new Error('private cancellation reason'));
  await Promise.resolve();
  assert.equal(failure, 'Firefox browser.createUserContext cancelled');
  await assert.rejects(request('browsingContext.create', {}), { message: 'Firefox browsingContext.create cancelled' });
  t.mock.timers.tick(15000);
  assert.equal(sends, 1);
});

for (const [event, reason] of [['close', 'connection closed'], ['error', 'connection failed']]) {
  test(`Firefox socket ${event} rejects pending commands without retaining their timers`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const peer = socket();
    const request = requester(peer);
    const rejected = assert.rejects(request('browsingContext.navigate', { url: 'private fixture URL' }),
      { message: `Firefox browsingContext.navigate ${reason}` });
    peer.dispatchEvent(new Event(event));
    await rejected;
    await assert.rejects(request('script.evaluate', {}), { message: `Firefox script.evaluate ${reason}` });
    t.mock.timers.tick(15000);
  });
}
