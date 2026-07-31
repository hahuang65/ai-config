export function createLifecycleCancellation({ processRef = process, status }) {
  let interruptedSignal = null;
  let childAbort = null;
  const controller = new AbortController();
  const cancel = (signal) => {
    if (interruptedSignal) return;
    interruptedSignal = signal;
    controller.abort(signal);
    childAbort?.(signal);
    status?.interrupt?.(signal);
  };
  const onSigint = () => cancel("SIGINT");
  const onSigterm = () => cancel("SIGTERM");
  processRef.once("SIGINT", onSigint);
  processRef.once("SIGTERM", onSigterm);
  status?.setAbortHandler?.(cancel);

  return {
    signal: controller.signal,
    attachChild(handler) {
      childAbort = handler;
      if (interruptedSignal) handler(interruptedSignal);
    },
    detachChild() {
      childAbort = null;
    },
    throwIfAborted() {
      if (interruptedSignal) throw interruption(interruptedSignal);
    },
    exitCode() {
      return interruptedSignal ? signalExitCode(interruptedSignal) : null;
    },
    cleanup() {
      processRef.removeListener("SIGINT", onSigint);
      processRef.removeListener("SIGTERM", onSigterm);
      status?.setAbortHandler?.(null);
      childAbort = null;
    },
  };
}

function interruption(signal) {
  return Object.assign(new Error(`interrupted by ${signal}`), {
    code: "REVIEW_CHANGE_INTERRUPTED",
    exitCode: signalExitCode(signal),
  });
}

function signalExitCode(signal) {
  return signal === "SIGINT" ? 130 : 143;
}
