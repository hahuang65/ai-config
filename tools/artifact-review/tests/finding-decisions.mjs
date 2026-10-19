import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fixture, execute, changeBinary, modelServer, configureModel, repository, calls, answer } from '../../../test/fixtures/reviewer.mjs';

const artifactBinary = resolve(import.meta.dirname, '../target/debug/review-artifact');
const STATE_GUARD_MS = 10000;
const STATE_POLL_MS = 20;

async function eventually(predicate) {
  const deadline = Date.now() + STATE_GUARD_MS;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(STATE_POLL_MS);
  }
  assert.fail('Expected finding-review browser state did not arrive');
}

async function reportFixture(t) {
  const f = fixture(root => t.after(() => rm(root, { recursive: true, force: true })));
  const repo = await repository(f);
  const proposed = JSON.parse(answer);
  proposed.findings.push({ ...proposed.findings[0], title: 'Second finding' },
    { ...proposed.findings[0], title: 'Third finding — comment left empty' });
  const { server } = modelServer(f.root, { answer: JSON.stringify(proposed), calls: calls(['scope.json', 'patch.diff'].map(path => ['read', { path }])) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    configureModel(f.profile, server.address().port);
    const { stdout } = await execute(changeBinary, ['--root', f.evaluation, 'review', 'range', 'HEAD~1..HEAD', '--repo', repo,
      '--intent', 'Replace before with after', '--provider', 'reviewer-fixture', '--model', 'fixture-model', '--thinking', 'off', '--json'],
    { cwd: f.root, env: f.env, timeout: 20000, maxBuffer: 1024 * 1024 });
    const receipt = JSON.parse(stdout);
    const cli = async (...args) => JSON.parse((await execute(artifactBinary, args,
      { env: { ...f.env, AR_ROOT: join(f.root, 'reviews') }, timeout: 15000, maxBuffer: 1024 * 1024 })).stdout);
    return { ...f, ...receipt, cli };
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

async function acceptWithInterruptedDelivery(browser) {
  await browser.evaluate(`
    const doc = document.querySelector('#artifact').contentDocument;
    for (const [id, text] of [['F1', 'Keep this repair scoped to F1.'], ['F2', 'Do not alter the legacy behavior.']]) {
      const comment = doc.querySelector('#' + id + ' [data-finding-comment]');
      comment.value = text;
      comment.dispatchEvent(new Event('input', { bubbles: true }));
    }
    document.querySelector('#message').value = 'General review context.';
    document.querySelector('#message').dispatchEvent(new Event('input'));
    return true;
  `);
  await browser.reload();
  await eventually(() => browser.evaluate(`return document.querySelector('#artifact').contentDocument
    ?.querySelector('#F2 [data-finding-comment]')?.value === 'Do not alter the legacy behavior.';`));
  await browser.evaluate(`
    const original = window.fetch;
    let interrupt = true;
    window.fetch = async (url, options) => {
      const response = await original(url, options);
      if (url === '/submit' && interrupt) { interrupt = false; throw new Error('Simulated response loss'); }
      return response;
    };
    document.querySelector('#artifact').contentDocument.querySelector('#F1').click();
    document.querySelector('#annotation-comment').value='Repair this case without changing the API';
    document.querySelector('#artifact').contentDocument.querySelector('#F1 [data-decision="accept"]').click(); return true;
  `);
  await eventually(() => browser.evaluate("return !document.querySelector('#retry').hidden;"));
  await browser.reload();
  await eventually(() => browser.evaluate("return !document.querySelector('#retry').hidden;"));
  await browser.evaluate("document.querySelector('#retry').click(); return true;");
  await eventually(() => browser.evaluate("return document.querySelector('#retry').hidden && document.querySelector('#annotation-comment').value === '';"));
}

async function assertReportPresentation(browser) {
  assert.deepEqual(await browser.evaluate(`return { title: document.title, toolbar: document.querySelector('.toolbar strong').textContent };`),
    { title: 'Change review', toolbar: 'Change review' });
  assert.equal(await browser.evaluate("return document.querySelectorAll('[data-decision]').length;"), 0);
  assert.deepEqual(await browser.evaluate(`return [...document.querySelector('#artifact').contentDocument.querySelectorAll('[data-finding-controls]')]
    .map(row => ({ finding: row.dataset.finding, card: row.closest('article').id, buttons: row.querySelectorAll('[data-decision]').length,
      comment: !!row.querySelector('label textarea[data-finding-comment]:not([required])') }));`),
  ['F1', 'F2', 'F3'].map(id => ({ finding: id, card: id, buttons: 2, comment: true })));
  assert.deepEqual(await browser.evaluate(`const doc = document.querySelector('#artifact').contentDocument;
    return { heading:doc.querySelector('h1').textContent, leakedTitle:doc.body.innerText.includes('Change review · Pi evaluation') };`),
  { heading: 'Change review', leakedTitle: false });
  assert.equal(await browser.evaluate("return document.querySelector('#approve').hidden;"), true);
  assert.equal(await browser.evaluate("return document.querySelector('#artifact').contentDocument.querySelectorAll('img').length;"), 0);
}

export function registerFindingDecisionCases(firefox) {
  test('finding decisions authorize only accepted repairs through the real report and review shell', { timeout: 30000 }, async t => {
    const f = await reportFixture(t);
    const original = await readFile(f.report);
    let browser;
    try {
      await f.cli('open', f.report, '--findings', f.record, '--no-browser');
      const [directory] = await readdir(join(f.root, 'reviews'));
      const { port, capability } = JSON.parse(await readFile(join(f.root, 'reviews', directory, 'server.json'), 'utf8'));
      browser = await firefox(t);
      await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
      await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').dataset.revision;"));
      await assertReportPresentation(browser);
      await acceptWithInterruptedDelivery(browser);
      await eventually(async () => (await f.cli('poll', f.report, '--timeout', '0')).events.some(event => event.action === 'accept'));
      const partial = await f.cli('poll', f.report, '--timeout', '0');
      assert.equal(partial.status, 'open');
      assert.equal(await browser.evaluate("return document.querySelector('#submission-status').dataset.state;"), 'submitted');
      assert.equal(partial.events.length, 1);
      assert.equal(partial.events[0].finding, 'F1');
      assert.equal(partial.events[0].message, 'Finding F1 comment:\nKeep this repair scoped to F1.\n\nGeneral feedback:\nGeneral review context.');
      assert.equal(await browser.evaluate(`return document.querySelector('#artifact').contentDocument
        .querySelector('#F2 [data-finding-comment]').value;`), 'Do not alter the legacy behavior.');
      assert.equal(partial.events[0].annotations[0].comment, 'Repair this case without changing the API');
      assert.equal(partial.finding_review.items[1].decision, null);
      await eventually(() => browser.evaluate("return !document.querySelector('#artifact').contentDocument.querySelector('#F2 [data-decision=\"reject\"]').disabled;"));
      await browser.evaluate("document.querySelector('#artifact').contentDocument.querySelector('#F2 [data-decision=\"reject\"]').click(); return true;");
      await eventually(() => browser.evaluate(`return !document.querySelector('#artifact').contentDocument
        .querySelector('#F3 [data-decision="accept"]').disabled;`));
      await browser.evaluate(`document.querySelector('#artifact').contentDocument.querySelector('#F3 [data-decision="accept"]').click(); return true;`);
      await eventually(() => browser.evaluate("return document.body.dataset.status === 'decided';"));
      const finished = await f.cli('poll', f.report, '--timeout', '0');
      assert.deepEqual(finished.finding_review.items.map(item => item.decision), ['accept', 'reject', 'accept']);
      assert.equal(finished.events.length, 3);
      assert.equal(finished.events[1].message, 'Do not alter the legacy behavior.');
      assert.equal(finished.events[2].message, '');
      assert.equal(finished.finding_review.needs_review, false);
      assert.equal(await browser.evaluate("return document.querySelector('#submission-status strong').textContent;"), 'COMPLETED — All findings decided');
      await browser.reload();
      await eventually(() => browser.evaluate("return document.body.dataset.status === 'decided';"));
      await eventually(() => browser.evaluate("return document.querySelector('#artifact').contentDocument?.querySelectorAll('[data-decision]').length === 6;"));
      assert.equal(await browser.evaluate("return [...document.querySelector('#artifact').contentDocument.querySelectorAll('[data-decision]')].every(button => button.disabled);"), true);
      assert.equal(await browser.evaluate("return document.querySelector('#submission-status').dataset.state;"), 'completed');
      await browser.narrow();
      assert.equal(await browser.evaluate('return document.documentElement.scrollWidth <= innerWidth;'), true);
      assert.deepEqual(await readFile(f.report), original);
      await writeFile(f.report, Buffer.concat([original, Buffer.from('<!-- changed report -->')]));
      await browser.reload();
      await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').dataset.revision;"));
      assert.equal(await browser.evaluate("return document.querySelector('#submission-status strong').textContent;"), 'CHANGED — Obtain a fresh review');
    } finally {
      try { await browser?.close(); }
      finally { await f.cli('stop', f.report).catch(() => {}); }
    }
  });
}
