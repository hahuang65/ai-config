const TIMEOUT = 15000;
const METHODS = new Set(['session.new', 'browser.createUserContext', 'browser.removeUserContext',
  'browser.getUserContexts', 'browsingContext.create', 'browsingContext.getTree',
  'browsingContext.setViewport', 'browsingContext.navigate', 'browsingContext.reload', 'script.evaluate']);
const failure = (method, reason) => new Error(`Firefox ${METHODS.has(method) ? method : 'command'} ${reason}`);

function settle(pending, id, reason, result) {
  const waiter = pending.get(id);
  if (!waiter) return;
  pending.delete(id);
  clearTimeout(waiter.timer);
  if (reason) waiter.reject(failure(waiter.method, reason));
  else waiter.resolve(result);
}

function receive(pending, close, event) {
  let message;
  try { message = JSON.parse(String(event.data)); }
  catch { close('received an invalid response'); return; }
  if (!message || typeof message !== 'object') { close('received an invalid response'); return; }
  settle(pending, message.id, message.type === 'error' ? 'rejected the request' : null, message.result);
}

export function requester(socket, { signal } = {}) {
  let sequence = 0, closed;
  const pending = new Map();
  const onMessage = event => receive(pending, close, event);
  const onClose = () => close('connection closed');
  const onError = () => close('connection failed');
  const onAbort = () => close('cancelled');
  function close(reason = 'connection closed') {
    if (closed) return;
    closed = reason;
    signal?.removeEventListener('abort', onAbort);
    socket.removeEventListener('message', onMessage);
    socket.removeEventListener('close', onClose);
    socket.removeEventListener('error', onError);
    for (const id of pending.keys()) settle(pending, id, reason);
  }
  const request = (method, params) => new Promise((resolve, reject) => {
    if (closed) { reject(failure(method, closed)); return; }
    const id = ++sequence;
    const timer = setTimeout(() => settle(pending, id, 'timed out'), TIMEOUT);
    pending.set(id, { resolve, reject, timer, method });
    try { socket.send(JSON.stringify({ id, method, params })); }
    catch { settle(pending, id, 'could not be sent'); }
  });
  socket.addEventListener('message', onMessage);
  socket.addEventListener('close', onClose);
  socket.addEventListener('error', onError);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  return Object.assign(request, { close });
}
