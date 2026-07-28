// DB integration: two concurrent reservations for the last unit of stock —
// exactly one commits (reserve engine, R-158).
// Requires embedded Postgres on 4106 (db:start).
import { PrismaClient } from "@prisma/client";
import { InsufficientStockError, releaseStock, reserveStock } from "../lib/inventory/reserve";

const prisma = new PrismaClient();
let failures = 0;

function check(label: string, condition: boolean) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`ok: ${label}`);
  }
}

const season = await prisma.season.create({ data: { name: `TEST-INV-${Date.now()}`, status: "CLOSED" } });
const product = await prisma.product.create({
  data: {
    slug: `race-product-${Date.now()}`,
    name: "Race Product",
    basePriceCents: 1000,
    trackInventory: true,
    seasonId: season.id,
  },
});
const item = await prisma.inventoryItem.create({
  data: { productId: product.id, onHand: 1, reserved: 0 },
});

// Race: two reservations for the last unit
const results = await Promise.allSettled([reserveStock(item.id, 1), reserveStock(item.id, 1)]);
const wins = results.filter((r) => r.status === "fulfilled").length;
const stockouts = results.filter(
  (r) => r.status === "rejected" && r.reason instanceof InsufficientStockError,
).length;
check("exactly one reservation commits", wins === 1);
check("the loser gets InsufficientStockError", stockouts === 1);

const after = await prisma.inventoryItem.findUnique({ where: { id: item.id } });
check("reserved is exactly 1", after?.reserved === 1);
check("version bumped once", after?.version === 2);

// Release frees the unit for a fresh reservation
await releaseStock(item.id, 1);
await reserveStock(item.id, 1);
const final = await prisma.inventoryItem.findUnique({ where: { id: item.id } });
check("release + re-reserve round-trips", final?.reserved === 1);

// Cleanup
await prisma.inventoryItem.delete({ where: { id: item.id } });
await prisma.product.delete({ where: { id: product.id } });
await prisma.season.delete({ where: { id: season.id } });
await prisma.$disconnect();

if (failures > 0) {
  console.error(`${failures} inventory-race check(s) failed`);
  process.exit(1);
}
console.log("All inventory-race checks passed");
