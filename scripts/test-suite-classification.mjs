import path from "node:path";

export const BROWSER_TEST_SUFFIX = ".browser.test.ts";
export const MAX_BROWSER_SUITES = 3;

export function isBrowserTestFile(testFile) {
  return path.basename(testFile).endsWith(BROWSER_TEST_SUFFIX);
}

export function classifyBunTestFiles(testFiles) {
  const browser = [];
  const rest = [];
  for (const testFile of testFiles) {
    (isBrowserTestFile(testFile) ? browser : rest).push(testFile);
  }
  return Object.freeze({
    browser: Object.freeze(browser),
    rest: Object.freeze(rest),
  });
}
