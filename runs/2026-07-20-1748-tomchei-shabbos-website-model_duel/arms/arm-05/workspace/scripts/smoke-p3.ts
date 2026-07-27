import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { LOCAL_DATABASE_URL, runWithLocalDatabase } from "./local-db";
import { validateCatalogImage } from "../lib/media";

async function verifyStorefrontData() {
  const prisma = new PrismaClient({ datasources: { db: { url: LOCAL_DATABASE_URL } } });
  try {
    const [currentSeason, archivedSeason, products, deliveryZipCodes] = await Promise.all([
      prisma.season.findUnique({ where: { year: 2026 } }),
      prisma.season.findUnique({ where: { year: 2025 } }),
      prisma.product.findMany({ where: { season: { year: 2026 } }, include: { options: true, inventoryItems: true } }),
      prisma.appSetting.findUnique({ where: { key: "delivery.zipCodes" } }),
    ]);
    assert.equal(currentSeason?.status, "OPEN");
    assert.equal(archivedSeason?.status, "CLOSED");
    assert.ok(products.some((product) => product.options.length > 0));
    assert.ok(products.some((product) => product.inventoryItems.some((inventory) => inventory.quantityOnHand === 0)));
    assert.deepEqual(deliveryZipCodes?.value, ["11201", "11205", "11211"]);
  } finally {
    await prisma.$disconnect();
  }
}

async function verifyNewsletter() {
  process.env.DATABASE_URL = LOCAL_DATABASE_URL;
  process.env.NEWSLETTER_TOKEN_SECRET = "smoke-secret";
  const {
    confirmSubscription,
    createNewsletterPreferencesToken,
    createUnsubscribeToken,
    getNewsletterSubscription,
    readUnsubscribeToken,
    subscribe,
    unsubscribe,
    updateNewsletterPreferences,
  } = await import("../lib/newsletter");
  const { confirmationToken } = await subscribe("newsletter@example.test");
  assert.ok(confirmationToken);
  const subscriber = await confirmSubscription(confirmationToken);
  assert.ok(subscriber);
  const preferenceToken = createNewsletterPreferencesToken(subscriber.id);
  const unsubscribeToken = createUnsubscribeToken(subscriber.id);
  assert.ok(readUnsubscribeToken(unsubscribeToken));
  assert.equal(readUnsubscribeToken(`${unsubscribeToken}changed`), null);
  assert.equal(readUnsubscribeToken(createUnsubscribeToken(subscriber.id, Date.now() - 1)), null);
  assert.equal(await updateNewsletterPreferences(preferenceToken, { marketing: false, updates: true, reminders: false }), true);
  assert.deepEqual((await getNewsletterSubscription(preferenceToken))?.preferences, { marketing: false, updates: true, reminders: false });
  assert.equal(await unsubscribe(unsubscribeToken), true);
}

async function runSmoke() {
  await runWithLocalDatabase("prisma", ["migrate", "deploy"]);
  await runWithLocalDatabase("prisma", ["generate"]);
  await runWithLocalDatabase("tsx", ["prisma/seed.ts"]);
  await runWithLocalDatabase("tsx", ["scripts/smoke-p3.ts", "verify"]);
}

async function verifySmoke() {
  await verifyStorefrontData();
  await verifyNewsletter();
  assert.equal(await validateCatalogImage(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "catalog.png", { type: "image/png" })), "png");
  assert.equal(await validateCatalogImage(new File(["not-an-image"], "catalog.png", { type: "image/png" })), null);
  assert.equal(await validateCatalogImage(new File(["text"], "catalog.txt", { type: "text/plain" })), null);
  console.log("S1/S2 database storefront fixture passed.");
  console.log("S3 double opt-in, opaque HMAC preference, and unsubscribe checks passed.");
  console.log("S4 media type and signature checks passed.");
  console.log("S5 delivery ZIP persistence passed.");
}

void (process.argv[2] === "verify" ? verifySmoke() : runSmoke()).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
