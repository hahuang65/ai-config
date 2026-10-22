import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const diagram = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 80"
  width="240" height="80" role="img" aria-label="Review queued"
  style="--_fg:var(--pele-fg,#202432);font:16px Arial;max-width:100%;height:auto">
  <defs><marker id="arrow" markerWidth="9" markerHeight="6" refX="8" refY="3" orient="auto">
  <path d="M0,0 L0,6 L9,3 z" fill="var(--_fg)"/></marker></defs>
  <g transform="translate(10,10)"><rect width="220" height="60" fill="#eef2f8" stroke="var(--_fg)"/>
  <path d="M150,30 L200,30" marker-end="url(#arrow)" stroke="var(--_fg)"/>
  <text id="queued" x="20" y="36" fill="var(--_fg)">Review queued</text></g></svg>`;

export function registerSvgCases({ fixture, eventually }) {
  test('static SVG stays visible and selectable in the inert review frame', { timeout: 30000 }, async t => {
    const f = await fixture(t);
    await writeFile(f.file, `<!doctype html><h1>Vector review</h1>${diagram}`);
    const browser = await f.startBrowser();
    const { port, capability } = await f.descriptor();
    await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
    await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').dataset.revision;"));
    const geometry = await browser.evaluate(`const frame = document.querySelector('#artifact');
      const svg = frame.contentDocument.querySelector('svg'), text = svg.querySelector('text');
      return { namespace: svg.namespaceURI, width: svg.getBoundingClientRect().width,
        labelWidth: text.getBoundingClientRect().width, fill: getComputedStyle(text).fill,
        marker: getComputedStyle(svg.querySelector('g path')).markerEnd,
        sandbox: frame.getAttribute('sandbox'), ready: !document.querySelector('#approve').disabled };`);
    assert.equal(geometry.namespace, 'http://www.w3.org/2000/svg');
    assert.equal(geometry.width, 240);
    assert.ok(geometry.labelWidth > 60);
    assert.equal(geometry.fill, 'rgb(32, 36, 50)');
    assert.ok(geometry.marker.includes('#arrow'));
    assert.equal(geometry.sandbox, 'allow-same-origin');
    assert.equal(geometry.ready, true);
    await browser.evaluate(`const doc = document.querySelector('#artifact').contentDocument;
      doc.querySelector('#queued').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      document.querySelector('#annotation-comment').value = 'Keep this label readable';
      document.querySelector('#add-annotation').click(); document.querySelector('#send').click(); return true;`);
    await eventually(async () => (await f.cli('poll', f.file, '--timeout', '0')).events.length === 1);
    const [event] = (await f.cli('poll', f.file, '--timeout', '0')).events;
    assert.equal(event.annotations[0].target, '#queued');
    assert.equal(event.annotations[0].text, 'Review queued');
  });

  test('an allowed PR anchor inside SVG does not break review readiness or navigation', { timeout: 30000 }, async t => {
    const f = await fixture(t);
    await writeFile(f.file, `<svg viewBox="0 0 240 80"><defs><linearGradient id="shade">
      <stop offset="0%" stop-color="#123"/><stop offset="100%" stop-color="#456"/></linearGradient></defs>
      <a href="https://github.com/owner/repo/pull/7" style="fill:url('#shade');stroke:url(https://unsafe.invalid/paint.svg#color)">
      <text id="pr" x="10" y="30">Original PR</text></a></svg>`);
    const browser = await f.startBrowser();
    const { port, capability } = await f.descriptor();
    await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
    await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').dataset.revision;"));
    const paint = await browser.evaluate(`const anchor = document.querySelector('#artifact').contentDocument.querySelector('a');
      return { style: anchor.getAttribute('style'), fill: getComputedStyle(anchor).fill };`);
    assert.ok(paint.fill.includes('#shade'));
    assert.ok(!paint.style.includes('unsafe.invalid'));
    assert.deepEqual(await browser.evaluate(`let opened;
      window.open = (...args) => { opened = args; };
      const doc = document.querySelector('#artifact').contentDocument;
      doc.querySelector('#pr').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return opened;`), ['https://github.com/owner/repo/pull/7', '_blank', 'noopener,noreferrer']);
  });

  test('SVG cannot execute scripts, embed HTML, or fetch external paint and stylesheets', { timeout: 30000 }, async t => {
    const f = await fixture(t);
    let requests = 0;
    const server = createServer((request, response) => { requests++; response.writeHead(204).end(); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const url = `http://127.0.0.1:${server.address().port}/forbidden`;
    await writeFile(f.file, `<svg viewBox="0 0 240 80" onload="parent.document.body.dataset.compromised='yes'">
      <script>parent.document.body.dataset.compromised='yes'</script>
      <style>@import url('${url}'); .network {fill:url('${url}')}</style>
      <foreignObject><iframe src="${url}"></iframe><img src="${url}" onerror="parent.document.body.dataset.compromised='yes'"></foreignObject>
      <image href="${url}"/><use href="${url}#shape"/>
      <animate attributeName="href" values="${url}"/>
      <path class="network" d="M0,0 L20,20" fill="url(${url})"/><text x="1" y="30">Safe text</text></svg>`);
    const browser = await f.startBrowser();
    const { port, capability } = await f.descriptor();
    await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
    await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').dataset.revision;"));
    assert.deepEqual(await browser.evaluate(`await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const doc = document.querySelector('#artifact').contentDocument;
      return { compromised: document.body.dataset.compromised || 'safe',
        active: doc.querySelectorAll('script, foreignObject, image, use, animate, iframe, img, [onload]').length,
        label: doc.querySelector('text').textContent };`), { compromised: 'safe', active: 0, label: 'Safe text' });
    assert.equal(requests, 0, 'Neither SVG attributes nor retained CSS may fetch external resources');
  });
}
