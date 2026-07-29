/**
 * P10 (R-048 / S3): year-one migration HOOK for prior-year orders. The full
 * P12 import pipeline is out of scope; this stub persists legacy rows as
 * FINALIZED orders in a per-year "Legacy <year>" season so the repeat flow
 * works from day one.
 *
 * Unknown legacy products become inactive stub products (price 0, no
 * replacement link): a repeat of the imported order lands on the review
 * page with price-smart suggestions, exactly like any discontinued line.
 * When the legacy row names a product that exists in the legacy season's
 * catalog (because staff imported or recreated it), the line maps cleanly.
 */
import { prisma } from "@/lib/db";
import { AuditContextLike, recordAudit } from "@/lib/audit";

export interface LegacyRecipientRow {
  name: string;
  line1: string;
  line2?: string | null;
  city: string;
  region: string;
  postalCode: string;
  country?: string;
  greeting?: string | null;
}

export interface LegacyLineRow {
  productName: string;
  qty: number;
  /** Matches LegacyRecipientRow.name; unassigned when omitted. */
  recipientName?: string;
}

export interface LegacyOrderRow {
  customerEmail: string;
  customerName?: string;
  /** Prior-year tag, e.g. 2025 → season "Legacy 2025". */
  year: number;
  /** Stable external key — re-importing the same key is a skip, not a dupe. */
  externalKey?: string;
  recipients: LegacyRecipientRow[];
  lines: LegacyLineRow[];
}

export interface LegacyImportReport {
  created: number;
  skipped: { customerEmail: string; reason: string }[];
}

function legacySeasonName(year: number): string {
  return `Legacy ${year}`;
}

async function stubProduct(seasonId: string, year: number, productName: string) {
  const slug = `legacy-${year}-${productName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  return prisma.product.upsert({
    where: { slug },
    update: {},
    create: {
      slug,
      name: productName,
      seasonId,
      basePriceCents: 0,
      // Inactive + unmapped: repeat treats it as a dead end and offers
      // price-smart suggestions — the review page is the mapping UI.
      active: false,
    },
  });
}

export async function importLegacyOrders(
  rows: LegacyOrderRow[],
  input: { ctx: AuditContextLike },
): Promise<LegacyImportReport> {
  const report: LegacyImportReport = { created: 0, skipped: [] };

  for (const row of rows) {
    const email = row.customerEmail.trim().toLowerCase();
    if (!email || row.lines.length === 0) {
      report.skipped.push({ customerEmail: email || "(missing)", reason: "email and at least one line are required" });
      continue;
    }
    const marker = `legacy-import:${row.year}:${row.externalKey ?? email}`;

    const season = await prisma.season.upsert({
      where: { name: legacySeasonName(row.year) },
      update: {},
      create: { name: legacySeasonName(row.year), status: "CLOSED" },
    });

    const dupe = await prisma.order.findFirst({
      where: { wireFormat: marker, status: "FINALIZED" },
      select: { id: true },
    });
    if (dupe) {
      report.skipped.push({ customerEmail: email, reason: "already imported (external key seen)" });
      continue;
    }

    const customer = await prisma.customer.upsert({
      where: { email },
      update: {},
      create: { email, name: row.customerName?.trim() || email.split("@")[0] },
    });

    // Products: match the legacy season's catalog by name; otherwise stub.
    const catalog = await prisma.product.findMany({ where: { seasonId: season.id } });
    const byName = new Map(catalog.map((product) => [product.name.toLowerCase(), product]));

    await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          seasonId: season.id,
          customerId: customer.id,
          status: "FINALIZED",
          paymentStatus: "PAID",
          wireFormat: marker,
          totalCents: 0,
        },
      });

      const recipientIds = new Map<string, string>();
      for (const recipient of row.recipients) {
        const created = await tx.draftRecipient.create({
          data: {
            orderId: order.id,
            name: recipient.name,
            line1: recipient.line1,
            line2: recipient.line2 ?? null,
            city: recipient.city,
            region: recipient.region,
            postalCode: recipient.postalCode,
            country: recipient.country ?? "US",
            greeting: recipient.greeting ?? null,
          },
        });
        recipientIds.set(recipient.name.toLowerCase(), created.id);
      }

      for (const line of row.lines) {
        const known = byName.get(line.productName.toLowerCase());
        const product = known ?? (await stubProduct(season.id, row.year, line.productName));
        if (!known) byName.set(line.productName.toLowerCase(), product);
        const qty = Number.isInteger(line.qty) && line.qty > 0 ? line.qty : 1;
        await tx.orderLine.create({
          data: {
            orderId: order.id,
            productId: product.id,
            productName: product.name,
            qty,
            unitPriceCents: product.basePriceCents,
            lineTotalCents: product.basePriceCents * qty,
            recipientId: line.recipientName
              ? (recipientIds.get(line.recipientName.toLowerCase()) ?? null)
              : null,
          },
        });
      }
    });
    report.created++;
  }

  await recordAudit({
    ctx: input.ctx,
    action: "legacy_import",
    targetType: "Season",
    metadata: { created: report.created, skipped: report.skipped.length, years: [...new Set(rows.map((r) => r.year))] },
  });
  return report;
}
