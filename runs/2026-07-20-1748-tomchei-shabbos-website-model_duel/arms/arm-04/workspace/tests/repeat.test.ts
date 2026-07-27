import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveReplacementChain,
  wouldCreateReplacementCycle,
  closestPricedProduct,
  type ChainProduct,
} from "../lib/repeat";

const product = (
  id: string,
  seasonId: string,
  replacementId: string | null = null,
  isActive = true
): ChainProduct => ({ id, seasonId, isActive, replacementId });

const asMap = (products: ChainProduct[]) => new Map(products.map((entry) => [entry.id, entry]));

test("chain resolves across seasons to the first active product in the target season", () => {
  const products = asMap([
    product("a24", "s2024", "a25"),
    product("a25", "s2025", "a26"),
    product("a26", "s2026"),
  ]);
  const resolved = resolveReplacementChain("a24", products, "s2026");
  assert.equal(resolved.productId, "a26");
  assert.deepEqual(resolved.chain, ["a25", "a26"]);
});

test("chain skips an inactive product in the target season and keeps walking", () => {
  const products = asMap([
    product("old", "s2025", "retired"),
    product("retired", "s2026", "fresh", false),
    product("fresh", "s2026"),
  ]);
  assert.equal(resolveReplacementChain("old", products, "s2026").productId, "fresh");
});

test("chain returns null on a dead end or a cycle", () => {
  const deadEnd = asMap([product("a", "s2025", "b"), product("b", "s2025")]);
  assert.equal(resolveReplacementChain("a", deadEnd, "s2026").productId, null);

  const cycle = asMap([product("a", "s2025", "b"), product("b", "s2025", "a")]);
  assert.equal(resolveReplacementChain("a", cycle, "s2026").productId, null);
});

test("cycle guard flags a link that loops back, allows one that does not", () => {
  const products = asMap([product("a", "s1", "b"), product("b", "s1", "c"), product("c", "s1")]);
  assert.equal(wouldCreateReplacementCycle("a", "c", products), false);
  // c -> a would close a -> b -> c -> a.
  assert.equal(wouldCreateReplacementCycle("c", "a", products), true);
  assert.equal(wouldCreateReplacementCycle("a", "a", products), true);
});

test("price-smart default picks the closest price; ties go to the cheaper item", () => {
  const candidates = [
    { id: "cheap", name: "Cheap", basePriceCents: 2000 },
    { id: "mid", name: "Mid", basePriceCents: 3600 },
    { id: "high", name: "High", basePriceCents: 7200 },
  ];
  assert.equal(closestPricedProduct(3500, candidates)?.id, "mid");
  // 2800 is 800 away from both 2000 and 3600 — cheaper wins.
  assert.equal(closestPricedProduct(2800, candidates)?.id, "cheap");
  assert.equal(closestPricedProduct(100, [])?.id, undefined);
});
