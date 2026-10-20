import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

export function registerSubmissionStatusCases({ fixture, eventually }) {
  test('background feedback state is visible without discarding an unsent follow-up', { timeout: 30000 }, async t => {
    const f = await fixture(t);
    const origin = { harness: 'pi', conversation: 'browser-feedback-fixture', workspace: f.root };
    assert.equal((await f.api('/feedback/attach', origin)).status, 200);
    const browser = await f.startBrowser();
    const { port, capability } = await f.descriptor();
    await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
    await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').dataset.revision;"));
    await browser.evaluate("document.querySelector('#message').value='Explain this'; document.querySelector('#send').click(); return true;");
    await eventually(() => browser.evaluate("return document.querySelector('#submission-status').dataset.state === 'queued';"));
    const job = await (await f.api('/feedback/claim', origin)).json();
    await eventually(() => browser.evaluate("return document.querySelector('#submission-status').dataset.state === 'working';"));
    await browser.evaluate("const input=document.querySelector('#message'); input.value='Keep this unsent follow-up'; input.dispatchEvent(new Event('input')); return true;");
    assert.equal((await f.api('/feedback/fail', { cursor: job.cursor, attempt: job.attempt })).status, 200);
    await eventually(() => browser.evaluate("return document.querySelector('#submission-status').dataset.state === 'needs_attention';"));
    assert.equal(await browser.evaluate("return document.querySelector('#message').value;"), 'Keep this unsent follow-up');
    const retried = await (await f.api('/feedback/claim', origin)).json();
    assert.equal((await f.api('/feedback/finish', { cursor: retried.cursor, attempt: retried.attempt, message: 'Here is the explanation.' })).status, 200);
    await eventually(() => browser.evaluate("return document.querySelector('#submission-status').dataset.state === 'answered';"));
    await browser.reload();
    await eventually(() => browser.evaluate("return document.title === 'Answered · Review artifact';"));
    assert.equal(await browser.evaluate("return document.querySelector('#message').value;"), 'Keep this unsent follow-up');
    assert.equal(await browser.evaluate("return document.querySelector('#artifact').contentDocument.querySelector('h1').textContent;"), 'First version');
  });
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
