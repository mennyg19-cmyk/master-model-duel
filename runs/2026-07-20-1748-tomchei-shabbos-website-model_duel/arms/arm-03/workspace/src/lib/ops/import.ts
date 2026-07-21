import {
  AuditAction,
  CachedPaymentStatus,
  ImportBatchStatus,
  ImportKind,
  ImportRowStatus,
  OrderStatus,
  PaymentMethod,
  PaymentState,
  Prisma,
  ProductKind,
  SeasonStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/normalize";
import { normalizePhone } from "@/lib/phone";
import { err, maskError, ok, type Result } from "@/lib/result";
import { writeAudit } from "@/lib/audit";
import { formatDraftRef } from "@/lib/orders/draft-wire";
import { buildGroupingKey } from "@/lib/orders/grouping";
import { upsertCustomerAddress } from "@/lib/address/book";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      cell = "";
      if (row.some((c) => c.length)) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c.length)) rows.push(row);
  return rows;
}

function headerMap(header: string[]): Map<string, number> {
  const map = new Map<string, number>();
  header.forEach((h, i) => map.set(h.trim().toLowerCase(), i));
  return map;
}

function cell(row: string[], map: Map<string, number>, key: string): string {
  const idx = map.get(key);
  if (idx == null) return "";
  return row[idx] ?? "";
}

type StagedRow = {
  rowNumber: number;
  status: ImportRowStatus;
  raw: Record<string, string>;
  errors: string[] | null;
  targetKey: string | null;
};

async function classifyCustomerRows(rows: string[][]): Promise<StagedRow[]> {
  if (rows.length < 2) return [];
  const map = headerMap(rows[0]);
  const out: StagedRow[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const raw = {
      displayName: cell(rows[i], map, "displayname") || cell(rows[i], map, "name"),
      email: cell(rows[i], map, "email"),
      phone: cell(rows[i], map, "phone"),
    };
    const errors: string[] = [];
    if (!raw.displayName) errors.push("displayName required");
    const email = raw.email ? normalizeEmail(raw.email) : null;
    const phoneNorm = raw.phone ? normalizePhone(raw.phone) : null;
    if (!email && !phoneNorm) errors.push("email or phone required");
    if (raw.email && !email) errors.push("invalid email");
    if (raw.phone && !phoneNorm) errors.push("invalid phone");

    const targetKey = email ?? phoneNorm;
    let status: ImportRowStatus = errors.length ? ImportRowStatus.INVALID : ImportRowStatus.VALID;

    if (status === ImportRowStatus.VALID && targetKey) {
      if (seen.has(targetKey)) {
        status = ImportRowStatus.DUPLICATE;
        errors.push("duplicate in file");
      } else {
        seen.add(targetKey);
        const existing = email
          ? await db.customer.findFirst({
              where: { OR: [{ emailNorm: email }, { email }] },
            })
          : await db.customer.findFirst({ where: { phoneNorm: phoneNorm! } });
        if (existing) {
          status = ImportRowStatus.DUPLICATE;
          errors.push("already exists");
        }
      }
    }

    out.push({
      rowNumber: i,
      status,
      raw,
      errors: errors.length ? errors : null,
      targetKey,
    });
  }
  return out;
}

async function classifyProductRows(rows: string[][]): Promise<StagedRow[]> {
  if (rows.length < 2) return [];
  const map = headerMap(rows[0]);
  const season = await db.season.findFirst({
    where: { status: SeasonStatus.OPEN },
    orderBy: { year: "desc" },
  });
  const out: StagedRow[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const raw = {
      sku: cell(rows[i], map, "sku"),
      name: cell(rows[i], map, "name"),
      basePriceCents: cell(rows[i], map, "basepricecents") || cell(rows[i], map, "price"),
      kind: cell(rows[i], map, "kind") || "PACKAGE",
    };
    const errors: string[] = [];
    if (!season) errors.push("no open season");
    if (!raw.sku) errors.push("sku required");
    if (!raw.name) errors.push("name required");
    const price = Number.parseInt(raw.basePriceCents, 10);
    if (!Number.isFinite(price) || price < 0) errors.push("basePriceCents invalid");
    const kind = raw.kind.toUpperCase();
    if (!Object.values(ProductKind).includes(kind as ProductKind)) {
      errors.push("kind invalid");
    }

    const targetKey = season && raw.sku ? `${season.id}:${raw.sku}` : null;
    let status: ImportRowStatus = errors.length ? ImportRowStatus.INVALID : ImportRowStatus.VALID;

    if (status === ImportRowStatus.VALID && targetKey) {
      if (seen.has(targetKey)) {
        status = ImportRowStatus.DUPLICATE;
        errors.push("duplicate in file");
      } else {
        seen.add(targetKey);
        const existing = await db.product.findFirst({
          where: { seasonId: season!.id, sku: raw.sku },
        });
        if (existing) {
          status = ImportRowStatus.DUPLICATE;
          errors.push("sku exists in season");
        }
      }
    }

    out.push({
      rowNumber: i,
      status,
      raw,
      errors: errors.length ? errors : null,
      targetKey,
    });
  }
  return out;
}

