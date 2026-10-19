import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

export function registerSubmissionStatusCases({ fixture, eventually }) {
  test('decline visibly completes the review without implying approval and reopening clears the banner', { timeout: 30000 }, async t => {
    const f = await fixture(t);
    const browser = await f.startBrowser();
    const { port, capability } = await f.descriptor();
    await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
    await eventually(() => browser.evaluate("return !document.querySelector('#decline').disabled;"));
    await browser.evaluate("document.querySelector('#decline').click(); return true;");
    await eventually(() => browser.evaluate("return document.body.dataset.status === 'declined';"));
    assert.equal(await browser.evaluate("return document.querySelector('#submission-status strong').textContent;"), 'COMPLETED — Review ended without approval');
    assert.equal(await browser.evaluate("return document.querySelector('#submission-status').dataset.state;"), 'completed');
    assert.equal(await browser.evaluate("return document.querySelector('#artifact').contentDocument.querySelector('h1').textContent;"), 'First version');
    await f.cli('open', f.file, '--no-browser');
    await browser.reload();
    await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').dataset.revision;"));
    assert.equal(await browser.evaluate("return document.querySelector('#submission-status').hidden;"), true);
    assert.equal(await browser.evaluate("return document.querySelector('#send').disabled;"), false);
  });

  test('approval marks a readable completed review and distinguishes later changed bytes', { timeout: 30000 }, async t => {
    const f = await fixture(t);
    const browser = await f.startBrowser();
    const { port, capability } = await f.descriptor();
    await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
    await eventually(() => browser.evaluate("return !document.querySelector('#approve').disabled;"));
    await browser.evaluate("document.querySelector('#approve').click(); return true;");
    await eventually(() => browser.evaluate("return document.body.dataset.status === 'approved';"));
    assert.deepEqual(await browser.evaluate(`const banner = document.querySelector('#submission-status');
      return { visible: !banner.hidden, state: banner.dataset.state,
        heading: banner.querySelector('strong').textContent,
        readable: document.querySelector('#artifact').contentDocument.querySelector('h1').textContent };`), {
      visible: true, state: 'completed', heading: 'COMPLETED — Approved', readable: 'First version',
    });
    assert.equal(await browser.evaluate("return document.title;"), 'Completed · Review artifact');
    await browser.reload();
    await eventually(() => browser.evaluate("return document.querySelector('#submission-status')?.dataset.state === 'completed';"));
    await writeFile(f.file, '<html><body><h1>Changed after approval</h1></body></html>');
    await browser.reload();
    await eventually(() => browser.evaluate("return document.body.dataset.status === 'needs-review';"));
    assert.equal(await browser.evaluate("return document.querySelector('#submission-status').querySelector('strong').textContent;"), 'CHANGED — Not approved');
    assert.equal(await browser.evaluate("return document.querySelector('#approve').disabled;"), true);
  });

  test('submitted feedback prominently marks the readable document until its next revision', { timeout: 30000 }, async t => {
    const f = await fixture(t);
    const browser = await f.startBrowser();
    const { port, capability } = await f.descriptor();
    await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
    await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').dataset.revision;"));
    await browser.evaluate("document.querySelector('#message').value='Please revise this'; document.querySelector('#send').click(); return true;");
    await eventually(() => browser.evaluate("return document.querySelectorAll('#messages .message').length === 1;"));
    assert.deepEqual(await browser.evaluate(`const banner = document.querySelector('#submission-status');
      const frame = document.querySelector('#artifact');
      return banner && { visible: !banner.hidden, state: banner.dataset.state,
        heading: banner.querySelector('strong').textContent,
        aboveDocument: banner.getBoundingClientRect().bottom <= frame.getBoundingClientRect().top,
        prominent: parseFloat(getComputedStyle(banner.querySelector('strong')).fontSize) >= 20,
        readable: frame.contentDocument.querySelector('h1').textContent };`), {
      visible: true, state: 'submitted', heading: 'SUBMITTED — Waiting for agent',
      aboveDocument: true, prominent: true, readable: 'First version',
    });
    await browser.reload();
    await eventually(() => browser.evaluate("return document.querySelector('#submission-status')?.dataset.state === 'submitted';"));
    assert.equal(await browser.evaluate("return document.title;"), 'Submitted · Review artifact');
    assert.equal(await browser.evaluate("return document.querySelector('#send').disabled;"), false);
    await f.cli('poll', f.file, '--timeout', '0', '--reply', 'I received your feedback.', '--id', 'status-response-0001');
    await eventually(() => browser.evaluate("return document.querySelector('#submission-status').textContent.includes('Agent replied');"));
    await writeFile(f.file, '<html><body><h1>New version</h1></body></html>');
    await eventually(() => browser.evaluate("return document.querySelector('#submission-status').dataset.state === 'updated';"));
    assert.equal(await browser.evaluate("return document.querySelector('#artifact').contentDocument.querySelector('h1').textContent;"), 'New version');
  });
}
