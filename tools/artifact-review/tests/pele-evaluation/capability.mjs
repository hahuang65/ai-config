// PROTOTYPE — NOT PRODUCTION. Intentionally red capability probe, not a production gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewSnapshot } from './review-snapshot.mjs';

const root = process.env.PELE_EVAL_ROOT;
assert.ok(root, 'Set PELE_EVAL_ROOT to an isolated evaluation directory');

test('a review artifact retains a static vector diagram and its label', { timeout: 25000 }, async () => {
  const result = await reviewSnapshot(root, 'svg-capability', `<!doctype html><h1>Vector diagram</h1>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80">
      <rect x="1" y="1" width="198" height="78" fill="#fff" stroke="#111"/>
      <text x="12" y="44">Review queued</text>
    </svg>`);
  assert.equal(result.status, 200);
  assert.match(result.html, /<svg\b/, 'The diagram must remain visible before it can be reviewed');
  assert.match(result.html, /Review queued/);
});
