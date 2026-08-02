import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import { publicError } from "./http.mjs";

export async function canonicalHtmlFile(value) {
  if (typeof value !== "string" || !/\.html?$/i.test(value)) {
    throw publicError(422, "invalid_html_file", "An HTML file path is required");
  }
  let file;
  try {
    file = await realpath(path.resolve(value));
    const details = await stat(file);
    if (!details.isFile()) throw new Error("not a file");
  } catch {
    throw publicError(404, "file_not_found", "HTML file was not found");
  }
  return file;
}

export function decodeArtifactPath(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw publicError(400, "invalid_path", "Artifact asset path is invalid");
  }
}

export async function confinedArtifactAsset(artifactFile, requested) {
  const root = path.dirname(artifactFile);
  let asset;
  try {
    asset = await realpath(path.resolve(root, requested));
  } catch {
    throw publicError(404, "asset_not_found", "Artifact asset was not found");
  }
  const relative = path.relative(root, asset);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw publicError(403, "asset_outside_artifact", "Artifact asset is outside the allowed directory");
  }
  return asset;
}

export function contentType(file) {
  return {
    ".htm": "text/html; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  }[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}
