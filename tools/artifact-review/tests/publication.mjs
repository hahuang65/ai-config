import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { publicationFixture } from './publication-fixture.mjs';

async function eventually(predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(20);
  }
  assert.fail('Expected publication browser state did not arrive');
}

export function registerPublicationCases(firefox) {
  test('publication rejects account, revision, report and selection changes before mutation', { timeout: 30000 }, async t => {
    const f = await publicationFixture(t);
    const original = await readFile(f.report);
    const state = await f.provider();
    assert.equal((await f.api('/publication/preview', { ids: ['F1', 'F1'] })).status, 409);
    assert.equal((await f.api('/publication/preview', { ids: ['F99'] })).status, 409);
    assert.equal((await f.api('/publication/confirm', { token: 'a'.repeat(32) })).status, 409);
    assert.equal((await f.api('/publication/preview', { ids: ['F1'] }, { Origin: 'https://foreign.invalid' })).status, 403);
    assert.equal((await f.api('/publication/preview', { ids: ['F1'] }, { Authorization: 'Bearer wrong' })).status, 401);
    const response = await f.api('/publication/preview', { ids: ['F1'] });
    assert.equal(response.status, 200);
    const { token } = await response.json();
    assert.equal((await f.api('/publication/confirm', { token, payload: { event: 'APPROVE' } })).status, 400);
    for (const patch of [{ actor: 92 }, { head: 'b'.repeat(40) }, { base: 'c'.repeat(40) }]) {
      await writeFile(f.state, JSON.stringify({ ...state, ...patch }));
      assert.equal((await f.api('/publication/confirm', { token })).status, 409);
      assert.equal((await f.provider()).posts, 0);
    }
    await writeFile(f.state, JSON.stringify(state));
    await writeFile(f.report, '<html><body>changed</body></html>');
    assert.equal((await f.api('/publication/confirm', { token })).status, 409);
    assert.equal((await f.provider()).posts, 0);
    await writeFile(f.report, original);
  });

  test('expired or altered signed previews cannot publish', { timeout: 30000 }, async t => {
    const f = await publicationFixture(t);
    const { token } = await (await f.api('/publication/preview', { ids: ['F1'] })).json();
    const directory = dirname(f.record);
    const name = `preview-${token}.json`;
    const file = join(directory, name);
    const original = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(file, JSON.stringify({ ...original, signature: Array(32).fill(0) }));
    assert.equal((await f.api('/publication/confirm', { token })).status, 409);
    // Simulate an authentic old preview using only this disposable fixture's key.
    const payload = JSON.stringify({ ...JSON.parse(original.payload), expires: 0 });
    const key = await readFile(join(dirname(directory), 'signing-key'));
    const signature = [...createHmac('sha256', key).update(basename(directory)).update(name).update(payload).digest()];
    await writeFile(file, JSON.stringify({ payload, signature }));
    assert.equal((await f.api('/publication/confirm', { token })).status, 409);
    assert.equal((await f.provider()).posts, 0);
  });

  test('another preview cannot claim success for a different selected publication', { timeout: 30000 }, async t => {
    const f = await publicationFixture(t);
    const first = await (await f.api('/publication/preview', { ids: ['F1'] })).json();
    const second = await (await f.api('/publication/preview', { ids: ['F2'] })).json();
    assert.equal((await f.api('/publication/confirm', { token: first.token })).status, 200);
    assert.equal((await f.api('/publication/confirm', { token: second.token })).status, 409);
    assert.equal((await f.provider()).posts, 1);
    assert.equal((await f.api('/publication/confirm', { token: first.token })).status, 200);
    assert.equal((await f.provider()).posts, 1);
  });

  test('a lost publication response reconciles the same attempt without a second post', { timeout: 30000 }, async t => {
    const f = await publicationFixture(t);
    await writeFile(f.state, JSON.stringify({ ...await f.provider(), lose: true }));
    const response = await f.api('/publication/preview', { ids: ['F1'] });
    assert.equal(response.status, 200);
    const { token } = await response.json();
    assert.equal((await f.api('/publication/confirm', { token })).status, 409);
    assert.equal((await f.provider()).posts, 1);
    assert.equal((await (await f.api('/publication')).json()).status, 'uncertain');
    const reconciled = await f.api('/publication/reconcile', {});
    assert.equal(reconciled.status, 200);
    assert.equal((await reconciled.json()).status, 'posted');
    assert.equal((await f.provider()).posts, 1);
    assert.equal((await f.api('/publication/confirm', { token })).status, 200);
    assert.equal((await f.provider()).posts, 1);
  });

  test('browser publication requires its own exact preview and human confirmation', { timeout: 30000 }, async t => {
    const f = await publicationFixture(t);
    const original = await readFile(f.report);
    const browser = await firefox(t);
    try {
      const { port, capability } = f.descriptor;
      await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
      await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').dataset.revision;"));
      assert.equal(await browser.evaluate("return !!document.querySelector('#publication-preview');"), true);
      await eventually(() => browser.evaluate("return !document.querySelector('#publication-preview').disabled;"));
      assert.equal((await f.provider()).posts, 0);
      await browser.evaluate("document.querySelector('[data-publish-finding=F2]').click(); document.querySelector('#publication-preview').click(); return true;");
      await eventually(() => browser.evaluate("return !document.querySelector('#publication-confirm').disabled;"));
      const preview = await browser.evaluate("return document.querySelector('#publication-request').textContent;");
      assert.match(preview, /fixture-user/);
      assert.match(preview, /github.com\/fixture\/repo\/pull\/7/);
      assert.match(preview, /COMMENT/);
      assert.match(preview, /F1/);
      assert.doesNotMatch(preview, /Second finding/);
      assert.equal((await f.provider()).posts, 0);
      await browser.evaluate("document.querySelector('#publication-confirm').click(); return true;");
      await eventually(async () => (await f.provider()).posts === 1);
      await eventually(() => browser.evaluate("return document.querySelector('#publication-status').textContent.includes('Posted');"));
      const provider = await f.provider();
      assert.equal(provider.reviews[0].event, 'COMMENT');
      assert.equal(provider.reviews[0].comments.length, 1);
      const decisions = await f.cli('poll', f.report, '--timeout', '0');
      assert.deepEqual(decisions.finding_review.items.map(item => item.decision), [null, null]);
      await browser.reload();
      await eventually(() => browser.evaluate("return document.querySelector('#publication-status').textContent.includes('Posted');"));
      assert.equal((await f.provider()).posts, 1);
      assert.deepEqual(await readFile(f.report), original);
    } finally { await browser.close(); }
  });
}
