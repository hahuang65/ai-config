#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const [platform, home, serviceManager, domain = ""] = process.argv.slice(2);
const FAILURE = "Review publication cannot verify that 127.0.0.1:4392 belongs to the managed Review publication service. Stop the unrelated listener or repair the managed user service, then try again.";
const QUERY_TIMEOUT_MS = 5_000;
const MAX_QUERY_OUTPUT_BYTES = 128 * 1024;

try {
  if (!["Darwin", "Linux"].includes(platform) || !path.isAbsolute(home) || !path.isAbsolute(serviceManager)) {
    throw new Error(FAILURE);
  }
  if (platform === "Darwin") await verifyLaunchdListener();
  else await verifySystemdListener();
} catch {
  process.stderr.write(`${FAILURE}\n`);
  process.exitCode = 1;
}

async function verifyLaunchdListener() {
  const definition = path.join(home, "Library", "LaunchAgents", "dev.review-publication.plist");
  const content = await readFile(definition, "utf8");
  const expectedFields = [
    /<key>Label<\/key>\s*<string>dev\.review-publication<\/string>/,
    /<key>SockNodeName<\/key>\s*<string>127\.0\.0\.1<\/string>/,
    /<key>SockServiceName<\/key>\s*<string>4392<\/string>/,
  ];
  const singletonKeys = ["Label", "Sockets", "Listener", "SockNodeName", "SockServiceName"];
  if (!content.includes("Managed by ai-config: review-publication")
    || expectedFields.some((expression) => !expression.test(content))
    || singletonKeys.some((key) => content.match(new RegExp(`<key>${key}</key>`, "g"))?.length !== 1)) {
    throw new Error(FAILURE);
  }
  const target = `${domain}/dev.review-publication`;
  const output = serviceQuery(["print", target]);
  if (!output.includes(`${target} = {`)
    || !output.includes(`path = ${definition}`)
    || !/state = (?:waiting|running)/.test(output)
    || !/["']?Listener["']?\s*=\s*\{[^}]*service name = 4392/s.test(output)) {
    throw new Error(FAILURE);
  }
}

async function verifySystemdListener() {
  const definition = path.join(home, ".config", "systemd", "user", "review-publication.socket");
  const content = await readFile(definition, "utf8");
  const directives = content.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  if (!content.includes("Managed by ai-config: review-publication")
    || directives.filter((line) => line === "ListenStream=127.0.0.1:4392").length !== 1
    || directives.filter((line) => line.startsWith("ListenStream=")).length !== 1
    || directives.filter((line) => line === "Accept=yes").length !== 1
    || directives.some((line) => /^Listen(?:Datagram|FIFO|Netlink|SequentialPacket)=/.test(line))) {
    throw new Error(FAILURE);
  }
  const fields = Object.fromEntries(serviceQuery([
    "--user", "show", "review-publication.socket",
    "--property=Id,LoadState,ActiveState,SubState,FragmentPath,Listen",
  ]).split("\n").map((line) => line.split("=", 2)).filter((entry) => entry.length === 2));
  if (fields.Id !== "review-publication.socket"
    || fields.LoadState !== "loaded"
    || fields.ActiveState !== "active"
    || fields.SubState !== "listening"
    || fields.FragmentPath !== definition
    || !/^127\.0\.0\.1:4392\s+\(Stream\)$/.test(fields.Listen ?? "")) {
    throw new Error(FAILURE);
  }
}

function serviceQuery(args) {
  const query = spawnSync(serviceManager, args, {
    encoding: "utf8",
    maxBuffer: MAX_QUERY_OUTPUT_BYTES,
    timeout: QUERY_TIMEOUT_MS,
  });
  if (query.error || query.status !== 0 || query.signal || typeof query.stdout !== "string") throw new Error(FAILURE);
  return query.stdout;
}
