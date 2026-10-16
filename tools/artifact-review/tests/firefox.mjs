import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { stopProcessGroup } from './firefox-process.mjs';
import { requester } from './firefox-transport.mjs';

const TIMEOUT = 15000;

// Standalone WebDriver BiDi fixture; no review runtime or browser package imports.
export async function launchFirefox(profile, { signal, onStage = () => {}, spawnProcess = spawn,
  stop = stopProcessGroup, createSocket = url => new WebSocket(url),
  env = process.env, platform = process.platform } = {}) {
  let child, socket, request, closing, stage = 'profile preparation';
  const at = name => { stage = name; onStage(name); };
  const active = () => { if (signal?.aborted) throw new Error('Firefox startup cancelled'); };
  const close = () => closing ??= (async () => {
    signal?.removeEventListener('abort', cancel);
    request?.close();
    socket?.close();
    if (child) await stop(child.pid);
  })();
  const cancel = () => { if (child) void close().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    active();
    await mkdir(profile, { recursive: true });
    active();
    at('endpoint discovery');
    const executable = env.FIREFOX_BIN || (platform === 'darwin'
      ? '/Applications/Firefox.app/Contents/MacOS/firefox' : 'firefox');
    child = spawnProcess(executable,
      ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', '0', 'about:blank'],
      { env, stdio: ['ignore', 'ignore', 'pipe'], detached: true });
    active();
    const endpoint = await discover(child, signal);
    at('connection');
    socket = await connect(`${endpoint}/session`, signal, createSocket);
    active();
    request = requester(socket, { signal });
    at('session.new');
    await request('session.new', { capabilities: { alwaysMatch: {} } });
    at('browsingContext.getTree');
    const initial = (await request('browsingContext.getTree', { maxDepth: 0 })).contexts;
    if (initial.length !== 1 || initial[0].url !== 'about:blank') throw new Error('Invalid startup tab');
    // Keep the pristine default tab as an anchor; cases use disposable user contexts.
    return { request, close, processId: child.pid };
  } catch {
    socket?.close();
    await close();
    throw new Error(`Firefox ${stage} ${signal?.aborted ? 'cancelled' : 'failed'}`);
  }
}

function discover(child, signal) {
  return new Promise((resolve, reject) => {
    let output = '', finished = false;
    const timer = setTimeout(() => finish(), TIMEOUT);
    const onData = chunk => {
      output = (output + chunk.toString()).slice(-8192);
      const match = output.match(/WebDriver BiDi listening on (ws:\/\/[^\s]+)/);
      if (match) finish(match[1]);
    };
    function finish(url) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onError);
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
    signal?.addEventListener('abort', onError, { once: true });
    if (signal?.aborted) onError();
  });
}

async function connect(url, signal, createSocket) {
  const deadline = Date.now() + TIMEOUT;
  while (!signal?.aborted && Date.now() < deadline) {
    try { return await connectionAttempt(url, signal, createSocket); }
    catch {
      if (signal?.aborted) break;
      await sleep(50, undefined, { signal });
    }
  }
  throw new Error('Firefox connection unavailable');
}

function connectionAttempt(url, signal, createSocket) {
  return new Promise((resolve, reject) => {
    const socket = createSocket(url);
    const timer = setTimeout(() => finish(false), 500);
    let finished = false;
    const opened = () => finish(true), failed = () => finish(false);
    function finish(success) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', failed);
      socket.removeEventListener('open', opened);
      socket.removeEventListener('error', failed);
      socket.removeEventListener('close', failed);
      if (success && !signal?.aborted) resolve(socket);
      else { socket.close(); reject(new Error('Firefox connection unavailable')); }
    }
    socket.addEventListener('open', opened, { once: true });
    socket.addEventListener('error', failed, { once: true });
    socket.addEventListener('close', failed, { once: true });
    signal?.addEventListener('abort', failed, { once: true });
    if (signal?.aborted) failed();
  });
}
