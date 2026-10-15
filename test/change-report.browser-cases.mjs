import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { fixture, execute, changeBinary, modelServer, configureModel, repository, calls, answer } from './fixtures/reviewer.mjs';

export function registerChangeReportCase(firefox) {
  test('real Firefox renders the native change report safely at desktop and narrow widths', { timeout: 30000 }, async t => {
    const f = fixture(root => t.after(() => rm(root, { recursive: true, force: true })));
    const repo = await repository(f);
    const proposed = JSON.parse(answer);
    proposed.findings[0].title += ' ' + 'Long'.repeat(90);
    const { server } = modelServer(f.root, { answer: JSON.stringify(proposed), calls: calls(['scope.json', 'patch.diff'].map(path => ['read', { path }])) });
    let browser;
    try {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      configureModel(f.profile, server.address().port);
      const { stdout } = await execute(changeBinary, ['--root', f.evaluation, 'review', 'range', 'HEAD~1..HEAD', '--repo', repo,
        '--intent', 'Replace before with after', '--provider', 'reviewer-fixture', '--model', 'fixture-model', '--thinking', 'off', '--json'],
        { cwd: f.root, env: f.env, timeout: 20000, maxBuffer: 1024 * 1024 });
      const report = JSON.parse(stdout).report;
      browser = await firefox();
      await browser.navigate(pathToFileURL(report).href);
      const desktop = await browser.evaluate(`return {
        active: document.querySelectorAll('script,img,iframe,form,link').length,
        compromised: globalThis.compromised ?? false,
        title: document.querySelector('h4').textContent,
        headings: [...document.querySelectorAll('h2')].map(node => node.textContent),
        background: getComputedStyle(document.querySelector('section')).backgroundColor,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };`);
      assert.equal(desktop.active, 0);
      assert.equal(desktop.compromised, false);
      assert.match(desktop.title, /<img src=x/);
      assert.deepEqual(desktop.headings, ['Scope and intent', 'Findings', 'Evidence and limits']);
      assert.notEqual(desktop.background, 'rgba(0, 0, 0, 0)');
      assert.equal(desktop.overflow, false);
      await browser.narrow();
      assert.equal(await browser.evaluate('return document.documentElement.scrollWidth > document.documentElement.clientWidth;'), false);
    } finally {
      try { await browser?.close(); }
      finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(() => resolve()));
      }
    }
  });
}
