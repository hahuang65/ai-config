// PROTOTYPE — NOT PRODUCTION. Exercise the unchanged review renderer in isolated state.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const execute = promisify(execFile);
const executable = resolve(import.meta.dirname, '../../target/debug/review-artifact');

export async function reviewSnapshot(root, name, html) {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'artifact.html');
  const env = { ...process.env, AR_ROOT: join(directory, 'state') };
  const cli = (...args) => execute(executable, args, { env, timeout: 15000, maxBuffer: 1000000 });
  await writeFile(file, html);
  try {
    await cli('open', file, '--no-browser');
    const [key] = (await readdir(env.AR_ROOT)).filter(value => /^[a-f0-9]{64}$/.test(value));
    const descriptor = JSON.parse(await readFile(join(env.AR_ROOT, key, 'server.json'), 'utf8'));
    const origin = `http://127.0.0.1:${descriptor.port}`;
    const response = await fetch(`${origin}/snapshot`, { signal: AbortSignal.timeout(5000),
      headers: { Origin: origin, Authorization: `Bearer ${descriptor.capability}` } });
    if (!response.ok) return { status: response.status };
    return { status: response.status, ...(await response.json()) };
  } finally {
    await cli('stop', file).catch(() => {});
  }
}
