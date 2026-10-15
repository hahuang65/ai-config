import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

async function geometry(browser) {
  return browser.evaluate(`
    const frame = document.querySelector('#artifact');
    const origin = frame.getBoundingClientRect();
    const target = frame.contentDocument.querySelector('#selected, .selected').getBoundingClientRect();
    const editor = document.querySelector('#annotation-editor');
    const highlight = document.querySelector('#annotation-highlight');
    const box = element => { const r = element.getBoundingClientRect(); return { left:r.left, top:r.top, right:r.right, bottom:r.bottom }; };
    return { target: { left:origin.left+target.left, top:origin.top+target.top, right:origin.left+target.right, bottom:origin.top+target.bottom },
      editor: box(editor), highlight: highlight ? box(highlight) : null,
      visible: !!highlight && !highlight.hidden && !editor.hidden,
      border: highlight ? getComputedStyle(highlight).borderTopStyle : 'none',
      inSidebar: !!editor.closest('.conversation'), focus: document.activeElement.id,
      viewport: { width:innerWidth, height:innerHeight } };
  `);
}

function assertAnchored(state) {
  assert.equal(state.visible, true);
  assert.equal(state.inSidebar, false);
  assert.notEqual(state.border, 'none');
  for (const edge of ['left', 'top', 'right', 'bottom']) {
    assert.ok(Math.abs(state.highlight[edge] - state.target[edge]) <= 2, `highlight ${edge} must follow the selected element`);
  }
  const gaps = [state.editor.top-state.target.bottom, state.target.top-state.editor.bottom,
    state.editor.left-state.target.right, state.target.left-state.editor.right];
  assert.ok(gaps.some(gap => gap >= 0 && gap <= 12), 'comment editor must be adjacent to the target');
  assert.ok(state.editor.left >= 0 && state.editor.right <= state.viewport.width);
  assert.ok(state.editor.top >= 0 && state.editor.bottom <= state.viewport.height);
}

function registerTextSelection({ fixture, eventually }) {
  test('selected text has its own outline and adding its comment clears the selection without losing feedback', { timeout: 30000 }, async t => {
    const f = await fixture(t);
    await writeFile(f.file, '<html><body><p id="selected">Before selected words after.</p></body></html>');
    const browser = await f.startBrowser();
    const { port, capability } = await f.descriptor();
    await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
    await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').dataset.revision;"));
    const selected = await browser.evaluate(`
      const frame = document.querySelector('#artifact'), doc = frame.contentDocument;
      const range = doc.createRange(), text = doc.querySelector('#selected').firstChild;
      range.setStart(text, 7); range.setEnd(text, 21);
      doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range);
      const r = range.getBoundingClientRect(), origin = frame.getBoundingClientRect();
      doc.dispatchEvent(new MouseEvent('mouseup', { bubbles:true }));
      return { left:origin.left+r.left, top:origin.top+r.top, right:origin.left+r.right, bottom:origin.top+r.bottom };
    `);
    assertAnchored({ ...await geometry(browser), target: selected });
    await browser.evaluate("document.querySelector('#annotation-comment').value='A comment on exactly these words'; document.querySelector('#add-annotation').click(); return true;");
    assert.equal(await browser.evaluate("return document.querySelector('#artifact').contentDocument.getSelection().toString();"), '');
    assert.equal(await browser.evaluate("return document.querySelector('#annotation-highlight').hidden && document.querySelector('#annotation-editor').hidden;"), true);
    await browser.evaluate("document.querySelector('#send').click(); return true;");
    await eventually(async () => (await f.cli('poll', f.file, '--timeout', '0')).events.length === 1);
    const event = (await f.cli('poll', f.file, '--timeout', '0')).events[0];
    assert.equal(event.annotations[0].kind, 'selection');
    assert.equal(event.annotations[0].text, 'selected words');
    assert.equal(event.annotations[0].comment, 'A comment on exactly these words');
  });
}

