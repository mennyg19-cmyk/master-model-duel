import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../lib/db";
import { planLegacyImport } from "../lib/legacy-import";

// Planner-only tests over the messy fixture (DB is read for merge targets but
// nothing is written — the commit half is exercised by the P12 smoke).

const fixture = readFileSync(join(__dirname, "fixtures", "legacy-2025.csv"), "utf8");

after(() => db.$disconnect());

test("legacy plan normalizes, dedupes, repairs, and buckets the messy fixture", async () => {
  const plan = await planLegacyImport(fixture);
  assert.ok(!("error" in plan), "plan should parse");
  if ("error" in plan) return;

  assert.equal(plan.seasonName, "Legacy 2025");

  // 2 rows are unusable: missing product name, non-money price.
  assert.equal(plan.invalidRows.length, 2);

  // Customers: chaim (case-merged emails), sara (phone-merged with S. Blum),
  // devorah, yanky, rina = 5. Malky's row is invalid so she never becomes one.
  assert.equal(plan.customers.length, 5);
  assert.ok(plan.merges.some((merge) => merge.note.includes("7325550102")), "phone merge recorded");

  // Order numbers: blank (line 5) and duplicate 102 (line 6) get repairs.
  assert.equal(plan.repairs.length, 2);
  const numbers = plan.orders.map((order) => order.orderNumber).sort((a, b) => a - b);
  assert.deepEqual(numbers, [101, 102, 103, 106, 107, 108]);

  // State name normalized; short zip and house-number-less street are flagged.
  const flagged = plan.addresses.filter((address) => address.reviewReason);
  assert.equal(flagged.length, 2);
  assert.ok(plan.addresses.every((address) => /^[A-Z]{2}$/.test(address.state)));

  // Source totals reconcile: usable rows only.
  assert.equal(plan.sourceTotals.rows, 9);
  const expectedRevenue = 3400 + 2 * 5000 + 3400 + 1800 + 5000 + 7200 + 3400;
  assert.equal(plan.sourceTotals.revenueCents, expectedRevenue);
});
