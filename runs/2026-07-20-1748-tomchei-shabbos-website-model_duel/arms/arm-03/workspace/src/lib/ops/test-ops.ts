import {
  AuditAction,
  CachedPaymentStatus,
  OrderStatus,
  PackageStage,
  PaymentMethod,
  PaymentState,
  Prisma,
} from "@prisma/client";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { getSetting, setSetting } from "@/lib/settings";
import { err, maskError, ok, type Result } from "@/lib/result";
import { OPS_SETTINGS, type AlertBannerSetting } from "@/lib/ops/settings-keys";
import { getEnv } from "@/lib/env";
import { formatDraftRef } from "@/lib/orders/draft-wire";
import { runNightlyPrintBatch } from "@/lib/ops/print-batch";

const SCALE_ORDER_TARGET = 1000;
const SCALE_PACKAGES_PER_ORDER = 5;
const SCALE_PACKAGE_TARGET = SCALE_ORDER_TARGET * SCALE_PACKAGES_PER_ORDER;
const SCALE_NIGHTLY_MS_LIMIT = 120_000;

export const TEST_MODE_KEY = "ops.testMode";

export type TestModeSetting = {
  enabled: boolean;
  env: "test" | "live";
};

/** Destructive test-ops only when IS_TEST_ENV or AUTH_MODE=dev (never production). */
export function isTestEnvAllowed(): boolean {
  const env = getEnv();
  if (env.NODE_ENV === "production") return false;
  return env.IS_TEST_ENV === true || env.AUTH_MODE === "dev";
}

export async function getTestMode(): Promise<TestModeSetting> {
  const value = await getSetting<TestModeSetting>(TEST_MODE_KEY);
  return value ?? { enabled: false, env: "live" };
}

export async function setTestMode(input: {
  enabled: boolean;
  env?: "test" | "live";
  staffId?: string | null;
}): Promise<Result<TestModeSetting>> {
  try {
    if (!isTestEnvAllowed()) {
      return err("test_env", "Test mode is only available in IS_TEST_ENV / AUTH_MODE=dev.");
    }
    const next: TestModeSetting = {
      enabled: input.enabled,
      env: input.env ?? (input.enabled ? "test" : "live"),
    };
    await setSetting(TEST_MODE_KEY, next);
    const banner: AlertBannerSetting = input.enabled
      ? {
          message: "TEST MODE — destructive ops enabled; data may be wiped.",
          tone: "warn",
          active: true,
        }
      : { message: "", tone: "info", active: false };
    await setSetting(OPS_SETTINGS.alertBanner, banner);
    await writeAudit({
      action: AuditAction.TEST_OPS_ACTION,
      actorId: input.staffId ?? null,
      meta: { action: "set_test_mode", ...next },
    });
    return ok(next);
  } catch (error) {
    return err(maskError(error), "Could not update test mode.");
  }
}

/** Orders matching any P12/P6 test fixture marker. */
function fixtureOrderWhere() {
  return {
    OR: [
      { checkoutSnapshot: { path: ["scaleFixture"], equals: "p6" } },
      { checkoutSnapshot: { path: ["scaleFixture"], equals: "p12" } },
      { checkoutSnapshot: { path: ["dressRehearsal"], equals: true } },
      { checkoutSnapshot: { path: ["p12Fixture"], equals: true } },
      { checkoutSnapshot: { path: ["legacyImport"], equals: true } },
      { checkoutSnapshot: { path: ["dress"], equals: true } },
      { draftRef: { startsWith: "p12-dress-" } },
      { draftRef: { startsWith: "p12-wipe-" } },
    ],
  };
}

/**
 * Wipe scale + dress-rehearsal + legacy-import fixtures and P12 smoke customers.
 * Keeps core seed staff/catalog (customer@tomchei.local etc.).
 */
