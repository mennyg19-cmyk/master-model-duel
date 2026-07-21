import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../lib/csv";

test("parses headers, quoted fields, escaped quotes, and CRLF", () => {
  const result = parseCsv('Name,Email,Note\r\n"Cohen, Chaim",c@x.com,"He said ""hi"""\nRivka,r@x.com,\n');
  assert.ok(!("error" in result));
  assert.deepEqual(result.headers, ["name", "email", "note"]);
  assert.deepEqual(result.rows, [
    ['Cohen, Chaim', "c@x.com", 'He said "hi"'],
    ["Rivka", "r@x.com", ""],
  ]);
});

test("skips blank lines and lowercases headers", () => {
  const result = parseCsv("NAME,EMAIL\n\nA,a@x.com\n\n");
  assert.ok(!("error" in result));
  assert.equal(result.rows.length, 1);
});

test("reports unclosed quotes instead of hanging", () => {
  const result = parseCsv('name\n"broken');
  assert.ok("error" in result);
});

test("rejects empty input", () => {
  assert.ok("error" in parseCsv(""));
});