/** Historical orders: orderNumber,email,sku,qty,recipient,line1,city,state,zip,method */
async function classifyOrderRows(rows: string[][]): Promise<StagedRow[]> {
  if (rows.length < 2) return [];
  const map = headerMap(rows[0]);
  const season =
    (await db.season.findFirst({
      where: { status: SeasonStatus.CLOSED },
      orderBy: { year: "desc" },
    })) ??
    (await db.season.findFirst({ orderBy: { year: "desc" } }));
  const out: StagedRow[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const raw = {
      orderNumber: cell(rows[i], map, "ordernumber") || cell(rows[i], map, "order"),
      email: cell(rows[i], map, "email"),
      sku: cell(rows[i], map, "sku") || cell(rows[i], map, "productsku"),
      qty: cell(rows[i], map, "qty") || cell(rows[i], map, "quantity") || "1",
      recipient: cell(rows[i], map, "recipient") || cell(rows[i], map, "recipientname"),
      line1: cell(rows[i], map, "line1") || cell(rows[i], map, "address"),
      city: cell(rows[i], map, "city"),
      state: cell(rows[i], map, "state"),
      zip: cell(rows[i], map, "zip") || cell(rows[i], map, "postalcode"),
      method: cell(rows[i], map, "method") || "DELIVERY",
    };
    const errors: string[] = [];
    if (!season) errors.push("no season for historical orders");
    const orderNum = Number.parseInt(raw.orderNumber, 10);
    if (!Number.isFinite(orderNum) || orderNum <= 0) {
      // Repair broken order numbers — assign provisional from row.
      raw.orderNumber = String(800000 + i);
      errors.push("orderNumber_repaired");
    }
    const email = raw.email ? normalizeEmail(raw.email) : null;
    if (!email) errors.push("email required");
    if (!raw.sku) errors.push("sku required");
    if (!raw.recipient) errors.push("recipient required");
    if (!raw.line1 || !raw.city || !raw.state || !raw.zip) errors.push("address incomplete");

    const product = season
      ? await db.product.findFirst({ where: { seasonId: season.id, sku: raw.sku } })
      : null;
    if (!product && raw.sku) errors.push("product missing — map required");

    const hardErrors = errors.filter((e) => e !== "orderNumber_repaired");
    const targetKey = `${raw.orderNumber}:${email ?? ""}:${raw.sku}`;
    let status: ImportRowStatus =
      hardErrors.length === 0 ? ImportRowStatus.VALID : ImportRowStatus.INVALID;

    if (status === ImportRowStatus.VALID) {
      if (seen.has(targetKey)) {
        status = ImportRowStatus.DUPLICATE;
        errors.push("duplicate in file");
      } else {
        seen.add(targetKey);
        const existing = await db.order.findFirst({
          where: {
            seasonId: season!.id,
            orderNumber: Number.parseInt(raw.orderNumber, 10),
          },
        });
        if (existing) {
          status = ImportRowStatus.DUPLICATE;
          errors.push("order exists");
        }
      }
    }

    out.push({
      rowNumber: i,
      status,
      raw: { ...raw, seasonId: season?.id ?? "" },
      errors: errors.length ? errors : null,
      targetKey,
    });
  }
  return out;
}