export async function wipeTestFixtures(input: {
  staffId: string;
}): Promise<Result<{ deletedOrders: number; deletedLabels: number; deletedCustomers: number }>> {
  try {
    if (!isTestEnvAllowed()) {
      return err("test_env", "Wipe is only available in IS_TEST_ENV / AUTH_MODE=dev.");
    }
    const mode = await getTestMode();
    if (!mode.enabled) {
      return err("test_mode", "Enable test mode before wipe.");
    }

    const scaleOrders = await db.order.findMany({
      where: fixtureOrderWhere(),
      select: { id: true, customerId: true },
    });
    const ids = scaleOrders.map((o) => o.id);
    let deletedLabels = 0;
    if (ids.length) {
      const labels = await db.shippingLabel.deleteMany({ where: { orderId: { in: ids } } });
      deletedLabels = labels.count;
      await db.order.deleteMany({ where: { id: { in: ids } } });
    }

    // Clear P12 import / smoke customers (not core seed emails).
    const importCustomers = await db.customer.findMany({
      where: {
        OR: [
          { email: { startsWith: "p12." } },
          { emailNorm: { startsWith: "p12." } },
          { displayName: { startsWith: "P12 " } },
        ],
      },
      select: { id: true },
    });
    const customerIds = importCustomers.map((c) => c.id);
    let deletedCustomers = 0;
    if (customerIds.length) {
      await db.order.deleteMany({ where: { customerId: { in: customerIds } } });
      const removed = await db.customer.deleteMany({ where: { id: { in: customerIds } } });
      deletedCustomers = removed.count;
    }

    // All orphan reconcile adjustments (ops path uses orphan:<piId>).
    await db.paymentReconcileAdjustment.deleteMany({
      where: { fingerprint: { startsWith: "orphan:" } },
    });
    await db.exportAudit.deleteMany({
      where: { params: { path: ["smoke"], equals: "p12" } },
    });
    await db.importBatch.deleteMany({
      where: {
        OR: [
          { filename: { contains: "messy-p12" } },
          { filename: { contains: "p12" } },
        ],
      },
    });

    await writeAudit({
      action: AuditAction.TEST_OPS_ACTION,
      actorId: input.staffId,
      meta: {
        action: "wipe",
        deletedOrders: ids.length,
        deletedLabels,
        deletedCustomers,
      },
    });

    return ok({ deletedOrders: ids.length, deletedLabels, deletedCustomers });
  } catch (error) {
    return err(maskError(error), "Wipe failed.");
  }
}

/**
 * Wipe fixtures then restore a clean open-season baseline:
 * inventory headroom + nextOrderNumber aligned to remaining orders.
 */
export async function reseedTestSeason(input: {
  staffId: string;
}): Promise<Result<{ openSeasonId: string; orderCount: number; packageCount: number }>> {
  try {
    if (!isTestEnvAllowed()) {
      return err("test_env", "Reseed is only available in IS_TEST_ENV / AUTH_MODE=dev.");
    }
    const mode = await getTestMode();
    if (!mode.enabled) {
      return err("test_mode", "Enable test mode before reseed.");
    }

    const wiped = await wipeTestFixtures({ staffId: input.staffId });
    if (!wiped.ok) return wiped;

    const season = await db.season.findFirst({
      where: { status: "OPEN" },
      orderBy: { year: "desc" },
    });
    if (!season) return err("season", "No open season.");

    const maxOrder = await db.order.aggregate({
      where: { seasonId: season.id, orderNumber: { not: null } },
      _max: { orderNumber: true },
    });
    const nextOrderNumber = (maxOrder._max.orderNumber ?? 0) + 1;
    await db.season.update({
      where: { id: season.id },
      data: { nextOrderNumber },
    });

    const products = await db.product.findMany({
      where: { seasonId: season.id, isActive: true },
      select: { id: true },
    });
    for (const product of products) {
      await db.inventoryItem.upsert({
        where: { productId: product.id },
        create: { productId: product.id, onHand: 500, reserved: 0, version: 1 },
        update: { onHand: 500, reserved: 0 },
      });
    }

    const orderCount = await db.order.count({
      where: { seasonId: season.id, status: { not: "DRAFT" } },
    });
    const packageCount = await db.package.count({
      where: { order: { seasonId: season.id } },
    });

    await writeAudit({
      action: AuditAction.TEST_OPS_ACTION,
      actorId: input.staffId,
      meta: {
        action: "reseed",
        openSeasonId: season.id,
        orderCount,
        packageCount,
        nextOrderNumber,
        wiped: wiped.value,
      },
    });

    return ok({
      openSeasonId: season.id,
      orderCount,
      packageCount,
    });
  } catch (error) {
    return err(maskError(error), "Reseed failed.");
  }
}

function scaleFixtureWhere() {
  return {
    OR: [
      { checkoutSnapshot: { path: ["scaleFixture"], equals: "p6" } },
      { checkoutSnapshot: { path: ["scaleFixture"], equals: "p12" } },
    ],
  };
}

