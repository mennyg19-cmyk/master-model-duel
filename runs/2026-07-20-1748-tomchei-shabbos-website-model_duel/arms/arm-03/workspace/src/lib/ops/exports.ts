import { createHash } from "node:crypto";
import { AuditAction, ExportDataset, OrderStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { marginReport, performanceReport } from "@/lib/ops/reports";
import { err, maskError, ok, type Result } from "@/lib/result";

function csvEscape(value: string | number | null | undefined): string {
  const raw = value == null ? "" : String(value);
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  return `${lines.join("\n")}\n`;
}

async function buildDataset(
  dataset: ExportDataset,
  seasonId?: string | null,
): Promise<{ headers: string[]; rows: Array<Array<string | number | null>> }> {
  switch (dataset) {
    case ExportDataset.DELIVERIES: {
      const stops = await db.routeStop.findMany({
        where: seasonId ? { route: { seasonId } } : undefined,
        include: {
          route: { select: { name: true, seasonId: true } },
          package: {
            select: {
              recipientName: true,
              stage: true,
              order: { select: { orderNumber: true } },
            },
          },
        },
        orderBy: [{ routeId: "asc" }, { sequence: "asc" }],
        take: 50_000,
      });
      return {
        headers: [
          "route",
          "sequence",
          "recipient",
          "status",
          "orderNumber",
          "deliveredAt",
        ],
        rows: stops.map((s) => [
          s.route.name,
          s.sequence,
          s.package.recipientName,
          s.status,
          s.package.order.orderNumber,
          s.deliveredAt?.toISOString() ?? "",
        ]),
      };
    }
    case ExportDataset.YEAR_END:
    case ExportDataset.YEAR_METRICS: {
      const perf = await performanceReport(
        seasonId ? { seasonIds: [seasonId] } : undefined,
      );
      return {
        headers: [
          "season",
          "year",
          "orders",
          "paidOrders",
          "revenueCents",
          "packages",
        ],
        rows: perf.map((p) => [
          p.name,
          p.year,
          p.orderCount,
          p.paidOrderCount,
          p.revenueCents,
          p.packageCount,
        ]),
      };
    }
    case ExportDataset.ITEM_SALES: {
      const lines = await db.orderLine.findMany({
        where: {
          order: {
            status: { not: OrderStatus.DRAFT },
            ...(seasonId ? { seasonId } : {}),
          },
        },
        include: {
          product: { select: { sku: true, name: true } },
          order: { select: { orderNumber: true, seasonId: true } },
        },
        take: 50_000,
      });
      return {
        headers: ["orderNumber", "sku", "name", "quantity", "unitPriceCents"],
        rows: lines.map((l) => [
          l.order.orderNumber,
          l.product.sku,
          l.product.name,
          l.quantity,
          l.unitPriceCents,
        ]),
      };
    }
    case ExportDataset.LAPSED_CUSTOMERS: {
      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - 1);
      const customers = await db.customer.findMany({
        where: {
          orders: { none: { placedAt: { gte: cutoff } } },
        },
        select: {
          displayName: true,
          email: true,
          phone: true,
          orders: {
            orderBy: { placedAt: "desc" },
            take: 1,
            select: { placedAt: true, orderNumber: true },
          },
        },
        take: 20_000,
      });
      return {
        headers: ["displayName", "email", "phone", "lastOrderAt", "lastOrderNumber"],
        rows: customers.map((c) => [
          c.displayName,
          c.email,
          c.phone,
          c.orders[0]?.placedAt?.toISOString() ?? "",
          c.orders[0]?.orderNumber ?? "",
        ]),
      };
    }
    case ExportDataset.SHIPPING_MARGIN: {
      const report = await marginReport(seasonId ? { seasonId } : undefined);
      return {
        headers: [
          "packageId",
          "orderId",
          "carrier",
          "chargedCents",
          "purchasedCents",
          "marginCents",
        ],
        rows: report.packages.map((p) => [
          p.packageId,
          p.orderId,
          p.carrier,
          p.chargedCents,
          p.purchasedCents,
          p.marginCents,
        ]),
      };
    }
    default:
      return { headers: ["error"], rows: [["unknown dataset"]] };
  }
}

export async function runCsvExport(input: {
  dataset: ExportDataset;
  seasonId?: string | null;
  staffId: string;
}): Promise<
  Result<{
    csv: string;
    auditId: string;
    rowCount: number;
    byteCount: number;
    checksum: string;
  }>
> {
  try {
    const built = await buildDataset(input.dataset, input.seasonId);
    const csv = toCsv(built.headers, built.rows);
    const checksum = createHash("sha256").update(csv).digest("hex");
    const byteCount = Buffer.byteLength(csv, "utf8");
    const rowCount = built.rows.length;

    const audit = await db.$transaction(async (tx) => {
      const created = await tx.exportAudit.create({
        data: {
          dataset: input.dataset,
          seasonId: input.seasonId ?? null,
          rowCount,
          byteCount,
          checksum,
          staffId: input.staffId,
          params: { seasonId: input.seasonId ?? null },
        },
      });
      await writeAudit(
        {
          action: AuditAction.EXPORT_RUN,
          actorId: input.staffId,
          meta: {
            exportAuditId: created.id,
            dataset: input.dataset,
            rowCount,
            checksum,
          },
        },
        tx,
      );
      return created;
    });

    return ok({
      csv,
      auditId: audit.id,
      rowCount,
      byteCount,
      checksum,
    });
  } catch (error) {
    return err(maskError(error), "Could not export CSV.");
  }
}

export async function listExportAudits(limit = 50) {
  return db.exportAudit.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { staff: { select: { displayName: true, email: true } } },
  });
}
