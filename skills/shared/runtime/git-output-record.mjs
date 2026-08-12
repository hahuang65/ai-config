const FORBIDDEN_RECORD_CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

export function parseSafeGitOutputRecord(stdout) {
  if (typeof stdout !== "string") return null;
  const record = stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;
  return FORBIDDEN_RECORD_CONTROL.test(record) ? null : record;
}
