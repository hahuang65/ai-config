import { setTimeout as sleep } from 'node:timers/promises';

export const SHUTDOWN_GRACE_MS = 300;
export const SHUTDOWN_POLL_MS = 10;

// These dependencies also let the fixture's timing contract be tested without Firefox.
export async function stopProcessGroup(pid, { signal = process.kill, wait = sleep, now = () => performance.now() } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  try { signal(-pid, 'SIGTERM'); } catch {}
  const deadline = now() + SHUTDOWN_GRACE_MS;
  while (now() < deadline) {
    try { signal(-pid, 0); }
    catch (error) { if (error.code === 'ESRCH') return; }
    await wait(Math.max(0, Math.min(SHUTDOWN_POLL_MS, deadline - now())));
  }
  try { signal(-pid, 'SIGKILL'); } catch {}
}