async function countScaleFixtures() {
  const scaleOrders = await db.order.count({ where: scaleFixtureWhere() });
  const scalePackages = await db.package.count({
    where: { order: scaleFixtureWhere() },
  });
  return { scaleOrders, scalePackages };
}

/**
 * Ensure ~1k scale orders / ~5k packages exist (marker scaleFixture=p12).
 * Idempotent — only creates the deficit.
 */
export async function ensureScaleFixtures(): Promise<
  Result<{ scaleOrders: number; scalePackages: number; createdOrders: number }>
> {
  try {
    const season = await db.season.findFirst({
      where: { status: "OPEN" },
      orderBy: { year: "desc" },
    });
    if (!season) return err("season", "No open season.");

    const customer = await db.customer.findFirst({
      where: { email: "customer@tomchei.local" },
    });
    if (!customer) return err("customer", "Seed customer missing.");

    const method = await db.fulfillmentMethod.findFirst({ where: { isActive: true } });
    if (!method) return err("methods", "No fulfillment method.");

    const product = await db.product.findFirst({
      where: { sku: "FAMILY-BOX", seasonId: season.id, isActive: true },
    });
    if (!product) return err("product", "FAMILY-BOX missing.");

    const existing = await db.order.count({ where: scaleFixtureWhere() });
    const needOrders = Math.max(0, SCALE_ORDER_TARGET - existing);
    let nextNum = Math.max(season.nextOrderNumber, 10_000 + existing);
    const batchSize = 40;

    for (let i = 0; i < needOrders; i += batchSize) {
      const chunk = Math.min(batchSize, needOrders - i);
      await db.$transaction(async (tx) => {
        for (let j = 0; j < chunk; j++) {
          const n = existing + i + j + 1;
          const orderNumber = nextNum++;
          const draftRef = formatDraftRef(
            season.year,
            `p12s${n}${randomBytes(3).toString("hex")}`,
          );
          const order = await tx.order.create({
            data: {
              seasonId: season.id,
              customerId: customer.id,
              status: OrderStatus.PAID,
              orderNumber,
              draftRef,
              paymentStatusCached: CachedPaymentStatus.PAID,
              expectedTotalCents: product.basePriceCents,
              placedAt: new Date(),
              checkoutSnapshot: {
                scaleFixture: "p12",
                n,
              } as Prisma.InputJsonValue,
              lines: {
                create: {
                  productId: product.id,
                  quantity: 1,
                  unitPriceCents: product.basePriceCents,
                  recipientName: `Scale Recip ${n}`,
                  addressLine1: `${100 + (n % 900)} Scale St`,
                  city: "Brooklyn",
                  state: "NY",
                  postalCode: "11218",
                  country: "US",
                  fulfillmentMethodId: method.id,
                  groupingKey: `scale|p12|${n}`,
                },
              },
              payments: {
                create: {
                  method: PaymentMethod.CASH,
                  state: PaymentState.POSTED,
                  amountCents: product.basePriceCents,
                  reference: `scale-p12-${n}`,
                },
              },
            },
          });

          await tx.package.createMany({
            data: Array.from({ length: SCALE_PACKAGES_PER_ORDER }, (_, p) => ({
              orderId: order.id,
              groupingKey: `scale|p12|${n}|${p}`,
              recipientName: `Scale Recip ${n}-${p}`,
              addressLine1: `${100 + (n % 900)} Scale St`,
              city: "Brooklyn",
              state: "NY",
              postalCode: "11218",
              country: "US",
              fulfillmentMethodId: method.id,
              stage: PackageStage.NEW,
            })),
          });
        }
      });
    }

    if (needOrders > 0) {
      await db.season.update({
        where: { id: season.id },
        data: { nextOrderNumber: nextNum },
      });
    }

    let counts = await countScaleFixtures();
    // Top up packages if order count hit target but package count is short
    // (e.g. older fixtures with fewer packages per order).
    if (
      counts.scaleOrders >= SCALE_ORDER_TARGET &&
      counts.scalePackages < SCALE_PACKAGE_TARGET
    ) {
      const deficit = SCALE_PACKAGE_TARGET - counts.scalePackages;
      const host = await db.order.findFirst({
        where: scaleFixtureWhere(),
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (host) {
        await db.package.createMany({
          data: Array.from({ length: deficit }, (_, p) => ({
            orderId: host.id,
            groupingKey: `scale|p12|topup|${Date.now()}|${p}`,
            recipientName: `Scale Topup ${p}`,
            addressLine1: "1 Scale Topup St",
            city: "Brooklyn",
            state: "NY",
            postalCode: "11218",
            country: "US",
            fulfillmentMethodId: method.id,
            stage: PackageStage.NEW,
          })),
        });
      }
      counts = await countScaleFixtures();
    }

    return ok({ ...counts, createdOrders: needOrders });
  } catch (error) {
    return err(maskError(error), "Could not ensure scale fixtures.");
  }
}

/**
 * Scale print probe: require 1k/5k fixtures, reset them to NEW, run nightly.
 * Fails (does not vacuous-pass) when the fixture set is empty or under target.
 */
export async function scalePrintProbe(input: {
  staffId: string;
}): Promise<
  Result<{
    elapsedMs: number;
    scaleOrders: number;
    scalePackages: number;
    newPackagesProcessed: number;
    acceptable: boolean;
    batchId: string;
    runKey: string;
    created: boolean;
    artifactCount: number;
  }>
> {
  try {
    if (!isTestEnvAllowed()) {
      return err("test_env", "Scale print probe is only available in IS_TEST_ENV / AUTH_MODE=dev.");
    }
    const mode = await getTestMode();
    if (!mode.enabled) {
      return err("test_mode", "Enable test mode before scale print probe.");
    }

    const ensured = await ensureScaleFixtures();
    if (!ensured.ok) return ensured;

    const { scaleOrders, scalePackages } = ensured.value;
    if (scaleOrders < SCALE_ORDER_TARGET || scalePackages < SCALE_PACKAGE_TARGET) {
      return err(
        "scale_empty",
        `Scale fixtures under target (orders=${scaleOrders}/${SCALE_ORDER_TARGET}, packages=${scalePackages}/${SCALE_PACKAGE_TARGET}).`,
      );
    }

    const season = await db.season.findFirst({
      where: { status: "OPEN" },
      orderBy: { year: "desc" },
    });
    if (!season) return err("season", "No open season.");

    // Fixture set must be at 1k/5k; print a non-empty NEW sample so nightly is not vacuous
    // (full 5k PDF encode OOMs smoke — counts prove scale; sample proves print path).
    const PROBE_NEW_SAMPLE = 250;
    await db.package.updateMany({
      where: { order: scaleFixtureWhere() },
      data: { stage: PackageStage.PRINTED },
    });
    const sampleIds = (
      await db.package.findMany({
        where: { order: scaleFixtureWhere() },
        take: PROBE_NEW_SAMPLE,
        orderBy: { createdAt: "asc" },
        select: { id: true },
      })
    ).map((row) => row.id);
    if (sampleIds.length < PROBE_NEW_SAMPLE) {
      return err(
        "scale_empty",
        `Could not mark ${PROBE_NEW_SAMPLE} NEW packages for probe (got ${sampleIds.length}).`,
      );
    }
    await db.package.updateMany({
      where: { id: { in: sampleIds } },
      data: { stage: PackageStage.NEW },
    });

    const started = Date.now();
    const print = await runNightlyPrintBatch({
      seasonId: season.id,
      actorId: input.staffId,
      day: `scale-probe-${Date.now()}`,
    });
    const elapsedMs = Date.now() - started;
    if (!print.ok) return err(print.error, print.publicMessage);

    const newPackagesProcessed = print.value.packageCount;
    if (newPackagesProcessed < PROBE_NEW_SAMPLE) {
      return err(
        "scale_empty",
        `Nightly processed ${newPackagesProcessed} NEW packages; expected >= ${PROBE_NEW_SAMPLE} (fixtures ${scaleOrders}/${scalePackages}).`,
      );
    }

    const acceptable = elapsedMs < SCALE_NIGHTLY_MS_LIMIT;
    await writeAudit({
      action: AuditAction.TEST_OPS_ACTION,
      actorId: input.staffId,
      meta: {
        action: "scalePrintProbe",
        elapsedMs,
        scaleOrders,
        scalePackages,
        newPackagesProcessed,
        acceptable,
      },
    });

    return ok({
      elapsedMs,
      scaleOrders,
      scalePackages,
      newPackagesProcessed,
      acceptable,
      batchId: print.value.batchId,
      runKey: print.value.runKey,
      created: print.value.created,
      artifactCount: print.value.artifactCount,
    });
  } catch (error) {
    return err(maskError(error), "Scale print probe failed.");
  }
}
