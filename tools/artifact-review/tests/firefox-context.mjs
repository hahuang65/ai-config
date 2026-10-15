async function removeContext(request, userContext) {
  await request('browser.removeUserContext', { userContext });
  const { contexts } = await request('browsingContext.getTree', { maxDepth: 0 });
  const { userContexts } = await request('browser.getUserContexts', {});
  if (contexts.some(item => item.userContext === userContext)
    || userContexts.some(item => item.userContext === userContext)) {
    throw new Error('Firefox context cleanup was incomplete');
  }
}

// A WebDriver user context isolates origin storage, not merely page globals.
export async function openFirefoxContext({ request, processId }) {
  const { userContext } = await request('browser.createUserContext', {});
  const { context } = await request('browsingContext.create', { type: 'tab', userContext });
  await request('browsingContext.setViewport', { context, viewport: { width: 1280, height: 900 } });
  let closing;
  const command = (method, params) => {
    if (closing) return Promise.reject(new Error('Firefox case is closed'));
    return request(method, params);
  };
  return {
    processId,
    close: () => closing ??= removeContext(request, userContext),
    contexts: async () => (await command('browsingContext.getTree', { maxDepth: 0 })).contexts
      .filter(item => item.userContext === userContext),
    openTab: () => command('browsingContext.create', { type: 'tab', userContext }),
    navigate: url => command('browsingContext.navigate', { context, url, wait: 'complete' }),
    reload: () => command('browsingContext.reload', { context, wait: 'complete' }),
    evaluate: async expression => {
      const response = await command('script.evaluate', {
        expression: `(async () => { ${expression} })().then(value => JSON.stringify(value))`,
        target: { context }, awaitPromise: true,
      });
      if (response.type !== 'success') throw new Error('Firefox evaluation failed');
      return JSON.parse(response.result.value);
    },
    narrow: () => command('browsingContext.setViewport', { context, viewport: { width: 420, height: 900 } }),
  };
}
