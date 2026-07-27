import { test } from "node:test";
import assert from "node:assert/strict";
import { csvField, csvLine, parseCsv } from "../lib/csv";

test("csvField quotes commas, quotes, and newlines", () => {
  assert.equal(csvField("plain"), "plain");
  assert.equal(csvField("a,b"), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField("line1\nline2"), '"line1\nline2"');
  assert.equal(csvField(null), "");
  assert.equal(csvField(1234), "1234");
});

test("csvField defangs leading formula characters (spreadsheet injection)", () => {
  assert.equal(csvField("=SUM(A1:A9)"), '"\t=SUM(A1:A9)"');
  assert.equal(csvField("@cmd"), '"\t@cmd"');
  assert.equal(csvField("+15551234567"), '"\t+15551234567"');
  // Negative NUMBERS are data, not formulas — they pass through untouched.
  assert.equal(csvField(-42), "-42");
});

test("exported CSV round-trips through our own parser", () => {
  const header = csvLine(["name", "note", "amount"]);
  const row = csvLine(['Blum, "Sara"', "multi\nline note", 3600]);
  const parsed = parseCsv(header + row);
  assert.ok(!("error" in parsed));
  if ("error" in parsed) return;
  assert.deepEqual(parsed.headers, ["name", "note", "amount"]);
  assert.deepEqual(parsed.rows[0], ['Blum, "Sara"', "multi\nline note", "3600"]);
});