function registerDraftRecovery({ fixture, eventually }) {
  test('annotation drafts survive reload and do not highlight a changed revision as their original target', { timeout: 30000 }, async t => {
    const f = await fixture(t);
    await writeFile(f.file, '<html><body><p class="selected">Original target</p></body></html>');
    const browser = await f.startBrowser();
    const { port, capability } = await f.descriptor();
    await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
    await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').dataset.revision;"));
    const revision = await browser.evaluate(`
      document.querySelector('#artifact').contentDocument.querySelector('.selected').click();
      const input = document.querySelector('#annotation-comment');
      input.value='Retain the original comment'; input.dispatchEvent(new Event('input', { bubbles:true }));
      return document.querySelector('#artifact').dataset.revision;
    `);
    await browser.reload();
    await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').dataset.revision;"));
    assertAnchored(await geometry(browser));
    assert.equal(await browser.evaluate("return document.querySelector('#annotation-comment').value;"), 'Retain the original comment');
    await writeFile(f.file, '<html><body><p class="selected">New content at the same location</p></body></html>');
    await eventually(() => browser.evaluate(`return document.querySelector('#artifact').dataset.revision !== ${JSON.stringify(revision)} && document.querySelector('#annotation-position-note').textContent.includes('earlier');`));
    assert.equal(await browser.evaluate("return document.querySelector('#annotation-highlight').hidden;"), true);
    assert.equal(await browser.evaluate("return document.querySelector('#annotation-comment').value;"), 'Retain the original comment');
    await browser.evaluate("document.querySelector('#add-annotation').click(); document.querySelector('#send').click(); return true;");
    await eventually(async () => (await f.cli('poll', f.file, '--timeout', '0')).events.length === 1);
    const event = (await f.cli('poll', f.file, '--timeout', '0')).events[0];
    assert.equal(event.annotations[0].revision, revision);
    assert.equal(event.annotations[0].text, 'Original target');
    assert.equal(event.annotations[0].comment, 'Retain the original comment');
  });
}

export function registerAnnotationPopoverCases({ fixture, eventually }) {
  registerTextSelection({ fixture, eventually });
  registerDraftRecovery({ fixture, eventually });
  test('annotation selection is outlined and its nearby editor follows scroll and narrow layouts', { timeout: 30000 }, async t => {
    const f = await fixture(t);
    const original = '<html><body><main style="min-height:2000px;padding:1px 24px"><p id="selected" style="margin-top:150px;padding:12px">Select this element and keep its location visible.</p></main></body></html>';
    await writeFile(f.file, original);
    const browser = await f.startBrowser();
    const { port, capability } = await f.descriptor();
    await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
    await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').dataset.revision;"));
    await browser.evaluate("document.querySelector('#artifact').contentDocument.querySelector('#selected').click(); return true;");
    const first = await geometry(browser);
    assertAnchored(first);
    assert.equal(first.focus, 'annotation-comment');
    await browser.evaluate("document.querySelector('#annotation-comment').value='Keep this draft'; document.querySelector('#artifact').contentWindow.scrollBy(0,60); return true;");
    await eventually(async () => (await geometry(browser)).highlight?.top < first.highlight.top - 50);
    assertAnchored(await geometry(browser));
    await browser.narrow();
    await eventually(async () => (await geometry(browser)).viewport.width < 500);
    assertAnchored(await geometry(browser));
    assert.equal(await browser.evaluate("return document.querySelector('#annotation-comment').value;"), 'Keep this draft');
    await browser.evaluate("document.querySelector('#cancel-annotation').click(); return true;");
    assert.equal(await browser.evaluate("return document.querySelector('#annotation-editor').hidden && document.querySelector('#annotation-highlight').hidden;"), true);
    assert.deepEqual((await f.cli('poll', f.file, '--timeout', '0')).events, []);
    assert.equal(await readFile(f.file, 'utf8'), original);
  });
}
