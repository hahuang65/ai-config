import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicationFixture } from './publication-fixture.mjs';

export function registerStandaloneCases({ firefox, eventually }) {
  test('standalone feedback revises the same report and accepts another round of feedback', { timeout: 45000 }, async t => {
    const f = await publicationFixture(t, { local: true, standalone: true, responder: true });
    f.responder.recover({ summary: 'Clarified report summary.', findings: [{ id: 'F1', title: 'Clarified finding' }] });
    const browser = await firefox(t);
    try {
      const { port, capability } = f.descriptor;
      await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
      await eventually(() => browser.evaluate("return !document.querySelector('#send').disabled;"));
      await browser.evaluate("document.querySelector('#message').value='Clarify the review'; document.querySelector('#send').click(); return true;");
      await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').contentDocument?.body?.textContent.includes('Clarified finding');"));
      const updated = await f.cli('poll', f.report, '--timeout', '0');
      assert.equal(updated.processing.state, 'updated');
      assert.equal(updated.finding_review.needs_review, false);
      f.responder.recover();
      await browser.evaluate("document.querySelector('#message').value='Explain the revised report'; document.querySelector('#send').click(); return true;");
      await eventually(() => browser.evaluate("return document.querySelectorAll('#messages [data-event-action=\"reply\"]').length === 2;"));
      assert.equal((await f.cli('poll', f.report, '--timeout', '0')).processing.state, 'answered');
    } finally { await browser.close(); }
  });
  test('report wording discards unconfirmed drafts but preserves publication outcomes', { timeout: 45000 }, async t => {
    const f = await publicationFixture(t, { standalone: true, responder: true });
    const browser = await firefox(t);
    try {
      const { port, capability } = f.descriptor;
      await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
      await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').contentDocument?.querySelector('[data-publication-comment=\"F1\"]');"));
      await browser.evaluate(`const doc=document.querySelector('#artifact').contentDocument; const field=doc.querySelector('[data-publication-comment="F1"]');
        field.value='My exact publication draft'; field.dispatchEvent(new Event('input')); doc.querySelector('[data-publish-finding="F1"]').click(); return true;`);
      f.responder.recover({ findings: [{ id: 'F1', title: 'Clarified before publication' }] });
      await browser.evaluate("document.querySelector('#message').value='Clarify wording'; document.querySelector('#send').click(); return true;");
      await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').contentDocument?.body?.textContent.includes('Clarified before publication');"));
      await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').contentDocument.querySelector('[data-publication-comment=\"F1\"]');"));
      const current = await (await f.api('/publication')).json();
      assert.equal(await browser.evaluate("return document.querySelector('#artifact').contentDocument.querySelector('[data-publication-comment=\"F1\"]').value;"), current.items[0].body);
      assert.equal(await browser.evaluate("return document.querySelector('#artifact').contentDocument.querySelector('[data-publish-finding=\"F1\"]').checked;"), false);
      await browser.evaluate("const doc=document.querySelector('#artifact').contentDocument; doc.querySelector('[data-publish-finding=\"F1\"]').click(); doc.querySelector('[data-publication-publish]').click(); return true;");
      await eventually(() => browser.evaluate("return document.querySelector('#submission-status').textContent.includes('Comments published');"));
      assert.equal((await f.provider()).posts, 1);
      f.responder.recover({ findings: [{ id: 'F1', title: 'Clarified after publication' }] });
      await browser.evaluate("document.querySelector('#message').value='Explain more clearly'; document.querySelector('#send').click(); return true;");
      await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').contentDocument?.body?.textContent.includes('Clarified after publication');"));
      await eventually(() => browser.evaluate("return document.querySelector('#submission-status').textContent.includes('Comments published');"));
      assert.equal((await f.api('/publication')).status, 200);
      assert.equal((await (await f.api('/publication')).json()).status, 'posted');
      assert.equal((await f.provider()).posts, 1);
      assert.equal(await browser.evaluate("return document.querySelector('#artifact').contentDocument.querySelectorAll('[data-publication-comment]').length;"), 0);
    } finally { await browser.close(); }
  });

  test('a report rewrite reconciles the existing uncertain publication without another POST', { timeout: 45000 }, async t => {
    const f = await publicationFixture(t, { standalone: true, responder: true });
    const browser = await firefox(t);
    try {
      const provider = await f.provider();
      const { writeFile } = await import('node:fs/promises');
      await writeFile(f.state, JSON.stringify({ ...provider, lose: true }));
      const { port, capability } = f.descriptor;
      await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
      await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').contentDocument?.querySelector('[data-publish-finding=\"F1\"]');"));
      await browser.evaluate("const doc=document.querySelector('#artifact').contentDocument; doc.querySelector('[data-publish-finding=\"F1\"]').click(); doc.querySelector('[data-publication-publish]').click(); return true;");
      await eventually(() => browser.evaluate("return document.querySelector('#submission-status').dataset.state === 'uncertain';"));
      f.responder.recover({ findings: [{ id: 'F1', title: 'Clarified while publication is uncertain' }] });
      await browser.evaluate("document.querySelector('#message').value='Clarify wording'; document.querySelector('#send').click(); return true;");
      await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').contentDocument?.body?.textContent.includes('Clarified while publication is uncertain');"));
      const state = await (await f.api('/publication')).json();
      assert.equal(state.status, 'uncertain');
      assert.equal((await f.provider()).posts, 1);
      assert.equal((await f.api('/publication/reconcile', {})).status, 200);
      assert.equal((await (await f.api('/publication')).json()).status, 'posted');
      assert.equal((await f.provider()).posts, 1);
    } finally { await browser.close(); }
  });

  test('an accepted finding keeps its original authorization when report wording changes', { timeout: 30000 }, async t => {
    const f = await publicationFixture(t, { local: true });
    const before = await f.cli('poll', f.report, '--timeout', '0');
    assert.equal((await f.api('/submit', { id: 'wording-accept-0001', action: 'accept', finding: 'F1',
      revision: before.current_revision, message: 'Repair this finding', annotations: [] })).status, 200);
    const result = await f.cli('revise', f.report, '--revision', before.current_revision,
      '--report-digest', before.finding_review.report_digest, '--edit', JSON.stringify({ findings: [{ id: 'F1', title: 'Clearer description of the same finding' }] }));
    assert.equal(result.updated, true);
    const after = await f.cli('poll', f.report, '--timeout', '0');
    assert.equal(after.finding_review.needs_review, false);
    assert.equal(after.finding_review.items[0].decision, 'accept');
    assert.equal(after.finding_review.items[0].authorization.revision, before.current_revision);
    assert.equal(after.finding_review.items[0].authorization.finding.title, before.finding_review.items[0].title);
    assert.equal((await f.api('/submit', { id: 'wording-accept-0002', action: 'accept', finding: 'F1',
      revision: after.current_revision, message: 'Duplicate decision', annotations: [] })).status, 409);
  });

  for (const closed of ['decided', 'declined']) {
    test(`a ${closed} report displays owned wording updates without reopening decisions`, { timeout: 30000 }, async t => {
      const f = await publicationFixture(t, { local: true });
      const browser = await firefox(t);
      try {
        const { port, capability } = f.descriptor;
        await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
        await eventually(() => browser.evaluate("return document.querySelector('#artifact').contentDocument?.querySelector('#F1 [data-decision=\"accept\"]')?.disabled === false;"));
        await browser.evaluate("document.querySelector('#artifact').contentDocument.querySelector('#F1 [data-decision=\"accept\"]').click(); return true;");
        await eventually(() => browser.evaluate("return document.querySelector('#artifact').contentDocument?.querySelector('#F2 [data-decision=\"reject\"]')?.disabled === false;"));
        await browser.evaluate(`document.querySelector('#message').value='Clarify the report wording';
          ${closed === 'decided' ? "document.querySelector('#artifact').contentDocument.querySelector('#F2 [data-decision=\"reject\"]').click();" : "document.querySelector('#decline').click();"} return true;`);
        await eventually(() => browser.evaluate(`return document.body.dataset.status === '${closed}';`));
        const before = await f.cli('poll', f.report, '--timeout', '0');
        assert.equal(before.events.at(-1).message, 'Clarify the report wording');
        await f.cli('revise', f.report, '--revision', before.current_revision,
          '--report-digest', before.finding_review.report_digest, '--edit', JSON.stringify({ summary: 'Updated after the final decision.' }));
        await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').contentDocument?.body?.textContent.includes('Updated after the final decision.');"));
        assert.equal(await browser.evaluate("return document.body.dataset.status;"), closed);
        assert.equal(await browser.evaluate("return document.querySelector('#notice').textContent.includes('fresh review');"), false);
        await eventually(() => browser.evaluate("return document.querySelector('#artifact').contentDocument.querySelectorAll('[data-decision]:disabled').length === 4;"));
        const after = await f.cli('poll', f.report, '--timeout', '0');
        assert.deepEqual(after.finding_review.items.map(item => item.decision), ['accept', closed === 'decided' ? 'reject' : null]);
        assert.equal(after.finding_review.items[0].authorization.revision, before.current_revision);
      } finally { await browser.close(); }
    });
  }

  test('standalone feedback can retry a failed responder without losing drafts', { timeout: 45000 }, async t => {
    const f = await publicationFixture(t, { local: true, standalone: true, responder: true });
    const browser = await firefox(t);
    try {
      const { port, capability } = f.descriptor;
      await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
      await eventually(() => browser.evaluate("return !document.querySelector('#send').disabled;"));
      await browser.evaluate("document.querySelector('#message').value='Explain this finding'; document.querySelector('#send').click(); return true;");
      await eventually(() => browser.evaluate("return document.querySelector('#submission-status').dataset.state === 'needs_attention';"));
      assert.equal(await browser.evaluate("return !!document.querySelector('#retry-response') && !document.querySelector('#retry-response').hidden;"), true);
      await browser.evaluate("const field=document.querySelector('#message'); field.value='Keep this unsent follow-up'; field.dispatchEvent(new Event('input')); return true;");
      f.responder.recover();
      await browser.evaluate("document.querySelector('#retry-response').click(); return true;");
      await eventually(() => browser.evaluate("return document.querySelector('#submission-status').dataset.state === 'answered';"));
      assert.equal(await browser.evaluate("return document.querySelector('#message').value;"), 'Keep this unsent follow-up');
      assert.equal(await browser.evaluate("return document.querySelector('#messages').textContent.includes('Recovered the read-only discussion.');"), true);
      assert.equal(f.responder.requests.length, 2);
      assert.equal(await browser.evaluate("return document.querySelector('#artifact').contentDocument.querySelectorAll('[data-decision]').length;"), 0);
    } finally { await browser.close(); }
  });

  test('standalone local reviews keep readable findings and feedback without repair controls', { timeout: 30000 }, async t => {
    const f = await publicationFixture(t, { local: true, standalone: true });
    const browser = await firefox(t);
    try {
      const { port, capability } = f.descriptor;
      await browser.navigate(`http://127.0.0.1:${port}/#${capability}`);
      await eventually(() => browser.evaluate("return !!document.querySelector('#artifact').dataset.revision;"));
      assert.deepEqual(await browser.evaluate(`const doc = document.querySelector('#artifact').contentDocument;
        return { findings: doc.querySelectorAll('article[id^="F"]').length,
          repairs: doc.querySelectorAll('[data-decision]').length,
          publication: doc.querySelectorAll('[data-publication-publish]').length,
          approveHidden: document.querySelector('#approve').hidden,
          feedbackEnabled: !document.querySelector('#send').disabled };`),
        { findings: 2, repairs: 0, publication: 0, approveHidden: true, feedbackEnabled: true });
      const page = await f.cli('poll', f.report, '--timeout', '0');
      assert.equal(page.finding_review.read_only, true);
      assert.equal(page.processing.responder, 'standalone');
      await browser.evaluate("const field=document.querySelector('#message'); field.value='Preserve this unsent question'; field.dispatchEvent(new Event('input')); return true;");
      await browser.reload();
      await eventually(() => browser.evaluate("return document.querySelector('#message').value === 'Preserve this unsent question';"));
    } finally { await browser.close(); }
  });
}
