import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, readdir, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { interruptBrowserDelivery } from './delivery.mjs';
import { registerChangeReportCase } from '../../../test/change-report.browser-cases.mjs';
import './firefox-process.test.mjs';
import './firefox-suite.test.mjs';
import { firefoxSuite } from './firefox-suite.mjs';
import { registerFirefoxIsolationCases } from './firefox-isolation.mjs';
import { registerFindingDecisionCases } from './finding-decisions.mjs';
import { registerAnnotationPopoverCases } from './annotation-popover.mjs';
import { registerLiveWaitCases } from './live-wait.mjs';

const browsers = firefoxSuite();
const firefox = () => browsers.open();
after(() => browsers.close());
registerFirefoxIsolationCases(browsers);
registerChangeReportCase(firefox);
registerFindingDecisionCases(firefox);
registerAnnotationPopoverCases({ fixture, eventually });
registerLiveWaitCases({ fixture, eventually });

const executable = resolve(import.meta.dirname, '../target/debug/artifact-review');
const exec = promisify(execFile);
const artifact = label => `<!doctype html><html><head><style>body { color: rgb(20, 30, 40) }</style></head>
<body><h1 id="title">${label}</h1><p id="paragraph">Select these words for feedback.</p>
<a href="https://example.invalid/escape">External link</a><img src="https://example.invalid/image">
<form action="/submit"><button>Unsafe form</button></form>
<script>parent.document.body.dataset.compromised = 'yes'; parent.postMessage({action:'approve'}, '*');</script></body></html>`;

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'artifact-review-test-'));
  const file = join(root, 'artifact.html');
  const env = { ...process.env, AR_ROOT: join(root, 'state') };
  await writeFile(file, artifact('First version'));
  const cli = async (...args) => {
    try { const { stdout } = await exec(executable, args, { env, timeout: 15000 }); return JSON.parse(stdout); }
    catch { throw new Error('Artifact review command failed (details suppressed)'); }
  };
  let browser;
  t.after(async () => {
    try { await browser?.close(); }
    finally {
      await cli('stop', file).catch(() => {});
      await rm(root, { recursive: true, force: true });
    }
  });
  const startBrowser = async () => { browser = await firefox(); return browser; };
  await cli('open', file, '--no-browser');
  const descriptor = async () => {
    const [directory] = await readdir(env.AR_ROOT);
    return JSON.parse(await readFile(join(env.AR_ROOT, directory, 'server.json'), 'utf8'));
  };
  const api = async (route, body, headers = {}) => {
    const { port, capability } = await descriptor();
    const origin = `http://127.0.0.1:${port}`;
    return fetch(origin + route, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${capability}`, Origin: origin, 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined });
  };
  return { root, file, env, cli, descriptor, api, startBrowser };
}

test('a model review sheet shows its confined local render before approval', async t => {
  const f = await fixture(t);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRmkAAAAASUVORK5CYII=', 'base64');
  await writeFile(join(f.root, 'front.png'), png);
  await writeFile(f.file, '<!doctype html><html><body><h1>Functional Shape Review</h1><img src="front.png" alt="Front view"></body></html>');
  const snapshot = await (await f.api('/snapshot')).json();
  assert.match(snapshot.html, /src="data:image\/png;base64,/);
  const browser = await f.startBrowser();
  const { port, capability } = await f.descriptor();
  await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
  await eventually(() => browser.evaluate(`
    const image = document.querySelector('#artifact').contentDocument?.querySelector('img');
    return !!(image?.complete && image.naturalWidth === 1);
  `));
  assert.equal(await browser.evaluate("return document.querySelector('#approve').disabled;"), false);
});

test('an undecodable local render cannot be approved in the browser', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'front.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  await writeFile(f.file, '<html><body><img src="front.png" alt="Front view"></body></html>');
  const browser = await f.startBrowser();
  const { port, capability } = await f.descriptor();
  await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
  await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').contentDocument?.querySelector('img[src]')?.complete;"));
  assert.equal(await browser.evaluate("return document.querySelector('#approve').disabled;"), true);
  assert.equal(await browser.evaluate("return !!document.querySelector('#artifact').dataset.revision;"), false);
});

test('a restored render is displayed again before its revision can be approved', async t => {
  const f = await fixture(t);
  const image = join(f.root, 'front.png');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRmkAAAAASUVORK5CYII=', 'base64');
  await writeFile(image, png);
  await writeFile(f.file, '<html><body><img src="front.png" alt="Front view"></body></html>');
  const browser = await f.startBrowser();
  const { port, capability } = await f.descriptor();
  await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
  const renderedWidth = "return document.querySelector('#artifact').contentDocument?.querySelector('img[src]')?.naturalWidth ?? -1;";
  await eventually(() => browser.evaluate(renderedWidth).then(width => width === 1));
  const revision = await browser.evaluate("return document.querySelector('#artifact').dataset.revision;");
  await writeFile(image, Buffer.from('89504e470d0a1a0a', 'hex'));
  await eventually(() => browser.evaluate(renderedWidth).then(width => width === 0));
  assert.equal(await browser.evaluate("return document.querySelector('#approve').disabled;"), true);
  await writeFile(image, png);
  await eventually(async () => await browser.evaluate(renderedWidth) === 1
    && await browser.evaluate("return !document.querySelector('#approve').disabled;"));
  assert.equal(await browser.evaluate("return document.querySelector('#artifact').dataset.revision;"), revision);
});

test('changing only a render revokes approval and rejects the stale revision', async t => {
  const f = await fixture(t);
  const image = join(f.root, 'front.png');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRmkAAAAASUVORK5CYII=', 'base64');
  await writeFile(image, png);
  await writeFile(f.file, '<!doctype html><html><body><img src="front.png" alt="Front view"></body></html>');
  const first = await (await f.api('/snapshot')).json();
  await writeFile(image, Buffer.concat([png, Buffer.from([0])]));
  const second = await (await f.api('/snapshot')).json();
  assert.notEqual(second.revision, first.revision);
  assert.equal((await f.api('/submit', submission(first.revision, 'approve'))).status, 409);
  assert.equal((await f.api('/submit', submission(second.revision, 'approve'))).status, 200);
  const approved = await f.cli('poll', f.file, '--timeout', '0');
  assert.equal(approved.needs_review, false);
  await writeFile(image, png);
  const changed = await f.cli('poll', f.file, '--cursor', String(approved.cursor), '--timeout', '0');
  assert.equal(changed.needs_review, true);
});

test('a bounded embedded raster stays visible but active embedded media is refused', async t => {
  const f = await fixture(t);
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRmkAAAAASUVORK5CYII=';
  await writeFile(f.file, `<html><body><img src="data:image/png;base64,${png}" alt="Top view"></body></html>`);
  const snapshot = await (await f.api('/snapshot')).json();
  assert.match(snapshot.html, /src="data:image\/png;base64,/);
  await writeFile(f.file, '<html><body><img src="data:image/svg+xml;base64,PHN2Zz4=" alt="Unsafe"></body></html>');
  assert.equal((await f.api('/snapshot')).status, 503);
  assert.equal((await f.cli('poll', f.file, '--timeout', '0')).current_revision, null);
});

test('unsafe, missing, and oversized local renders refuse approval', async t => {
  const f = await fixture(t);
  const image = join(f.root, 'front.png');
  await writeFile(f.file, '<!doctype html><html><body><img src="front.png" alt="Front view"></body></html>');
  assert.equal((await f.api('/snapshot')).status, 503);
  await symlink(f.file, image);
  assert.equal((await f.api('/snapshot')).status, 503);
  await rm(image);
  await writeFile(image, Buffer.alloc(2 * 1024 * 1024 + 1));
  assert.equal((await f.api('/snapshot')).status, 503);
  const review = await f.cli('poll', f.file, '--timeout', '0');
  assert.equal(review.current_revision, null);
  assert.equal(review.needs_review, true);
});

const submission = (revision, action = 'feedback', message = 'Useful feedback') => ({
  id: crypto.randomUUID(), action, revision, message, annotations: [],
});

// Test-only readiness polling; see test/timings.md.
const BROWSER_STATE_POLL_MS = 20;
const BROWSER_STATE_GUARD_MS = 10000;
const INTERRUPT_START_HOLD_MS = 150;

async function eventually(predicate) {
  const deadline = Date.now() + BROWSER_STATE_GUARD_MS;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(BROWSER_STATE_POLL_MS);
  }
  assert.fail('Expected browser state did not arrive');
}

 test('process CLI retains events across interrupted waits, retries, and server restarts', async t => {
  const f = await fixture(t);
  const snapshot = await (await f.api('/snapshot')).json();
  const initial = await f.cli('poll', f.file, '--timeout', '0');
  const waiter = spawn(executable, ['poll', f.file, '--cursor', String(initial.cursor), '--timeout', '10'], { env: f.env, stdio: 'ignore' });
  await sleep(INTERRUPT_START_HOLD_MS);
  waiter.kill('SIGTERM');
  const request = submission(snapshot.revision);
  const accepted = await (await f.api('/submit', request)).json();
  const retry = await (await f.api('/submit', request)).json();
  assert.equal(accepted.cursor, retry.cursor);
  assert.equal((await f.api('/submit', { ...request, message: 'Different' })).status, 409);
  const { pid } = await f.descriptor();
  process.kill(pid, 'SIGKILL');
  await eventually(() => f.api('/snapshot').then(() => false, () => true));
  await f.cli('open', f.file, '--no-browser');
  const feedback = await f.cli('poll', f.file, '--cursor', String(initial.cursor), '--timeout', '0');
  assert.equal(feedback.events.filter(event => event.action === 'feedback').length, 1);
  assert.equal(feedback.events[0].message, request.message);
  const replyId = crypto.randomUUID();
  await f.cli('poll', f.file, '--timeout', '0', '--reply', 'Addressed.', '--id', replyId);
  await f.cli('poll', f.file, '--timeout', '0', '--reply', 'Addressed.', '--id', replyId);
  const replies = await f.cli('poll', f.file, '--cursor', String(feedback.cursor), '--timeout', '0');
  assert.equal(replies.events.filter(event => event.action === 'reply').length, 1);
  const empty = await f.cli('poll', f.file, '--cursor', String(replies.cursor), '--timeout', '0');
  assert.deepEqual(empty.events, []);
  assert.equal(empty.status, 'open');
});

 test('server rejects unauthorized, cross-origin, stale, oversized, and arbitrary-file requests', async t => {
  const f = await fixture(t);
  const snapshot = await (await f.api('/snapshot')).json();
  assert.equal((await f.api('/snapshot', null, { Authorization: '' })).status, 401);
  assert.equal((await f.api('/snapshot', null, { Origin: 'https://example.invalid' })).status, 403);
  assert.equal((await f.api('/etc/passwd')).status, 404);
  assert.equal((await f.api('/snapshot?file=/etc/passwd')).status, 400);
  assert.equal((await f.api('/submit', submission(snapshot.revision, 'feedback', 'x'.repeat(150000)))).status, 413);
  assert.equal((await f.api('/submit', { ...submission(snapshot.revision), action: 'custom' })).status, 400);
  await writeFile(f.file, artifact('Second version'));
  assert.equal((await f.api('/submit', submission(snapshot.revision, 'approve'))).status, 409);
  assert.equal((await f.cli('poll', f.file, '--timeout', '0')).status, 'open');
  const [directory] = await readdir(f.env.AR_ROOT);
  assert.equal((await stat(join(f.env.AR_ROOT, directory))).mode & 0o777, 0o700);
  assert.equal((await stat(join(f.env.AR_ROOT, directory, 'server.json'))).mode & 0o777, 0o600);
  const invalid = await exec(executable, ['poll', f.file, '--timeout', '1000'], { env: f.env }).then(() => 0, error => error.code);
  assert.equal(invalid, 2);
});

test('process poll distinguishes current bytes from an approved revision without adding events', async t => {
  const f = await fixture(t);
  const snapshot = await (await f.api('/snapshot')).json();
  assert.equal((await f.api('/submit', submission(snapshot.revision, 'approve'))).status, 200);
  const approved = await f.cli('poll', f.file, '--timeout', '0');
  assert.equal(approved.approved_revision, snapshot.revision);
  assert.equal(approved.current_revision, snapshot.revision);
  assert.equal(approved.needs_review, false);
  await writeFile(f.file, artifact('Changed after approval'));
  const current = await (await f.api('/snapshot')).json();
  const changed = await f.cli('poll', f.file, '--cursor', String(approved.cursor), '--timeout', '0');
  assert.equal(changed.approved_revision, snapshot.revision);
  assert.equal(changed.current_revision, current.revision);
  assert.equal(changed.needs_review, true);
  assert.equal(changed.cursor, approved.cursor);
  assert.deepEqual(changed.events, []);
  await rm(f.file);
  const missing = await f.cli('poll', f.file, '--cursor', String(approved.cursor), '--timeout', '0');
  assert.equal(missing.current_revision, null);
  assert.equal(missing.approved_revision, snapshot.revision);
  assert.equal(missing.needs_review, true);
  assert.deepEqual(missing.events, []);
});

test('process poll and stop retain session identity after source replacement with a symlink', async t => {
  const f = await fixture(t);
  const snapshot = await (await f.api('/snapshot')).json();
  const feedback = submission(snapshot.revision);
  assert.equal((await f.api('/submit', feedback)).status, 200);
  const before = await f.cli('poll', f.file, '--timeout', '0');
  const replacement = join(f.root, 'replacement.html');
  await writeFile(replacement, artifact('Replacement target'));
  await rm(f.file);
  await symlink(replacement, f.file);
  try {
    const after = await f.cli('poll', f.file, '--timeout', '0');
    assert.deepEqual(after.events, before.events);
    assert.equal(after.cursor, before.cursor);
    assert.equal(after.current_revision, null);
    assert.equal(after.needs_review, true);
    assert.equal((await f.api('/snapshot')).status, 503);
    assert.equal((await f.api('/submit', submission(snapshot.revision, 'approve'))).status, 409);
    assert.deepEqual(await f.cli('stop', f.file), { status: 'stopped' });
  } finally {
    await rm(f.file);
    await writeFile(f.file, artifact('Restored regular file'));
  }
});

test('isolated Firefox case uses one blank tab and evaluates promises without exposing exception details', async t => {
  const browser = await firefox();
  t.after(() => browser.close());
  const contexts = await browser.contexts();
  assert.equal(contexts.length, 1, 'each isolated case must start with exactly one tab');
  assert.equal(contexts[0].url, 'about:blank');
  assert.equal(await browser.evaluate('return true;'), true);
  assert.deepEqual(await browser.evaluate("return await Promise.resolve({ value: 'ready' });"), { value: 'ready' });
  await assert.rejects(browser.evaluate("throw new Error('private exception details');"), {
    message: 'Firefox evaluation failed',
  });
});

 test('real Firefox supports annotations, replies, retained feedback, live reload, and version-bound approval', async t => {
  const f = await fixture(t);
  const browser = await f.startBrowser();
  const { port, capability } = await f.descriptor();
  await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
  await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').dataset.revision;"));
  assert.equal(await browser.evaluate("return document.body.dataset.compromised || 'safe';"), 'safe');
  assert.equal(await browser.evaluate("const d=document.querySelector('#artifact').contentDocument; return d.querySelectorAll('script,form,[href],[src]').length;"), 0);
  assert.equal(await browser.evaluate("return getComputedStyle(document.querySelector('#artifact').contentDocument.body).color;"), 'rgb(20, 30, 40)');
  await browser.evaluate("document.querySelector('#artifact').contentDocument.querySelector('h1').click(); document.querySelector('#annotation-comment').value='Element comment'; document.querySelector('#add-annotation').click(); return true;");
  await browser.evaluate("const d=document.querySelector('#artifact').contentDocument; const range=d.createRange(); range.selectNodeContents(d.querySelector('p')); d.getSelection().removeAllRanges(); d.getSelection().addRange(range); d.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); document.querySelector('#annotation-comment').value='Selection comment'; document.querySelector('#add-annotation').click(); document.querySelector('#message').value='<img src=x onerror=alert(1)> General feedback'; document.querySelector('#send').click(); return true;");
  await eventually(() => browser.evaluate("return document.querySelectorAll('#messages .message').length === 1;"));
  const sent = await f.cli('poll', f.file, '--timeout', '0');
  const feedback = sent.events.find(event => event.action === 'feedback');
  assert.deepEqual(feedback.annotations.map(annotation => annotation.kind), ['element', 'selection']);
  assert.equal(sent.status, 'open');
  assert.equal(await browser.evaluate("return document.querySelectorAll('#messages img').length;"), 0);
  await f.cli('poll', f.file, '--timeout', '0', '--reply', 'Updated the document.', '--id', crypto.randomUUID());
  await writeFile(f.file, artifact('Second version'));
  await eventually(() => browser.evaluate("return document.querySelector('#artifact').contentDocument.querySelector('h1')?.textContent === 'Second version' && document.querySelector('#messages').textContent.includes('Updated the document.');"));
  assert.equal(await browser.evaluate("return document.querySelector('#messages').textContent.includes('Element comment');"), true);
  await interruptBrowserDelivery(browser, f.cli, f.file, eventually);
  await browser.narrow();
  assert.equal(await browser.evaluate("return document.documentElement.scrollWidth <= innerWidth;"), true);
  await browser.evaluate("document.querySelector('#artifact').contentDocument.querySelector('h1').click(); document.querySelector('#annotation-comment').value='Unsent terminal annotation'; document.querySelector('#message').value='Final note'; document.querySelector('#approve').click(); return true;");
  await eventually(() => browser.evaluate("return document.body.dataset.status === 'approved';"));
  const approved = await f.cli('poll', f.file, '--cursor', String(sent.cursor), '--timeout', '0');
  const terminal = approved.events.find(event => event.action === 'approve');
  assert.equal(terminal.message, 'Final note');
  assert.equal(terminal.annotations[0].comment, 'Unsent terminal annotation');
  assert.equal(approved.status, 'approved');
});

test('real Firefox marks changed bytes unapproved after reloading an approved review', async t => {
  const f = await fixture(t);
  const browser = await f.startBrowser();
  const { port, capability } = await f.descriptor();
  const url = `http://127.0.0.1:${port}/#${capability}`;
  await browser.navigate(url);
  await eventually(() => browser.evaluate("return !document.querySelector('#approve').disabled;"));
  await browser.evaluate("document.querySelector('#approve').click(); return true;");
  await eventually(() => browser.evaluate("return document.body.dataset.status === 'approved';"));
  const approved = await f.cli('poll', f.file, '--timeout', '0');
  await browser.reload();
  await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').dataset.revision && document.body.dataset.status === 'approved';"));
  await writeFile(f.file, artifact('Changed after approval'));
  await browser.reload();
  await eventually(() => browser.evaluate("return document.querySelector('#artifact').contentDocument.querySelector('h1')?.textContent === 'Changed after approval';"));
  assert.equal(await browser.evaluate("return document.body.dataset.status;"), 'needs-review');
  assert.equal(await browser.evaluate("return document.querySelector('#notice').textContent.includes('Displayed version is not approved');"), true);
  assert.equal(await browser.evaluate("return document.querySelector('#approve').disabled;"), true);
  const after = await f.cli('poll', f.file, '--cursor', String(approved.cursor), '--timeout', '0');
  assert.deepEqual(after.events, []);
  assert.equal(after.cursor, approved.cursor);
});

