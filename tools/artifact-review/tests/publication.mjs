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

const EDITED_COMMENT = 'Please keep **this exact Markdown**.\n\n  Preserve this indentation and trailing space. ';

async function assertPrCommentPresentation(browser) {
  assert.equal(await browser.evaluate(`return document.querySelector('#artifact').contentDocument.querySelectorAll('[data-decision]').length;`), 0);
  assert.equal(await browser.evaluate("return !!document.querySelector('#publication');"), false);
  await eventually(() => browser.evaluate(`return document.querySelector('#artifact').contentDocument
    .querySelector('[data-publication-account]')?.textContent.includes('fixture-user');`));
  assert.deepEqual(await browser.evaluate(`const doc = document.querySelector('#artifact').contentDocument;
    return [...doc.querySelectorAll('[data-publication-comment]')].map(field => ({ populated: !!field.value, internalId: /\\bF[12]\\b/.test(field.value) }));`),
    [{ populated: true, internalId: false }, { populated: true, internalId: false }]);
  assert.equal(await browser.evaluate(`const doc = document.querySelector('#artifact').contentDocument;
    return doc.body.lastElementChild.matches('[data-publication-footer]') && doc.querySelector('[data-publication-publish]').disabled;`), true);
}

async function editAndRestoreComment(browser) {
  await browser.evaluate(`const doc = document.querySelector('#artifact').contentDocument;
    const field = doc.querySelector('[data-publication-comment="F1"]');
    field.value = ${JSON.stringify(EDITED_COMMENT)};
    field.dispatchEvent(new Event('input', { bubbles: true }));
    doc.querySelector('[data-publish-finding="F1"]').click(); return true;`);
  await browser.reload();
  await eventually(() => browser.evaluate(`const doc = document.querySelector('#artifact').contentDocument;
    return doc?.querySelector('[data-publication-comment="F1"]')?.value === ${JSON.stringify(EDITED_COMMENT)}
      && doc.querySelector('[data-publish-finding="F1"]').checked && !doc.querySelector('[data-publication-publish]').disabled;`));
}

async function assertDisplayedContextAndTargets(f, state) {
  const selection = await f.selection(['F1']);
  await writeFile(f.state, JSON.stringify({ ...state, actor: 92 }));
  assert.equal((await f.api('/publication/preview', selection)).status, 409);
  assert.equal((await f.provider()).posts, 0);
  await writeFile(f.state, JSON.stringify(state));
  const relocated = structuredClone(selection);
  relocated.comments[0].path = 'elsewhere.txt';
  relocated.comments[0].line = 99;
  assert.equal((await f.api('/publication/preview', relocated)).status, 400);
  assert.equal((await f.api('/publication/preview', { ...selection, head: '0'.repeat(40) })).status, 409);
  assert.equal((await f.provider()).posts, 0);
}

