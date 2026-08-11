import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  MAX_BROWSER_SUITES,
  classifyBunTestFiles,
  isBrowserTestFile,
} from "../scripts/test-suite-classification.mjs";

const REPOSITORY_ROOT = path.join(import.meta.dir, "..");
const TEST_ROOTS = [path.join(REPOSITORY_ROOT, "shared"), path.join(REPOSITORY_ROOT, "test")];
const FIREFOX_MODULE_IMPORT = ["./firefox", "bidi"].join("-");

test("classifies browser tests by their browser suffix", () => {
  const browserTest = path.join(REPOSITORY_ROOT, "test/example/shell.browser.test.ts");
  const ordinaryTest = path.join(REPOSITORY_ROOT, "test/example/shell.test.ts");

  expect(classifyBunTestFiles([ordinaryTest, browserTest])).toEqual({
    browser: [browserTest],
    rest: [ordinaryTest],
  });
});

test("places every discovered Bun test in exactly one lane", async () => {
  const testFiles = (await Promise.all(TEST_ROOTS.map(collectTestFiles))).flat().sort();
  const classified = classifyBunTestFiles(testFiles);

  expect([...classified.browser, ...classified.rest].sort()).toEqual(testFiles);
  expect(classified.browser.every(isBrowserTestFile)).toBe(true);
  expect(classified.rest.some(isBrowserTestFile)).toBe(false);
});

test("bounds discovered browser suites to the pooled execution budget", async () => {
  const testFiles = await collectTestFiles(path.join(REPOSITORY_ROOT, "test"));
  const browserTests = classifyBunTestFiles(testFiles).browser;

  expect(browserTests.length).toBeLessThanOrEqual(MAX_BROWSER_SUITES);
});

test("requires Firefox-dependent tests to carry the browser suffix", async () => {
  const testFiles = await collectTestFiles(path.join(REPOSITORY_ROOT, "test"));
  const incorrectlyNamed: string[] = [];
  for (const testFile of testFiles) {
    const source = await readFile(testFile, "utf8");
    if (source.includes(FIREFOX_MODULE_IMPORT) && !isBrowserTestFile(testFile)) {
      incorrectlyNamed.push(path.relative(REPOSITORY_ROOT, testFile));
    }
  }

  expect(incorrectlyNamed).toEqual([]);
});

async function collectTestFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTestFiles(entryPath);
    return entry.name.endsWith(".test.ts") ? [entryPath] : [];
  }));
  return nestedFiles.flat();
}
