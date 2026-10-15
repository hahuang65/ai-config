import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

export function registerLiveWaitCases({ fixture, eventually }) {
  test('idle browser review holds its event request and checks revisions without reloading snapshots', { timeout: 30000 }, async t => {
    const f = await fixture(t);
    const browser = await f.startBrowser();
    const { port, capability } = await f.descriptor();
    await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
    await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').dataset.revision;"));
    await browser.evaluate(`
      window.waitRequests=[];
      const original=window.fetch;
      window.fetch=(url,options)=>{ window.waitRequests.push(String(url).split('?')[0]); return original(url,options); };
      return true;
    `);
    await eventually(() => browser.evaluate("return window.waitRequests.filter(route=>route==='/events').length>=2 || window.waitRequests.filter(route=>route==='/revision').length>=3;"));
    const counts = await browser.evaluate("return { events:window.waitRequests.filter(route=>route==='/events').length, snapshots:window.waitRequests.filter(route=>route==='/snapshot').length }; ");
    assert.ok(counts.events <= 1, 'idle review must not repeatedly poll event history');
    assert.equal(counts.snapshots, 0, 'unchanged document must not repeatedly fetch rendered HTML');
    const waiting = f.cli('wait', f.file);
    await browser.evaluate("document.querySelector('#message').value='Live feedback'; document.querySelector('#send').click(); return true;");
    const page = await waiting;
    assert.equal(page.events[0].message, 'Live feedback');
    await f.cli('poll', f.file, '--cursor', String(page.cursor), '--timeout', '0', '--reply', 'Received live', '--id', 'browser-live-response-0001');
    await eventually(() => browser.evaluate("return document.querySelector('#messages').textContent.includes('Received live');"));
    await writeFile(f.file, '<html><body><h1>Updated document</h1></body></html>');
    await eventually(() => browser.evaluate("return document.querySelector('#artifact').contentDocument?.querySelector('h1')?.textContent==='Updated document';"));
    assert.equal(await browser.evaluate("return document.querySelectorAll('#messages article').length;"), 2);
  });
}
