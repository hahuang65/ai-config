export async function verifyInlineLocations(findings, files, loadCompleteDiff) {
  const patchLocations = collectPatchLocations(files);
  const unverified = findInvalidLocation(findings, patchLocations);
  if (!unverified) return;
  let completeLocations;
  try {
    completeLocations = parseCompleteDiff(await loadCompleteDiff());
  } catch {
    throw inlineLocationUnverifiable(unverified);
  }
  const invalid = findInvalidLocation(findings, completeLocations);
  if (invalid) throw invalidInlineLocation(invalid);
}

function parseCompleteDiff(diff) {
  if (typeof diff !== "string" || !diff.startsWith("diff --git ")) throw invalidDiff();
  const locations = new Set();
  const sections = diff.split(/^diff --git /m).slice(1);
  for (const section of sections) {
    const lines = section.split("\n");
    const paths = sectionPaths(lines);
    if (lines.some((line) => line.startsWith("@@") && !isHunkHeader(line))) throw invalidDiff();
    addPatchLocations(locations, paths, lines);
  }
  return locations;
}

function sectionPaths(lines) {
  const headerPaths = parseDiffGitHeader(lines[0] ?? "");
  const metadata = lines.slice(1, lines.findIndex((line) => line.startsWith("@@")) < 0
    ? lines.length
    : lines.findIndex((line) => line.startsWith("@@")));
  const oldHeaders = metadata.filter((line) => line.startsWith("--- "));
  const newHeaders = metadata.filter((line) => line.startsWith("+++ "));
  if (oldHeaders.length === 0 && newHeaders.length === 0) return headerPaths;
  if (oldHeaders.length !== 1 || newHeaders.length !== 1) throw invalidDiff();
  const oldPath = parsePatchHeaderPath(oldHeaders[0], "a/");
  const newPath = parsePatchHeaderPath(newHeaders[0], "b/");
  if (oldPath !== null && oldPath !== headerPaths.oldPath
    || newPath !== null && newPath !== headerPaths.newPath) throw invalidDiff();
  return headerPaths;
}

function parseDiffGitHeader(source) {
  const oldToken = parseGitPathToken(source, 0);
  if (source[oldToken.next] !== " ") throw invalidDiff();
  let next = oldToken.next;
  while (source[next] === " ") next += 1;
  const newToken = parseGitPathToken(source, next);
  if (newToken.next !== source.length) throw invalidDiff();
  return {
    oldPath: normalizeCoordinatePath(oldToken.value, "a/"),
    newPath: normalizeCoordinatePath(newToken.value, "b/"),
  };
}

function parsePatchHeaderPath(line, prefix) {
  const source = line.slice(4);
  if (source === "/dev/null") return null;
  const token = parseGitPathToken(source, 0);
  if (token.next !== source.length) throw invalidDiff();
  return normalizeCoordinatePath(token.value, prefix);
}

function parseGitPathToken(source, start) {
  if (start >= source.length) throw invalidDiff();
  if (source[start] === '"') return parseQuotedGitPath(source, start);
  let next = start;
  while (next < source.length && source[next] !== " ") next += 1;
  const value = source.slice(start, next);
  if (!value || /["\\\u0000-\u001f\u007f]/u.test(value)) throw invalidDiff();
  return { value, next };
}

function parseQuotedGitPath(source, start) {
  const bytes = [];
  let index = start + 1;
  while (index < source.length && source[index] !== '"') {
    if (source[index] === "\\") index = appendEscapedByte(bytes, source, index + 1);
    else index = appendUtf8Character(bytes, source, index);
  }
  if (source[index] !== '"') throw invalidDiff();
  let value;
  try {
    value = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    throw invalidDiff();
  }
  if (value.includes("\0")) throw invalidDiff();
  return { value, next: index + 1 };
}

function appendEscapedByte(bytes, source, index) {
  const escapes = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
  const escaped = source[index];
  if (escaped in escapes) {
    bytes.push(escapes[escaped]);
    return index + 1;
  }
  if (!/[0-7]/.test(escaped ?? "")) throw invalidDiff();
  const octal = /^[0-7]{1,3}/.exec(source.slice(index))?.[0] ?? "";
  const byte = Number.parseInt(octal, 8);
  if (byte > 0xff) throw invalidDiff();
  bytes.push(byte);
  return index + octal.length;
}

function appendUtf8Character(bytes, source, index) {
  const codePoint = source.codePointAt(index);
  if (codePoint === undefined || codePoint < 0x20 || codePoint === 0x7f) throw invalidDiff();
  const character = String.fromCodePoint(codePoint);
  bytes.push(...Buffer.from(character, "utf8"));
  return index + character.length;
}

function normalizeCoordinatePath(value, prefix) {
  if (!value.startsWith(prefix) || value.length === prefix.length) throw invalidDiff();
  return value.slice(prefix.length);
}

function invalidDiff() {
  return new Error("Invalid complete diff");
}

function collectPatchLocations(files) {
  const locations = new Set();
  for (const file of files) {
    addPatchLocations(locations, { oldPath: file.filename, newPath: file.filename }, file.patch?.split("\n") ?? []);
  }
  return locations;
}

function addPatchLocations(locations, paths, lines) {
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const line of lines) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
    } else if (inHunk && line.startsWith("+")) {
      locations.add(locationKey(paths.newPath, "RIGHT", newLine)); newLine += 1;
    } else if (inHunk && line.startsWith("-")) {
      locations.add(locationKey(paths.oldPath, "LEFT", oldLine)); oldLine += 1;
    } else if (inHunk && line.startsWith(" ")) {
      locations.add(locationKey(paths.oldPath, "LEFT", oldLine));
      locations.add(locationKey(paths.newPath, "RIGHT", newLine));
      oldLine += 1; newLine += 1;
    }
  }
}

function isHunkHeader(line) {
  return /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.test(line);
}

function findInvalidLocation(findings, locations) {
  return findings.find((finding) => !locations.has(locationKey(finding.path, finding.side, finding.line)));
}

function invalidInlineLocation(finding) {
  return Object.assign(new Error("The selected Finding location is not in the exact pull-request changes"), {
    code: "invalid_inline_location",
    status: 409,
    details: findingDetails(finding),
  });
}

function inlineLocationUnverifiable(finding) {
  return Object.assign(new Error("GitHub did not provide complete evidence for the selected Finding location"), {
    code: "inline_location_unverifiable",
    status: 502,
    ambiguous: false,
    details: findingDetails(finding),
  });
}

function findingDetails(finding) {
  return {
    findingId: finding.id,
    title: finding.title,
    path: finding.path,
    line: finding.line,
    side: finding.side,
  };
}

function locationKey(filePath, side, line) { return `${filePath}\u0000${side}\u0000${line}`; }