export async function stageImport(input: {
  kind: ImportKind;
  csvText: string;
  filename?: string | null;
  staffId: string;
  dryRun?: boolean;
}): Promise<Result<{ batchId: string; summary: Record<string, number>; dryRun: boolean }>> {
  try {
    const table = parseCsv(input.csvText);
    const staged =
      input.kind === ImportKind.CUSTOMERS
        ? await classifyCustomerRows(table)
        : input.kind === ImportKind.PRODUCTS
          ? await classifyProductRows(table)
          : await classifyOrderRows(table);

    const summary = {
      total: staged.length,
      valid: staged.filter((r) => r.status === ImportRowStatus.VALID).length,
      duplicate: staged.filter((r) => r.status === ImportRowStatus.DUPLICATE).length,
      invalid: staged.filter((r) => r.status === ImportRowStatus.INVALID).length,
    };

    const dryRun = Boolean(input.dryRun);
    const batch = await db.$transaction(async (tx) => {
      const created = await tx.importBatch.create({
        data: {
          kind: input.kind,
          status: ImportBatchStatus.STAGED,
          filename: input.filename ?? null,
          dryRun,
          stagedById: input.staffId,
          summary,
          rows: {
            create: staged.map((r) => ({
              rowNumber: r.rowNumber,
              status: r.status,
              raw: r.raw,
              errors: r.errors ?? Prisma.JsonNull,
              targetKey: r.targetKey,
            })),
          },
        },
      });
      await writeAudit(
        {
          action: dryRun ? AuditAction.LEGACY_IMPORT_DRY_RUN : AuditAction.IMPORT_STAGED,
          actorId: input.staffId,
          meta: { batchId: created.id, kind: input.kind, summary, dryRun },
        },
        tx,
      );
      return created;
    });

    return ok({ batchId: batch.id, summary, dryRun });
  } catch (error) {
    return err(maskError(error), "Could not stage import.");
  }
}

export async function getImportBatch(batchId: string) {
  return db.importBatch.findUnique({
    where: { id: batchId },
    include: {
      rows: { orderBy: { rowNumber: "asc" } },
      stagedBy: { select: { displayName: true } },
      committedBy: { select: { displayName: true } },
    },
  });
}

async function commitCustomerRow(
  tx: Prisma.TransactionClient,
  raw: Record<string, string>,
): Promise<"committed" | "duplicate"> {
  const emailNorm = raw.email ? normalizeEmail(raw.email) : null;
  const phoneNorm = raw.phone ? normalizePhone(raw.phone) : null;
  const existing = emailNorm
    ? await tx.customer.findFirst({
        where: { OR: [{ emailNorm }, { email: raw.email }] },
      })
    : phoneNorm
      ? await tx.customer.findFirst({ where: { phoneNorm } })
      : null;
  if (existing) return "duplicate";
  try {
    await tx.customer.create({
      data: {
        displayName: raw.displayName || raw.name || "Imported",
        email: raw.email || null,
        emailNorm,
        phone: raw.phone || null,
        phoneNorm,
      },
    });
    return "committed";
  } catch (createError) {
    if (
      createError instanceof Prisma.PrismaClientKnownRequestError &&
      createError.code === "P2002"
    ) {
      return "duplicate";
    }
    throw createError;
  }
}

