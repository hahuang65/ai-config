// PROTOTYPE — NOT PRODUCTION. Explicit Node test entry point, outside the production gate.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { firefoxSuite } from '../firefox-suite.mjs';
import { fixtures } from './fixtures.mjs';
import { reviewSnapshot } from './review-snapshot.mjs';
import { writeReports } from './reports.mjs';

const root = process.env.PELE_EVAL_ROOT;
assert.ok(root, 'Set PELE_EVAL_ROOT to the isolated directory containing verified packages');
const browsers = firefoxSuite();
const results = [];
let server;
after(async () => {
  await browsers.close();
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
});

async function startServer() {
  const packages = JSON.parse(await readFile(join(import.meta.dirname, 'packages.lock.json'), 'utf8'));
  for (const item of packages) {
    const bytes = await readFile(join(root, item.bundle));
    assert.equal(bytes.length, item.bytes, `${item.name}: bundle size`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256, `${item.name}: bundle checksum`);
  }
  const pages = new Map([
    ['/', ['text/html', '<!doctype html><title>PROTOTYPE — NOT PRODUCTION</title><script src="/errors.js"></script><script src="/pele.js"></script><script src="/mermaid.js"></script><script type="module" src="/render.mjs"></script>']],
    ['/errors.js', ['text/javascript', 'window.loadErrors=[];window.addEventListener("error",e=>window.loadErrors.push({message:e.message,file:e.filename,line:e.lineno,column:e.colno}));']],
    ['/pele.js', ['text/javascript', await readFile(join(root, 'pele.js'))]],
    ['/mermaid.js', ['text/javascript', await readFile(join(root, 'mermaid.js'))]],
    ['/render.mjs', ['text/javascript', await readFile(join(import.meta.dirname, 'browser-render.mjs'))]],
  ]);
  server = createServer((request, response) => {
    const page = pages.get(request.url);
    if (!page) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': `${page[0]}; charset=utf-8`,
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'" });
    response.end(page[1]);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}/`;
}

test('compare diagram renderers at wide and narrow widths in two themes', { timeout: 150000 }, async t => {
  const url = await startServer();
  const browser = await browsers.open(t);
  try {
    await browser.navigate(url);
    assert.equal(await browser.evaluate('return window.evaluationReady;'), true);
    assert.deepEqual(await browser.evaluate('return window.loadErrors;'), [], 'Library scripts must load without errors');
    await writeFile(join(root, 'environment.json'), JSON.stringify(await browser.evaluate('return { userAgent: navigator.userAgent, font: "Arial", widths: [1040, 380] };'), null, 2));
    for (const fixture of fixtures) for (const width of [1040, 380]) {
      for (const theme of ['light', 'dark']) for (const library of ['pele', 'mermaid']) {
        const options = { library, fixture, width, theme };
        const rendered = await browser.evaluate(`try { return await window.renderFixture(${JSON.stringify(options)}); }
          catch (error) { return { error: String(error), stack: error.stack }; }`);
        assert.equal(rendered.error, undefined, `${library}/${fixture.id}/${width}/${theme}: ${rendered.error}\n${rendered.stack ?? ''}`);
        const { png, svg, ...metrics } = rendered;
        metrics.missingLabels = fixture.labels.filter(label =>
          !metrics.text.replace(/\s/g, '').includes(label.replace(/\s/g, '')));
        assert.equal(metrics.activeElements, 0, 'Generated static fixtures must have no scripts, images, or links');
        assert.equal(metrics.foreignObjects, 0, 'The fixture must render without embedded HTML');
        assert.ok(metrics.width <= width + 2, 'Diagram must fit its width');
        const id = `${fixture.id}-${width}-${theme}-${library}`;
        await writeFile(join(root, `${id}.png`), Buffer.from(png.split(',')[1], 'base64'));
        await writeFile(join(root, `${id}.html`), `<!doctype html><title>PROTOTYPE — NOT PRODUCTION</title>${svg}`);
        results.push({ id, fixture: fixture.id, library, width, theme, ...metrics, svg, png });
        t.diagnostic(`${id}: ${metrics.width}×${metrics.height}, minimum text ${metrics.minTextPixels}px, ${metrics.clipped.length} clipped, ${metrics.overlaps.length} text overlaps`);
      }
    }
  } finally { await browser.close(); }
  await writeFile(join(root, 'results.json'), JSON.stringify(results.map(({ svg, png, ...row }) => row), null, 2));
  await writeReports(root, results);
  assert.deepEqual(results.filter(row => row.missingLabels.length).map(row => ({ id: row.id, missing: row.missingLabels })),
    [], 'Every required category or diagram label must remain visible');
});

test('current review strips both renderers but accepts their rasterized output', { timeout: 30000 }, async () => {
  assert.equal(results.length, 32, 'Rendering comparison must complete first');
  for (const library of ['pele', 'mermaid']) {
    const row = results.find(r => r.library === library && r.fixture === 'workflow');
    const vector = await reviewSnapshot(root, `review-${library}-vector`, `<!doctype html><h1>Diagram</h1>${row.svg}`);
    assert.equal(vector.status, 200);
    assert.doesNotMatch(vector.html, /<svg\b/);
    const raster = await reviewSnapshot(root, `review-${library}-raster`, `<!doctype html><h1>Diagram</h1><img src="${row.png}" alt="Branched review workflow">`);
    assert.equal(raster.status, 200);
    assert.match(raster.html, /src="data:image\/png;base64,/);
  }
  const script = await reviewSnapshot(root, 'review-runtime-script', '<!doctype html><h1>Diagram</h1><pre class="mermaid">flowchart LR\nA-->B</pre><script src="mermaid.js"></script>');
  assert.equal(script.status, 200);
  assert.doesNotMatch(script.html, /<script\b/);
});

test('try explicit narrow chart dimensions and horizontal category labels', { timeout: 30000 }, async t => {
  const browser = await browsers.open(t);
  const tuned = [];
  try {
    await browser.navigate(`http://127.0.0.1:${server.address().port}/`);
    for (const library of ['pele', 'mermaid']) for (const horizontal of [false, true]) {
      const original = fixtures.find(f => f.id === 'chart');
      const fixture = { ...original, source: horizontal ? original.source.replace('xychart-beta', 'xychart-beta horizontal') : original.source };
      const options = { fixture, library, width: 380, theme: 'light', config: { xyChart: { width: 380, height: 360 } } };
      const row = await browser.evaluate(`try { return await window.renderFixture(${JSON.stringify(options)}); }
        catch (error) { return { error: String(error) }; }`);
      assert.equal(row.error, undefined);
      const id = `tuned-chart-${horizontal ? 'horizontal' : 'vertical'}-${library}`;
      const missingLabels = original.labels.filter(label => !row.text.includes(label));
      await writeFile(join(root, `${id}.png`), Buffer.from(row.png.split(',')[1], 'base64'));
      tuned.push({ ...row, id, fixture: 'chart', library, width: 380, theme: 'light', missingLabels });
      t.diagnostic(`${id}: minimum text ${row.minTextPixels}px, missing labels ${missingLabels.join(', ') || 'none'}, overlaps ${row.overlaps.length}`);
    }
  } finally { await browser.close(); }
  await writeFile(join(root, 'tuned.json'), JSON.stringify(tuned.map(({ svg, png, ...row }) => row), null, 2));
  await writeReports(root, results, tuned);
  assert.ok(tuned.some(row => row.library === 'pele' && !row.missingLabels.length && row.minTextPixels >= 12));
  assert.ok(tuned.some(row => row.library === 'mermaid' && !row.missingLabels.length && row.minTextPixels >= 12));
});

test('the complete comparison remains visible after real review sanitization', { timeout: 30000 }, async t => {
  const html = await readFile(join(root, 'comparison.html'), 'utf8');
  const snapshot = await reviewSnapshot(root, 'review-full-comparison', html);
  assert.equal(snapshot.status, 200);
  const file = join(root, 'sanitized-comparison.html');
  await writeFile(file, snapshot.html);
  const browser = await browsers.open(t);
  try {
    await browser.navigate(pathToFileURL(file).href);
    const images = await browser.evaluate(`const images = [...document.images];
      await Promise.all(images.map(image => image.decode()));
      return { count: images.length, decoded: images.every(image => image.naturalWidth > 0),
        scripts: document.scripts.length, svg: document.querySelectorAll('svg').length };`);
    assert.deepEqual(images, { count: 20, decoded: true, scripts: 0, svg: 0 });
    await browser.narrow();
    const overflow = await browser.evaluate('return document.documentElement.scrollWidth - innerWidth;');
    assert.ok(overflow <= 0, 'The report must not overflow at the narrow viewport');
  } finally { await browser.close(); }
});
