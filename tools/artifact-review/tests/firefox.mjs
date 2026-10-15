import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { stopProcessGroup } from './firefox-process.mjs';

const TIMEOUT = 15000;

// Standalone WebDriver BiDi fixture; no review runtime or browser package imports.
export async function launchFirefox(profile) {
  await mkdir(profile, { recursive: true });
  const child = spawn(process.env.FIREFOX_BIN || '/Applications/Firefox.app/Contents/MacOS/firefox',
    ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', '0', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  let socket;
  const close = async () => {
    socket?.close();
    await stopProcessGroup(child.pid);
  };
  try {
    const endpoint = await discover(child);
    socket = await connect(`${endpoint}/session`);
    const request = requester(socket);
    await request('session.new', { capabilities: { alwaysMatch: {} } });
    const contexts = async () => (await request('browsingContext.getTree', { maxDepth: 0 })).contexts;
    const initial = await contexts();
    if (initial.length !== 1 || initial[0].url !== 'about:blank') throw new Error('Expected one blank startup tab');
    // Keep the pristine default tab as an anchor; cases use disposable user contexts.
    return { request, close, processId: child.pid };
  } catch {
    await close();
    throw new Error('Firefox fixture could not start');
  }
}

function discover(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => finish(), TIMEOUT);
    const onData = chunk => {
      output = (output + chunk.toString()).slice(-8192);
      const match = output.match(/WebDriver BiDi listening on (ws:\/\/[^\s]+)/);
      if (match) finish(match[1]);
    };
    function finish(url) {
      clearTimeout(timer);
      child.stderr.off('data', onData);
      child.stderr.resume();
      child.off('error', onError);
      child.off('exit', onError);
      if (url) resolve(url); else reject(new Error('Firefox endpoint unavailable'));
    }
    const onError = () => finish();
    child.stderr.on('data', onData);
    child.once('error', onError);
    child.once('exit', onError);
  });
}

async function connect(url) {
  const deadline = Date.now() + TIMEOUT;
  while (Date.now() < deadline) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = new WebSocket(url);
        const timer = setTimeout(() => { socket.close(); reject(); }, 500);
        socket.addEventListener('open', () => { clearTimeout(timer); resolve(socket); }, { once: true });
        socket.addEventListener('error', () => { clearTimeout(timer); reject(); }, { once: true });
      });
    } catch { await sleep(50); }
  }
  throw new Error('Firefox connection timed out');
}

function requester(socket) {
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.type === 'error') waiter.reject(new Error(`Firefox ${waiter.method} failed (${String(message.error).replace(/[^a-z -]/g, '').slice(0, 60)})`));
    else waiter.resolve(message.result);
  });
  return (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Firefox command timed out')); }, TIMEOUT);
    pending.set(id, { resolve, reject, timer, method });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
