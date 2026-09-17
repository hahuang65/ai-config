#!/usr/bin/env node

import net from "node:net";

const HOST = "127.0.0.1";
const PORT = 4392;
const server = net.createServer();
server.unref();
server.once("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    process.exitCode = 10;
    return;
  }
  if (error?.code === "EACCES") {
    process.stderr.write("Review publication cannot verify access to 127.0.0.1:4392. Repair local socket permissions, then try again.\n");
    process.exitCode = 1;
    return;
  }
  throw error;
});
server.listen(PORT, HOST, () => server.close());
