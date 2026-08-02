import { spawn } from "node:child_process";
import { createServer } from "node:net";

interface FirefoxBidiOptions {
  executable: string;
  profile: string;
  width: number;
  height: number;
}

export async function startFirefoxBidi(options: FirefoxBidiOptions) {
  const port = await reservePort();
  const processRef = spawn(options.executable, [
    "--headless",
    "--no-remote",
    "--profile",
    options.profile,
    "--remote-debugging-port",
    String(port),
    "about:blank",
  ], {
    env: {
      ...process.env,
      MOZ_HEADLESS_WIDTH: String(options.width),
      MOZ_HEADLESS_HEIGHT: String(options.height),
    },
    stdio: "ignore",
  });
  let socket: WebSocket | null = null;
  try {
    socket = await connectWithRetry(`ws://127.0.0.1:${port}/session`, processRef);
    const request = requestClient(socket);
    await request("session.new", { capabilities: { alwaysMatch: {} } });
    const tree = await request("browsingContext.getTree", {});
    const context = tree.result.contexts[0]?.context;
    if (!context) throw new Error("Firefox BiDi did not expose a browsing context");
    await request("browsingContext.setViewport", {
      context,
      viewport: { width: options.width, height: options.height },
      devicePixelRatio: 1,
    });
    return bidiController({ context, processRef, request, socket });
  } catch (error) {
    socket?.close();
    await stopProcess(processRef);
    throw error;
  }
}

function bidiController({ context, processRef, request, socket }: any) {
  return {
    navigate: (url: string) => request("browsingContext.navigate", { context, url, wait: "complete" }),
    evaluate: async (expression: string) => {
      const response = await request("script.evaluate", {
        expression,
        target: { context },
        awaitPromise: true,
      });
      return JSON.parse(response.result.result.value);
    },
    close: async () => {
      await request("session.end", {}).catch(() => {});
      socket.close();
      await stopProcess(processRef);
    },
  };
}

function requestClient(socket: WebSocket) {
  let requestId = 0;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.type === "error") request?.reject(new Error(message.message ?? message.error));
    else request?.resolve(message);
  });
  return (method: string, params: Record<string, unknown>) => new Promise<any>((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function connectWithRetry(url: string, processRef: ReturnType<typeof spawn>) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (processRef.exitCode !== null) throw new Error("Firefox exited before BiDi became available");
    try {
      return await openWebSocket(url);
    } catch {
      await Bun.sleep(50);
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

function reservePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function stopProcess(processRef: ReturnType<typeof spawn>) {
  if (processRef.exitCode !== null) return;
  processRef.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => processRef.once("close", () => resolve())),
    Bun.sleep(2_000),
  ]);
  if (processRef.exitCode === null) processRef.kill("SIGKILL");
}