test('real Firefox retains class-based layout and styles while isolating scripts', async t => {
  const f = await fixture(t);
  await writeFile(f.file, artifact('Styled version').replace('<body>', `<body>
    <style>.layout { display: grid; grid-template-columns: 120px 180px; gap: 12px; }
    .highlight { color: rgb(100, 50, 20); }</style>
    <section class="layout"><div class="highlight">Styled cell</div><div>Second cell</div></section>`));
  const browser = await f.startBrowser();
  const { port, capability } = await f.descriptor();
  await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
  await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').dataset.revision;"));
  assert.deepEqual(await browser.evaluate(`
    const doc = document.querySelector('#artifact').contentDocument;
    const layout = doc.querySelector('.layout');
    const highlight = doc.querySelector('.highlight');
    if (!layout || !highlight) return null;
    const style = getComputedStyle(layout);
    return { display: style.display, columns: style.gridTemplateColumns, gap: style.gap,
      color: getComputedStyle(highlight).color, scripts: doc.querySelectorAll('script').length,
      compromised: document.body.dataset.compromised || 'safe' };
  `), { display: 'grid', columns: '120px 180px', gap: '12px', color: 'rgb(100, 50, 20)', scripts: 0, compromised: 'safe' });
});

 test('real Firefox stale approval fails, decline includes drafts, and closing is not approval', async t => {
  const f = await fixture(t);
  const browser = await f.startBrowser();
  const { port, capability } = await f.descriptor();
  await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
  await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').dataset.revision;"));
  // Hold the live-reload fetch so the displayed revision stays old.
  await browser.evaluate("const original=window.fetch; window.fetch=(url,options)=>url==='/snapshot'?new Promise(()=>{}):original(url,options); return true;");
  await writeFile(f.file, artifact('New unseen version'));
  await browser.evaluate("document.querySelector('#message').value='Keep this draft'; document.querySelector('#approve').click(); return true;");
  await eventually(() => browser.evaluate("return document.querySelector('#notice').textContent.includes('changed');"));
  assert.equal((await f.cli('poll', f.file, '--timeout', '0')).status, 'open');
  await browser.evaluate("document.querySelector('#decline').click(); return true;");
  await eventually(() => browser.evaluate("return document.body.dataset.status === 'declined';"));
  const declined = await f.cli('poll', f.file, '--timeout', '0');
  assert.equal(declined.events.find(event => event.action === 'decline').message, 'Keep this draft');
  await f.cli('open', f.file, '--no-browser');
  await browser.navigate('about:blank');
  assert.equal((await f.cli('poll', f.file, '--timeout', '0')).status, 'open');
});
