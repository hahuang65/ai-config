import { spawn } from "node:child_process";

interface FirefoxPoolOptions {
  executable: string;
  profile: string;
}

interface FirefoxContextOptions {
  width: number;
  height: number;
}

const REQUEST_TIMEOUT_MS = 10_000;
const CONNECT_RETRY_MS = 50;

export async function startFirefoxBidiPool(options: FirefoxPoolOptions) {
  const processRef = spawn(options.executable, [
    "--headless",
    "--no-remote",
    "--profile",
    options.profile,
    "--remote-debugging-port",
    "0",
    "about:blank",
  ], {
    detached: process.platform !== "win32",
    stdio: ["ignore", "ignore", "pipe"],
  });
  const releaseSignalOwnership = ownFirefoxSignals(processRef);
  let socket: WebSocket | null = null;
  try {
    const webSocketUrl = await discoverWebDriverUrl(processRef);
    socket = await connectWithRetry(`${webSocketUrl}/session`, processRef);
    const request = requestClient(socket);
    await request("session.new", { capabilities: { alwaysMatch: {} } });
    return poolController({ processRef, releaseSignalOwnership, request, socket });
  } catch (error) {
    socket?.close();
    await stopProcess(processRef);
    releaseSignalOwnership();
    throw error;
  }
}

function poolController({ processRef, releaseSignalOwnership, request, socket }: any) {
  let lifecycle = Promise.resolve();
  const serializeLifecycle = <T>(task: () => Promise<T>) => {
    const result = lifecycle.then(task, task);
    lifecycle = result.then(() => {}, () => {});
    return result;
  };
  return {
    createContext: (options: FirefoxContextOptions) => serializeLifecycle(async () => {
      const userContext = (await request("browser.createUserContext", {})).result.userContext;
      try {
        const context = (await request("browsingContext.create", { type: "tab", userContext })).result.context;
        await setViewport(request, context, options);
        return contextController(request, context, userContext, serializeLifecycle);
      } catch (error) {
        await request("browser.removeUserContext", { userContext }).catch(() => {});
        throw error;
      }
    }),
    close: async () => {
      try {
        await lifecycle;
        await request("session.end", {}).catch(() => {});
        socket.close();
        await stopProcess(processRef);
      } finally {
        releaseSignalOwnership();
      }
    },
  };
}

function contextController(
  request: any,
  context: string,
  userContext: string,
  serializeLifecycle: <T>(task: () => Promise<T>) => Promise<T>,
) {
  let closed = false;
  return {
    navigate: (url: string) => request("browsingContext.navigate", { context, url, wait: "complete" }),
    evaluate: (expression: string) => evaluateInContext(request, context, expression),
    evaluateChild: async (expression: string) => {
      const tree = await request("browsingContext.getTree", {});
      const root = tree.result.contexts.find((candidate: any) => candidate.context === context);
      const child = root?.children?.[0]?.context;
      if (!child) throw new Error("Firefox BiDi did not expose the artifact context");
      return evaluateInContext(request, child, expression);
    },
    close: () => serializeLifecycle(async () => {
      if (closed) return;
      closed = true;
      await request("browser.removeUserContext", { userContext });
    }),
  };
}

function setViewport(request: any, context: string, options: FirefoxContextOptions) {
  return request("browsingContext.setViewport", {
    context,
    viewport: { width: options.width, height: options.height },
    devicePixelRatio: 1,
  });
}

async function evaluateInContext(request: any, context: string, expression: string) {
  const response = await request("script.evaluate", {
    expression,
    target: { context },
    awaitPromise: true,
  });
  return JSON.parse(response.result.result.value);
}

