import assert from 'node:assert/strict';

export async function interruptBrowserDelivery(browser, cli, file, eventually) {
  await browser.evaluate(`
    const original = window.fetch;
    let interrupt = true;
    window.fetch = async (url, options) => {
      const response = await original(url, options);
      if (url === '/submit' && interrupt) { interrupt = false; throw new Error('Simulated response loss'); }
      return response;
    };
    document.querySelector('#message').value = 'Retain after interrupted response';
    document.querySelector('#send').click();
    return true;
  `);
  await eventually(() => browser.evaluate("return !document.querySelector('#retry').hidden;"));
  await browser.evaluate("document.querySelector('#retry').click(); return true;");
  await eventually(() => browser.evaluate("return document.querySelector('#retry').hidden && document.querySelector('#message').value === '';"));
  const events = await cli('poll', file, '--timeout', '0');
  assert.equal(events.events.filter(event => event.message === 'Retain after interrupted response').length, 1);
}
