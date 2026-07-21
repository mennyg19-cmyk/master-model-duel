import {
  AuditAction,
  CachedPaymentStatus,
  OrderStatus,
  SeasonStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { err, maskError, ok, type Result } from "@/lib/result";
import { upsertCustomerAddress } from "@/lib/address/book";

/**
 * P12 migration hook stub — seeds an imported prior-year paid order so P10 S3
 * can exercise repeat → mapped products, recipients, address book, greetings.
 */
export async function seedImportedPriorYearOrder(input?: {
  customerEmail?: string;
  actorId?: string | null;
}): Promise<
  Result<{
    orderId: string;
    productId: string;
    targetProductId: string;
    savedAddressId: string;
    greeting: string;
  }>
> {
  try {
    const archive =
      (await db.season.findFirst({
        where: { slug: "purim-2025", status: SeasonStatus.CLOSED },
      })) ??
      (await db.season.findFirst({
        where: { status: SeasonStatus.CLOSED },
        orderBy: { year: "desc" },
      }));
    if (!archive) return err("season", "No closed prior-year season found.");

    const open = await db.season.findFirst({
      where: { status: SeasonStatus.OPEN },
      orderBy: { year: "desc" },
    });
    if (!open) return err("season", "No open season for replacement target.");

    const priorProduct =
      (await db.product.findFirst({
        where: { seasonId: archive.id, sku: "CLASSIC-2025" },
      })) ??
      (await db.product.findFirst({ where: { seasonId: archive.id } }));
    if (!priorProduct) return err("product", "Prior-year product missing.");

    const targetProduct =
      (await db.product.findFirst({
        where: { seasonId: open.id, sku: "FAMILY-BOX", isActive: true },
      })) ??
      (await db.product.findFirst({
        where: { seasonId: open.id, isActive: true },
        orderBy: { sortOrder: "asc" },
      }));
    if (!targetProduct) return err("product", "Open-season product missing.");

    // Ensure cross-season replacement mapping exists.
    await db.productReplacement.upsert({
      where: {
        fromProductId_toProductId: {
          fromProductId: priorProduct.id,
          toProductId: targetProduct.id,
        },
      },
      create: {
        fromProductId: priorProduct.id,
        toProductId: targetProduct.id,
        note: "P10 import stub mapping",
      },
      update: { note: "P10 import stub mapping" },
    });

    const customer = await db.customer.findFirst({
      where: {
        email: input?.customerEmail ?? "customer@tomchei.local",
      },
    });
    if (!customer) return err("customer", "Seed customer not found.");

    const greeting = "Chag Sameach — imported prior year";
    const addr = await upsertCustomerAddress(customer.id, {
      label: "Imported prior-year recipient",
      recipientName: "Legacy Recipient",
      line1: "88 Import Ave",
      city: "Brooklyn",
      state: "NY",
      postalCode: "11218",
      country: "US",
    });
    if (!addr.ok) return err(addr.error, addr.publicMessage);

    const method =
      (await db.fulfillmentMethod.findFirst({ where: { code: "DELIVERY" } })) ??
      (await db.fulfillmentMethod.findFirst());
    if (!method) return err("method", "Fulfillment method missing.");

    const draftRef = `IMP-2025-${Date.now().toString(36)}`;
    const order = await db.order.create({
      data: {
        seasonId: archive.id,
        customerId: customer.id,
        status: OrderStatus.PAID,
        draftRef,
        orderNumber: 900000 + Math.floor(Math.random() * 9000),
        greetingDefault: greeting,
        paymentStatusCached: CachedPaymentStatus.PAID,
        expectedTotalCents: priorProduct.basePriceCents,
        placedAt: new Date("2025-03-01T12:00:00Z"),
        lines: {
          create: {
            productId: priorProduct.id,
            quantity: 1,
            unitPriceCents: priorProduct.basePriceCents,
            recipientName: "Legacy Recipient",
            addressLine1: "88 Import Ave",
            city: "Brooklyn",
            state: "NY",
            postalCode: "11218",
            country: "US",
            savedAddressId: addr.value.address.id,
            fulfillmentMethodId: method.id,
            greeting,
            groupingKey: "imported",
          },
        },
      },
    });

    await writeAudit({
      action: AuditAction.IMPORT_COMMITTED,
      actorId: input?.actorId ?? null,
      meta: {
        kind: "prior_year_order_stub",
        orderId: order.id,
        sourceSeasonId: archive.id,
        mappedToProductId: targetProduct.id,
      },
    });

    return ok({
      orderId: order.id,
      productId: priorProduct.id,
      targetProductId: targetProduct.id,
      savedAddressId: addr.value.address.id,
      greeting,
    });
  } catch (error) {
    return err(maskError(error), "Could not seed imported prior-year order.");
  }
}
