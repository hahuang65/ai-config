const SIGNAL_EXIT_CODES = Object.freeze({
  SIGINT: 130,
  SIGTERM: 143,
});

export function signalExitCode(signal, fallback) {
  return SIGNAL_EXIT_CODES[signal] ?? fallback;
}
