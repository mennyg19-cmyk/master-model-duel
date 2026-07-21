import assert from "node:assert/strict";
import { test } from "node:test";
import { distanceMiles, googleMapsUrl, nearestNeighborOrder, sameStreet } from "../lib/routes/geo";

const LAKEWOOD = { latitude: 40.0821, longitude: -74.2097 };

test("distanceMiles: identical points are 0, a known pair is ~right", () => {
  assert.equal(distanceMiles(LAKEWOOD, LAKEWOOD), 0);
  // Lakewood -> Toms River is roughly 7-8 miles as the crow flies.
  const tomsRiver = { latitude: 39.9779, longitude: -74.1832 };
  const d = distanceMiles(LAKEWOOD, tomsRiver);
  assert.ok(d > 6 && d < 9, `expected ~7-8 miles, got ${d}`);
});

test("nearestNeighborOrder: visits closest-first and parks unplaceable stops last", () => {
  const near = { coordinates: { latitude: 40.083, longitude: -74.21 }, name: "near" };
  const far = { coordinates: { latitude: 40.2, longitude: -74.4 }, name: "far" };
  const mid = { coordinates: { latitude: 40.12, longitude: -74.3 }, name: "mid" };
  const lost = { coordinates: null, name: "lost" };
  const ordered = nearestNeighborOrder(LAKEWOOD, [far, lost, near, mid]);
  assert.deepEqual(ordered.map((stop) => stop.name), ["near", "mid", "far", "lost"]);
});

test("sameStreet: house number stripped, city must match", () => {
  assert.ok(sameStreet("12 Forest Ave", "Lakewood", "48 Forest Ave.", "lakewood"));
  assert.ok(!sameStreet("12 Forest Ave", "Lakewood", "12 Forest Ave", "Jackson"));
  assert.ok(!sameStreet("12 Forest Ave", "Lakewood", "12 Ridge Ave", "Lakewood"));
});

test("googleMapsUrl encodes the full stop address", () => {
  const url = googleMapsUrl({ line1: "12 Forest Ave", city: "Lakewood", state: "NJ", zip: "08701" });
  assert.ok(url.startsWith("https://www.google.com/maps/dir/?api=1&destination="));
  assert.ok(url.includes(encodeURIComponent("12 Forest Ave, Lakewood, NJ 08701")));
});