export function registerPublicationCases(firefox) {
  test('publication rejects account, revision, report and selection changes before mutation', { timeout: 30000 }, async t => {
    const f = await publicationFixture(t);
    const original = await readFile(f.report);
    const state = await f.provider();
    await assertDisplayedContextAndTargets(f, state);
    assert.equal((await f.api('/publication/preview', await f.selection(['F1', 'F1']))).status, 409);
    assert.equal((await f.api('/publication/preview', await f.selection(['F99']))).status, 409);
    assert.equal((await f.api('/publication/confirm', { token: 'a'.repeat(32) })).status, 409);
    assert.equal((await f.api('/publication/preview', await f.selection(['F1']), { Origin: 'https://foreign.invalid' })).status, 403);
    assert.equal((await f.api('/publication/preview', await f.selection(['F1']), { Authorization: 'Bearer wrong' })).status, 401);
    const response = await f.api('/publication/preview', await f.selection(['F1']));
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

  test('a finding without a verified inline location cannot fall back to a review-body comment', { timeout: 30000 }, async t => {
    const f = await publicationFixture(t, { line: 99 });
    const info = await (await f.api('/publication')).json();
    assert.equal(info.items[0].inline, false);
    assert.equal((await f.api('/publication/preview', await f.selection(['F1']))).status, 409);
    assert.equal((await f.provider()).posts, 0);
  });

  test('the publication route accepts all 50 bounded edited comments without truncation', { timeout: 30000 }, async t => {
    const f = await publicationFixture(t, { count: 50 });
    const selection = await f.selection(Array.from({ length: 50 }, (_, index) => `F${index + 1}`));
    const body = '\\'.repeat(8000);
    for (const comment of selection.comments) comment.body = body;
    assert.ok(Buffer.byteLength(JSON.stringify(selection)) > 128 * 1024);
    const prepared = await f.api('/publication/preview', selection);
    assert.equal(prepared.status, 200);
    const { token } = await prepared.json();
    assert.equal((await f.api('/publication/confirm', { token })).status, 200);
    const provider = await f.provider();
    assert.equal(provider.posts, 1);
    assert.equal(provider.reviews[0].comments.length, 50);
    assert.equal(provider.reviews[0].comments.every(comment => comment.body === body), true);
    assert.equal(provider.detail_reads, 50);
  });

  test('expired or altered signed previews cannot publish', { timeout: 30000 }, async t => {
    const f = await publicationFixture(t);
    const { token } = await (await f.api('/publication/preview', await f.selection(['F1']))).json();
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
    const first = await (await f.api('/publication/preview', await f.selection(['F1']))).json();
    const second = await (await f.api('/publication/preview', await f.selection(['F2']))).json();
    assert.equal((await f.api('/publication/confirm', { token: first.token })).status, 200);
    assert.equal((await f.api('/publication/confirm', { token: second.token })).status, 409);
    assert.equal((await f.provider()).posts, 1);
    assert.equal((await f.api('/publication/confirm', { token: first.token })).status, 200);
    assert.equal((await f.provider()).posts, 1);
  });

  test('a lost publication response reconciles the same attempt without a second post', { timeout: 30000 }, async t => {
    const f = await publicationFixture(t);
    await writeFile(f.state, JSON.stringify({ ...await f.provider(), lose: true }));
    const response = await f.api('/publication/preview', await f.selection(['F1']));
    assert.equal(response.status, 200);
    const { token } = await response.json();
    assert.equal((await f.api('/publication/confirm', { token })).status, 409);
    assert.equal((await f.provider()).posts, 1);
    assert.equal((await (await f.api('/publication')).json()).status, 'uncertain');
    for (const detail of [{ id: 999 }, { pull_request_review_id: 999 }, { original_line: 99 },
      { side: 'LEFT' }, { path: 'elsewhere.txt' }, { body: 'Altered comment' }, { original_commit_id: '0'.repeat(40) }]) {
      await writeFile(f.state, JSON.stringify({ ...await f.provider(), detail }));
      assert.equal((await f.api('/publication/reconcile', {})).status, 409);
      assert.equal((await f.provider()).posts, 1);
    }
    await writeFile(f.state, JSON.stringify({ ...await f.provider(), detail: {} }));
    const reconciled = await f.api('/publication/reconcile', {});
    assert.equal(reconciled.status, 200);
    assert.equal((await reconciled.json()).status, 'posted');
    assert.equal((await f.provider()).posts, 1);
    assert.equal((await f.api('/publication/confirm', { token })).status, 200);
    assert.equal((await f.provider()).posts, 1);
  });

  test('migrated PR history never displays repair authorization or selects publication comments', { timeout: 30000 }, async t => {
    const f = await publicationFixture(t, { legacyHistory: true });
    const before = await f.cli('poll', f.report, '--timeout', '0');
    const browser = await firefox(t);
    try {
      const { port, capability } = f.descriptor;
      await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
      await eventually(() => browser.evaluate("return document.querySelectorAll('#messages .message strong').length === 1;"));
      assert.equal(await browser.evaluate("return document.querySelector('#messages .message strong').textContent;"),
        'F1 · Historical PR acceptance — no repair authority');
      await assertPrCommentPresentation(browser);
      assert.equal(await browser.evaluate(`return [...document.querySelector('#artifact').contentDocument
        .querySelectorAll('[data-publish-finding]')].some(input => input.checked);`), false);
      assert.equal((await f.provider()).posts, 0);
      assert.deepEqual((await f.cli('poll', f.report, '--timeout', '0')).events, before.events);
    } finally { await browser.close(); }
  });

  test('PR comments are editable inline and published verbatim by one final human action', { timeout: 30000 }, async t => {
    const f = await publicationFixture(t);
    const original = await readFile(f.report);
    const browser = await firefox(t);
    try {
      const { port, capability } = f.descriptor;
      await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
      await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').dataset.revision;"));
      await assertPrCommentPresentation(browser);
      await editAndRestoreComment(browser);
      assert.equal((await f.provider()).posts, 0);
      await browser.evaluate(`document.querySelector('#artifact').contentDocument.querySelector('[data-publication-publish]').click(); return true;`);
      await eventually(async () => (await f.provider()).posts === 1);
      await eventually(() => browser.evaluate(`return document.querySelector('#artifact').contentDocument
        .querySelector('[data-publication-status]').textContent.includes('Published');`));
      const provider = await f.provider();
      assert.equal(provider.reviews[0].event, 'COMMENT');
      assert.deepEqual(provider.reviews[0].comments, [{ path: 'source.txt', line: 1, side: 'RIGHT', body: EDITED_COMMENT }]);
      const decisions = await f.cli('poll', f.report, '--timeout', '0');
      assert.equal(decisions.status, 'open');
      assert.equal(decisions.finding_review.publication_only, true);
      assert.deepEqual(decisions.finding_review.items.map(item => item.decision), [null, null]);
      await browser.reload();
      await eventually(() => browser.evaluate(`return !!document.querySelector('#artifact').contentDocument
        ?.querySelector('[data-publication-status]')?.textContent.includes('Published');`));
      assert.equal((await f.provider()).posts, 1);
      assert.equal(await browser.evaluate("return document.querySelector('#message').disabled;"), false);
      assert.deepEqual(await readFile(f.report), original);
    } finally { await browser.close(); }
  });
}