async function commitProductRow(
  tx: Prisma.TransactionClient,
  raw: Record<string, string>,
  seasonId: string,
): Promise<"committed" | "duplicate"> {
  const price = Number.parseInt(raw.basePriceCents || raw.price || "0", 10);
  const kind = (raw.kind || "PACKAGE").toUpperCase() as ProductKind;
  const slug = `${raw.sku}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const existing = await tx.product.findFirst({
    where: { seasonId, sku: raw.sku },
  });
  if (existing) return "duplicate";
  try {
    await tx.product.create({
      data: {
        seasonId,
        sku: raw.sku,
        name: raw.name,
        slug,
        kind,
        basePriceCents: price,
        isActive: true,
        tracksInventory: true,
        inventory: { create: { onHand: 0, reserved: 0 } },
      },
    });
    return "committed";
  } catch (createError) {
    if (
      createError instanceof Prisma.PrismaClientKnownRequestError &&
      createError.code === "P2002"
    ) {
      return "duplicate";
    }
    throw createError;
  }
}

async function commitOrderRow(
  tx: Prisma.TransactionClient,
  raw: Record<string, string>,
): Promise<"committed" | "duplicate"> {
  const seasonId = raw.seasonId;
  const orderNumber = Number.parseInt(raw.orderNumber, 10);
  const existing = await tx.order.findFirst({
    where: { seasonId, orderNumber },
  });
  if (existing) return "duplicate";

  const email = normalizeEmail(raw.email);
  let customer = await tx.customer.findFirst({
    where: { OR: [{ emailNorm: email! }, { email: raw.email }] },
  });
  if (!customer) {
    customer = await tx.customer.create({
      data: {
        displayName: raw.recipient || raw.email,
        email: raw.email,
        emailNorm: email,
      },
    });
  }

  const product = await tx.product.findFirst({
    where: { seasonId, sku: raw.sku },
  });
  if (!product) throw new Error(`Product ${raw.sku} missing at commit`);

  const method =
    (await tx.fulfillmentMethod.findFirst({
      where: {
        code: {
          in: [
            (raw.method || "SHIP").toUpperCase(),
            "SHIP",
            "PER_PACKAGE_DELIVERY",
            "PICKUP",
          ],
        },
      },
      orderBy: { sortOrder: "asc" },
    })) ?? (await tx.fulfillmentMethod.findFirst());
  if (!method) throw new Error("No fulfillment method");

  const qty = Math.max(1, Number.parseInt(raw.qty || "1", 10) || 1);
  const greeting = "Imported historical";
  const groupingKey = buildGroupingKey({
    recipientName: raw.recipient,
    addressLine1: raw.line1,
    city: raw.city,
    state: raw.state,
    postalCode: raw.zip,
    fulfillmentMethodCode: method.code,
    greeting,
  });
  const totalCents = product.basePriceCents * qty;
  const placedAt = raw.placedAt ? new Date(raw.placedAt) : new Date("2025-03-01T12:00:00Z");
  await tx.order.create({
    data: {
      seasonId,
      customerId: customer.id,
      status: OrderStatus.PAID,
      orderNumber,
      draftRef: formatDraftRef(new Date().getFullYear(), `imp${orderNumber}`),
      paymentStatusCached: CachedPaymentStatus.PAID,
      expectedTotalCents: totalCents,
      placedAt: Number.isNaN(placedAt.getTime())
        ? new Date("2025-03-01T12:00:00Z")
        : placedAt,
      greetingDefault: greeting,
      checkoutSnapshot: { legacyImport: true, p12Fixture: true } as Prisma.InputJsonValue,
      lines: {
        create: {
          productId: product.id,
          quantity: qty,
          unitPriceCents: product.basePriceCents,
          recipientName: raw.recipient,
          addressLine1: raw.line1,
          city: raw.city,
          state: raw.state,
          postalCode: raw.zip,
          country: "US",
          fulfillmentMethodId: method.id,
          greeting,
          groupingKey,
        },
      },
      payments: {
        create: {
          method: PaymentMethod.CASH,
          state: PaymentState.POSTED,
          amountCents: totalCents,
          reference: `legacy-import-${orderNumber}`,
        },
      },
    },
  });
  return "committed";
}

/**
 * Atomic / resumable commit of VALID rows (R-063, R-186).
 * maxRows interrupts after N commits → INTERRUPTED + commitCursor for resume.
 * dryRun batches record would-commit counts without writing entities.
 */
export async function commitImport(input: {
  batchId: string;
  staffId: string;
  maxRows?: number;
}): Promise<
  Result<{
    committed: number;
    skipped: number;
    interrupted: boolean;
    commitCursor: number;
    dryRun: boolean;
  }>
> {
  try {
    const batch = await db.importBatch.findUnique({
      where: { id: input.batchId },
      include: { rows: { orderBy: { rowNumber: "asc" } } },
    });
    if (!batch) return err("missing", "Import batch not found.");
    if (
      batch.status !== ImportBatchStatus.STAGED &&
      batch.status !== ImportBatchStatus.INTERRUPTED
    ) {
      return err("state", `Batch is ${batch.status}, expected STAGED or INTERRUPTED.`);
    }

    const season =
      batch.kind === ImportKind.PRODUCTS || batch.kind === ImportKind.ORDERS
        ? batch.kind === ImportKind.ORDERS
          ? await db.season.findFirst({
              where: { status: SeasonStatus.CLOSED },
              orderBy: { year: "desc" },
            })
          : await db.season.findFirst({
              where: { status: SeasonStatus.OPEN },
              orderBy: { year: "desc" },
            })
        : null;
    if (batch.kind === ImportKind.PRODUCTS && !season) {
      return err("season", "No open season for product import.");
    }

    const maxRows = input.maxRows ?? Number.POSITIVE_INFINITY;
    let committed = 0;
    let skipped = 0;
    let lastCursor = batch.commitCursor;
    let interrupted = false;

    const pending = batch.rows.filter(
      (r) =>
        r.rowNumber > batch.commitCursor &&
        (r.status === ImportRowStatus.VALID ||
          r.status === ImportRowStatus.DUPLICATE ||
          r.status === ImportRowStatus.INVALID),
    );

    for (const row of pending) {
      if (committed >= maxRows) {
        interrupted = true;
        break;
      }

      if (row.status !== ImportRowStatus.VALID) {
        skipped += 1;
        await db.importRow.update({
          where: { id: row.id },
          data: { status: ImportRowStatus.SKIPPED },
        });
        lastCursor = row.rowNumber;
        continue;
      }

      const raw = row.raw as Record<string, string>;

      if (batch.dryRun) {
        committed += 1;
        await db.importRow.update({
          where: { id: row.id },
          data: { status: ImportRowStatus.COMMITTED },
        });
        lastCursor = row.rowNumber;
        continue;
      }

      const outcome = await db.$transaction(async (tx) => {
        if (batch.kind === ImportKind.CUSTOMERS) {
          return commitCustomerRow(tx, raw);
        }
        if (batch.kind === ImportKind.PRODUCTS) {
          return commitProductRow(tx, raw, season!.id);
        }
        return commitOrderRow(tx, raw);
      });

      if (outcome === "duplicate") {
        skipped += 1;
        await db.importRow.update({
          where: { id: row.id },
          data: {
            status: ImportRowStatus.SKIPPED,
            errors: ["duplicate at commit"],
          },
        });
      } else {
        committed += 1;
        await db.importRow.update({
          where: { id: row.id },
          data: { status: ImportRowStatus.COMMITTED },
        });
        if (batch.kind === ImportKind.ORDERS && !batch.dryRun) {
          const email = normalizeEmail(raw.email);
          const customer = await db.customer.findFirst({
            where: { OR: [{ emailNorm: email! }, { email: raw.email }] },
          });
          if (customer) {
            await upsertCustomerAddress(
              customer.id,
              {
                recipientName: raw.recipient,
                line1: raw.line1,
                city: raw.city,
                state: raw.state,
                postalCode: raw.zip,
                country: "US",
              },
              { actorStaffId: input.staffId },
            );
          }
        }
      }
      lastCursor = row.rowNumber;
    }

    const done = !interrupted;
    await db.importBatch.update({
      where: { id: batch.id },
      data: {
        status: interrupted
          ? ImportBatchStatus.INTERRUPTED
          : ImportBatchStatus.COMMITTED,
        commitCursor: lastCursor,
        committedById: input.staffId,
        committedAt: done ? new Date() : null,
        summary: {
          ...(batch.summary as object),
          committed:
            ((batch.summary as { committed?: number } | null)?.committed ?? 0) +
            committed,
          skipped:
            ((batch.summary as { skipped?: number } | null)?.skipped ?? 0) + skipped,
          dryRun: batch.dryRun,
        },
      },
    });

    await writeAudit({
      action: batch.dryRun
        ? AuditAction.LEGACY_IMPORT_DRY_RUN
        : AuditAction.IMPORT_COMMITTED,
      actorId: input.staffId,
      meta: {
        batchId: batch.id,
        committed,
        skipped,
        interrupted,
        commitCursor: lastCursor,
        dryRun: batch.dryRun,
      },
    });

    return ok({
      committed,
      skipped,
      interrupted,
      commitCursor: lastCursor,
      dryRun: batch.dryRun,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return err("P2002", "Import hit a duplicate key — retry after refresh.");
    }
    return err(maskError(error), "Could not commit import.");
  }
}
