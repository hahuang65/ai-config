import { spawn } from "node:child_process";

import { signalExitCode } from "./signal-status.mjs";

const TERMINATION_GRACE_MS = 1_000;

export function spawnInForeground(command, args, options, dependencies = {}) {
  const processRef = dependencies.processRef ?? process;
  const spawnChild = dependencies.spawnChild ?? spawn;
  const status = dependencies.status;
  const cancellation = dependencies.cancellation;
  return new Promise((resolve, reject) => {
    const child = spawnChild(command, args, options);
    const stdoutDecoder = createLineDecoder(parsePiEvent(status));
    const stderrDecoder = createLineDecoder((line) => status?.childError?.(line));
    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");
    child.stdout?.on?.("data", stdoutDecoder.write);
    child.stderr?.on?.("data", stderrDecoder.write);
    const lifecycle = createForegroundLifecycle({
      child,
      status,
      cancellation,
      processRef,
      stdoutDecoder,
      stderrDecoder,
      resolve,
      reject,
      setTimeoutFn: dependencies.setTimeoutFn ?? setTimeout,
      clearTimeoutFn: dependencies.clearTimeoutFn ?? clearTimeout,
    });
    child.once("error", lifecycle.onError);
    child.once("close", lifecycle.onClose);
    status?.setLifecycleFailureHandler?.(lifecycle.onFailure);
    try {
      status?.throwIfFailed?.();
    } catch (error) {
      lifecycle.onFailure(error);
    }
  });
}

function createForegroundLifecycle(context) {
  const { child, status, cancellation, processRef } = context;
  const state = { interruptedSignal: null, failure: null, settled: false, terminationTimer: null };
  const termination = createTerminationScheduler(
    child, state, context.setTimeoutFn, context.clearTimeoutFn,
  );
  const interrupt = (signal) => {
    if (state.interruptedSignal || state.settled) return;
    state.interruptedSignal = signal;
    try {
      termination.request(signal);
    } catch (error) {
      settlement.rejectOnce(error);
    }
  };
  const onSigint = () => interrupt("SIGINT");
  const onSigterm = () => interrupt("SIGTERM");
  const settlement = createLifecycleSettlement({
    ...context, state, clearTerminationTimer: termination.clear, onSigint, onSigterm,
  });
  if (cancellation) cancellation.attachChild(interrupt);
  else attachSignalForwarding(processRef, status, interrupt, onSigint, onSigterm);
  return {
    onFailure(error) {
      if (state.failure || state.settled) return;
      state.failure = error;
      try {
        termination.request("SIGTERM", () => settlement.rejectOnce(error));
      } catch {
        settlement.rejectOnce(error);
      }
    },
    onError(error) {
      settlement.rejectOnce(state.failure ?? error);
    },
    onClose: settlement.onClose,
  };
}

function createTerminationScheduler(child, state, setTimeoutFn, clearTimeoutFn) {
  const request = (signal, onEscalation) => {
    child.kill(signal);
    if (state.settled || state.terminationTimer !== null) return;
    state.terminationTimer = setTimeoutFn(() => {
      state.terminationTimer = null;
      try {
        child.kill("SIGKILL");
      } finally {
        onEscalation?.();
      }
    }, TERMINATION_GRACE_MS);
  };
  const clear = () => {
    if (state.terminationTimer === null) return;
    clearTimeoutFn(state.terminationTimer);
    state.terminationTimer = null;
  };
  return { request, clear };
}

function createLifecycleSettlement(context) {
  const {
    state, stdoutDecoder, stderrDecoder, resolve, reject,
  } = context;
  const cleanup = () => cleanupForegroundLifecycle(context);
  const rejectOnce = (error) => {
    if (state.settled) return;
    state.settled = true;
    cleanup();
    reject(error);
  };
  const onClose = (code, signal) => {
    if (state.settled) return;
    stdoutDecoder.end();
    stderrDecoder.end();
    if (state.failure) return rejectOnce(state.failure);
    state.settled = true;
    cleanup();
    resolve(code ?? signalExitCode(state.interruptedSignal ?? signal, 1));
  };
  return { rejectOnce, onClose };
}

function cleanupForegroundLifecycle(context) {
  const {
    status, cancellation, processRef, clearTerminationTimer, onSigint, onSigterm,
  } = context;
  clearTerminationTimer();
  status?.setLifecycleFailureHandler?.(null);
  if (cancellation) {
    cancellation.detachChild();
    return;
  }
  detachSignalForwarding(processRef, status, onSigint, onSigterm);
}

function attachSignalForwarding(processRef, status, interrupt, onSigint, onSigterm) {
  status?.setAbortHandler?.(interrupt);
  processRef.once("SIGINT", onSigint);
  processRef.once("SIGTERM", onSigterm);
}

function detachSignalForwarding(processRef, status, onSigint, onSigterm) {
  processRef.removeListener("SIGINT", onSigint);
  processRef.removeListener("SIGTERM", onSigterm);
  status?.setAbortHandler?.(null);
}

function parsePiEvent(status) {
  return (line) => {
    if (!line) return;
    try {
      status?.piEvent?.(JSON.parse(line));
    } catch {
      status?.childError?.("Ignored malformed pi event");
    }
  };
}

function createLineDecoder(onLine) {
  const maximumBuffer = 2 * 1024 * 1024;
  let buffer = "";
  return {
    write(chunk) {
      buffer += String(chunk);
      if (buffer.length > maximumBuffer) {
        buffer = "";
        onLine("Ignored oversized pi event");
        return;
      }
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) onLine(line.replace(/\r$/, ""));
    },
    end() {
      if (buffer) onLine(buffer.replace(/\r$/, ""));
      buffer = "";
    },
  };
}
