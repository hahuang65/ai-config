#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const artifactName = "review-publication-worker.bundle.mjs";
const artifact = path.resolve(process.argv[2] ?? path.join(
  repositoryRoot,
  "review-publication",
  artifactName,
));
const digestFile = path.resolve(process.argv[3] ?? `${artifact}.sha256`);
const buildDirectory = await mkdtemp(path.join(tmpdir(), "review-publication-worker-build-"));

try {
  const build = await Bun.build({
    entrypoints: [path.join(repositoryRoot, "skills", "review-change", "bin", "review-publication.mjs")],
    outdir: buildDirectory,
    target: "node",
    format: "esm",
    naming: "worker.mjs",
    sourcemap: "none",
  });
  if (!build.success) {
    throw new AggregateError(build.logs, "Review publication worker bundle failed");
  }
  const bundledSource = await readFile(path.join(buildDirectory, "worker.mjs"), "utf8");
  const content = bundledSource.replace(
    "#!/usr/bin/env node\n",
    "#!/usr/bin/env node\n// Managed by ai-config: review-publication\n",
  );
  const digest = createHash("sha256").update(content).digest("hex");
  await Promise.all([
    writeFile(artifact, content, { mode: 0o644 }),
    writeFile(digestFile, `${digest}  ${artifactName}\n`, { mode: 0o644 }),
  ]);
} finally {
  await rm(buildDirectory, { force: true, recursive: true });
}