function requestClient(socket: WebSocket) {
  let requestId = 0;
  const pending = new Map<number, PendingRequest>();
  socket.addEventListener("message", (event) => settleRequest(pending, event));
  return (method: string, params: Record<string, unknown>) => new Promise<any>((resolve, reject) => {
    const id = ++requestId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Firefox BiDi request timed out: ${method}`));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { reject, resolve, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

interface PendingRequest {
  reject(error: Error): void;
  resolve(value: any): void;
  timer: ReturnType<typeof setTimeout>;
}

function settleRequest(pending: Map<number, PendingRequest>, event: MessageEvent) {
  const message = JSON.parse(String(event.data));
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timer);
  if (message.type === "error") request.reject(new Error(message.message ?? message.error));
  else request.resolve(message);
}

async function connectWithRetry(url: string, processRef: ReturnType<typeof spawn>) {
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (processRef.exitCode !== null) throw new Error("Firefox exited before BiDi became available");
    try {
      return await openWebSocket(url);
    } catch {
      await Bun.sleep(CONNECT_RETRY_MS);
    }
  }
  throw new Error("Firefox BiDi did not become available");
}

function openWebSocket(url: string) {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url);
    let timer: ReturnType<typeof setTimeout>;
    function fail(error: Error) {
      clearTimeout(timer);
      socket.close();
      reject(error);
    }
    timer = setTimeout(() => fail(new Error("Firefox BiDi connection timed out")), 500);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(socket);
    }, { once: true });
    socket.addEventListener("error", () => fail(new Error("Firefox BiDi connection failed")), { once: true });
  });
}

function discoverWebDriverUrl(processRef: ReturnType<typeof spawn>) {
  return new Promise<string>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => finish(new Error("Firefox did not report its BiDi endpoint")), REQUEST_TIMEOUT_MS);
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const match = output.match(/WebDriver BiDi listening on (ws:\/\/[^\s]+)/);
      if (match) finish(null, match[1]);
    };
    const onClose = () => finish(new Error("Firefox exited before reporting its BiDi endpoint"));
    const onError = (error: Error) => finish(error);
    function finish(error: Error | null, url?: string) {
      clearTimeout(timer);
      processRef.stderr?.off("data", onData);
      processRef.stderr?.resume();
      processRef.off("close", onClose);
      processRef.off("error", onError);
      if (error) reject(error);
      else resolve(url!);
    }
    processRef.stderr?.on("data", onData);
    processRef.once("close", onClose);
    processRef.once("error", onError);
  });
}

async function stopProcess(processRef: ReturnType<typeof spawn>) {
  const processGroupId = processRef.pid;
  if (!processHasExited(processRef)) {
    signalProcessTree(processRef, "SIGTERM");
    if (!await waitForProcessClose(processRef, 2_000)) {
      signalProcessTree(processRef, "SIGKILL");
      if (!await waitForProcessClose(processRef, 2_000)) {
        throw new Error("Firefox process did not stop");
      }
    }
  }
  if (processGroupId !== undefined) await stopFirefoxProcessGroup(processGroupId);
}

function signalProcessTree(processRef: ReturnType<typeof spawn>, signal: NodeJS.Signals) {
  try {
    if (process.platform === "win32" || processRef.pid === undefined) processRef.kill(signal);
    else process.kill(-processRef.pid, signal);
  } catch {
    processRef.kill(signal);
  }
}

function waitForProcessClose(processRef: ReturnType<typeof spawn>, timeout: number) {
  if (processHasExited(processRef)) return Promise.resolve(true);
  return Promise.race([
    new Promise<true>((resolve) => processRef.once("close", () => resolve(true))),
    Bun.sleep(timeout).then(() => false),
  ]);
}

function processHasExited(processRef: ReturnType<typeof spawn>) {
  return processRef.exitCode !== null || processRef.signalCode !== null;
}

async function stopFirefoxProcessGroup(processGroupId: number) {
  if (process.platform === "win32" || !processGroupExists(processGroupId)) return;
  try {
    process.kill(-processGroupId, "SIGKILL");
  } catch (error: any) {
    if (!new Set(["EPERM", "ESRCH"]).has(error.code)) throw error;
  }
  const deadline = Date.now() + 2_000;
  while (processGroupExists(processGroupId) && Date.now() < deadline) await Bun.sleep(20);
  if (processGroupExists(processGroupId)) throw new Error("Firefox process group did not stop");
}

function processGroupExists(processGroupId: number) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error: any) {
    return !new Set(["EPERM", "ESRCH"]).has(error.code);
  }
}

function ownFirefoxSignals(processRef: ReturnType<typeof spawn>) {
  const handlers = new Map<NodeJS.Signals, () => void>();
  let stopping = false;
  const release = () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
    handlers.clear();
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const handler = () => {
      if (stopping) return;
      stopping = true;
      void stopProcess(processRef).catch(() => {}).finally(() => {
        release();
        process.kill(process.pid, signal);
      });
    };
    handlers.set(signal, handler);
    process.once(signal, handler);
  }
  return release;
}
