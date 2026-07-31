const MINIMUM_NODE_MAJOR = 22;

export function assertSupportedNode(version) {
  const major = Number.parseInt(version.split(".")[0], 10);
  if (!Number.isInteger(major) || major < MINIMUM_NODE_MAJOR) {
    throw Object.assign(new Error("Node.js 22 or newer is required"), { code: "UNSUPPORTED_RUNTIME" });
  }
}
