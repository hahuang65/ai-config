import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

export function registerLinkNavigationCases({ fixture, eventually }) {
  test('safe PR anchors stay readable while other navigation and document scripts remain inert', { timeout: 30000 }, async t => {
    const f = await fixture(t);
    await writeFile(f.file, `<html><body>
      <a href="https://github.com/owner/repo/pull/7" target="_top" rel="opener">Original PR</a>
      <a href="javascript:parent.document.body.dataset.compromised='yes'">Script</a>
      <a href="data:text/html,unsafe">Data</a>
      <a href="file:///etc/passwd">File</a>
      <a href="https://github.com@foreign.invalid/owner/repo/pull/7">Foreign host</a>
      <a href="https://github.com/owner/repo/pull/7?redirect=unsafe">Query</a>
      <a href="https://github.com/owner/repo/pull/0">Invalid PR</a>
      <a href="https://github.com/owner/repo/pull/7/elsewhere">Other endpoint</a>
      <script>parent.document.body.dataset.compromised='yes'</script>
      </body></html>`);
    const browser = await f.startBrowser();
    const { port, capability } = await f.descriptor();
    await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
    await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').dataset.revision;"));
    assert.deepEqual(await browser.evaluate(`const frame = document.querySelector('#artifact');
      return { sandbox: frame.getAttribute('sandbox'), scripts: frame.contentDocument.querySelectorAll('script').length,
        compromised: document.body.dataset.compromised || 'safe',
        links: [...frame.contentDocument.querySelectorAll('a[href]')].map(link => ({ href: link.href, target: link.target, rel: link.rel })) };`), {
      sandbox: 'allow-same-origin', scripts: 0, compromised: 'safe',
      links: [{ href: 'https://github.com/owner/repo/pull/7', target: '_blank', rel: 'noopener noreferrer' }],
    });
  });
}
