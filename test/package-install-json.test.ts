import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const modules = resolve(import.meta.dir, "../tools/install");
function transform(input: string, filter = "decode_document | encode_document") {
  return spawnSync("jq", ["-L", modules, "-Rsr", `include "settings"; ${filter}`], {
    input, encoding: "utf8", timeout: 10_000,
  });
}

test("installer JSON processing preserves unknown numeric tokens and literal marker-like objects", () => {
  const input = '{"numbers":[-0,0.12345678901234567890123456789,1e-99999999999999999999999999999999999999999999999999999,184467440737095516170123456789],"object":{"$ai_number":"literal","nested":[true,null,"string"]}}';
  const result = transform(input);
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
  expect(result.stdout.trim()).toBe(input);
});

test("installer JSON rejects duplicate decoded keys and malformed documents", () => {
  for (const input of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"x":{"a":1,"a":2}}',
    '{"a":NaN}', '{"a":Infinity}', '{"a":01}', '{}{}', '{"a":1,}', '{"a":1/*comment*/}']) {
    expect(transform(input).status, input).not.toBe(0);
  }
  expect(transform('{"\\u0024ai_number":"literal","value":-0}').stdout.trim())
    .toBe('{"$ai_number":"literal","value":-0}');
});

const mergeFilter = `fromjson | . as $input
  | ($input.current | decode_document) as $current
  | ($input.previous | decode_document | claims) as $previous
  | ($input.desired | decode_document | claims) as $desired
  | merge_settings($current; $previous; $desired) | encode_document`;
function mergeRaw(current: string, previous: string, desired: string) {
  return transform(JSON.stringify({ current, previous, desired }), mergeFilter);
}
function merge(current: string, previous: object[], desired: object[]) {
  return mergeRaw(current, JSON.stringify(previous), JSON.stringify(desired));
}
const entry = (value: unknown) => ({ path: ["permissions", "allow"], mode: "array_entry", value });

test("installer settings replace only owned entries and preserve personal fields and numeric tokens", () => {
  const current = '{"model":"personal","unknown":-0,"permissions":{"allow":["personal","old"]}}';
  const result = merge(current, [entry("old")], [entry("new")]);
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
  expect(result.stdout.trim()).toBe('{"model":"personal","unknown":-0,"permissions":{"allow":["personal","new"]}}');
});

test("installer settings refuse adoption, modified or duplicated claims, and changed ownership modes", () => {
  const scalar = (value: string) => ({ path: ["theme"], mode: "value", value });
  for (const [current, previous, desired] of [
    ['{"theme":"new"}', [], [scalar("new")]],
    ['{"theme":"personal"}', [scalar("old")], [scalar("new")]],
    ['{"permissions":{"allow":["new"]}}', [], [entry("new")]],
    ['{"permissions":{"allow":["old","old"]}}', [entry("old")], []],
    ['{"permissions":{"allow":[]}}', [entry("old")], []],
    ['{}', [], [entry("duplicate"), entry("duplicate")]],
    ['{}', [{ path: ["theme"], mode: "array_entry", value: "old" }], [scalar("new")]],
    ['{"permissions":null}', [], [entry("new")]],
  ] as [string, object[], object[]][]) {
    const result = merge(current, previous, desired);
    expect(result.status, current).not.toBe(0);
    expect(result.stdout).toBe("");
  }
});

test("installer settings retain personal order and raw numbers across switch, repeat and removal", () => {
  const unknown = '{"numbers":[-0,0.12345678901234567890123456789,1e-99999999999999999999999999999999999999999999999999999,184467440737095516170123456789],"object":{"$serde_json::private::Number":"literal","nested":[true,null,"string"]}}';
  let current = `{"unknown":${unknown},"permissions":{"allow":["personal","A","personal","B","last"]}}`;
  let previous = [entry("A"), entry("B")];
  for (const desired of [[entry("B"), entry("C")], [entry("B"), entry("C")], []]) {
    const result = merge(current, previous, desired);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`"unknown":${unknown}`);
    expect(JSON.parse(result.stdout).permissions.allow)
      .toEqual(desired.length ? ["personal", "personal", "B", "last", "C"] : ["personal", "personal", "last"]);
    previous = desired;
    current = result.stdout;
  }
  const claim = '[{"path":["hooks","PreToolUse"],"mode":"array_entry","value":{"timeout":51.248178375505404}}]';
  const installed = mergeRaw("{}", "[]", claim);
  expect(installed.status).toBe(0);
  const repeated = mergeRaw(installed.stdout, claim, claim);
  expect(repeated.status).toBe(0);
  expect(repeated.stdout).toBe(installed.stdout);
  const removed = mergeRaw(repeated.stdout, claim, "[]");
  expect(removed.status).toBe(0);
  expect(removed.stdout.trim()).toBe('{"hooks":{"PreToolUse":[]}}');
});

test("installer numeric ownership compares equivalent spellings without rounding distinct integers", () => {
  const claim = (number: string) => `[{"path":["hooks","PreToolUse"],"mode":"array_entry","value":{"timeout":${number}}}]`;
  for (const spelling of ["1e0", "1.00", "100e-2", "0.001e3"]) {
    const current = `{"hooks":{"PreToolUse":[{"timeout":${spelling}}]}}`;
    expect(mergeRaw(current, "[]", claim("1")).status, spelling).not.toBe(0);
    expect(mergeRaw(current, claim("1"), "[]").stdout.trim()).toBe('{"hooks":{"PreToolUse":[]}}');
    const duplicate = claim("1").slice(0, -1) + "," + claim(spelling).slice(1);
    expect(mergeRaw("{}", "[]", duplicate).status, spelling).not.toBe(0);
  }
  const current = '{"hooks":{"PreToolUse":[{"timeout":9007199254740992}]}}';
  const added = mergeRaw(current, "[]", claim("9007199254740993"));
  expect(added.status).toBe(0);
  expect(added.stdout).toContain("9007199254740993");
  expect(mergeRaw(added.stdout, claim("9007199254740993"), "[]").stdout.trim()).toBe(current);
});
