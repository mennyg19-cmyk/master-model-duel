import {
  AuditAction,
  ImportBatchStatus,
  ImportKind,
  ImportRowStatus,
  Prisma,
  ProductKind,
  SeasonStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/normalize";
import { normalizePhone } from "@/lib/phone";
import { err, maskError, ok, type Result } from "@/lib/result";
import { writeAudit } from "@/lib/audit";

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

export async function stageImport(input: {
  kind: ImportKind;
  csvText: string;
  filename?: string | null;
  staffId: string;
}): Promise<Result<{ batchId: string; summary: Record<string, number> }>> {
  try {
    const table = parseCsv(input.csvText);
    const staged =
      input.kind === ImportKind.CUSTOMERS
        ? await classifyCustomerRows(table)
        : await classifyProductRows(table);

    const summary = {
      total: staged.length,
      valid: staged.filter((r) => r.status === ImportRowStatus.VALID).length,
      duplicate: staged.filter((r) => r.status === ImportRowStatus.DUPLICATE).length,
      invalid: staged.filter((r) => r.status === ImportRowStatus.INVALID).length,
    };

    const batch = await db.$transaction(async (tx) => {
      const created = await tx.importBatch.create({
        data: {
          kind: input.kind,
          status: ImportBatchStatus.STAGED,
          filename: input.filename ?? null,
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
          action: AuditAction.IMPORT_STAGED,
          actorId: input.staffId,
          meta: { batchId: created.id, kind: input.kind, summary },
        },
        tx,
      );
      return created;
    });

    return ok({ batchId: batch.id, summary });
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

/** Atomic commit of VALID rows only (R-063). */
export async function commitImport(input: {
  batchId: string;
  staffId: string;
}): Promise<Result<{ committed: number; skipped: number }>> {
  try {
    const batch = await db.importBatch.findUnique({
      where: { id: input.batchId },
      include: { rows: true },
    });
    if (!batch) return err("missing", "Import batch not found.");
    if (batch.status !== ImportBatchStatus.STAGED) {
      return err("state", `Batch is ${batch.status}, expected STAGED.`);
    }

    const season =
      batch.kind === ImportKind.PRODUCTS
        ? await db.season.findFirst({
            where: { status: SeasonStatus.OPEN },
            orderBy: { year: "desc" },
          })
        : null;
    if (batch.kind === ImportKind.PRODUCTS && !season) {
      return err("season", "No open season for product import.");
    }

    const result = await db.$transaction(async (tx) => {
      let committed = 0;
      let skipped = 0;

      for (const row of batch.rows) {
        if (row.status !== ImportRowStatus.VALID) {
          skipped += 1;
          await tx.importRow.update({
            where: { id: row.id },
            data: { status: ImportRowStatus.SKIPPED },
          });
          continue;
        }

        const raw = row.raw as Record<string, string>;
        let lateDuplicate = false;

        if (batch.kind === ImportKind.CUSTOMERS) {
          const emailNorm = raw.email ? normalizeEmail(raw.email) : null;
          const phoneNorm = raw.phone ? normalizePhone(raw.phone) : null;
          // B5: re-check duplicates under the commit transaction.
          const existing = emailNorm
            ? await tx.customer.findFirst({
                where: { OR: [{ emailNorm }, { email: raw.email }] },
              })
            : phoneNorm
              ? await tx.customer.findFirst({ where: { phoneNorm } })
              : null;
          if (existing) {
            lateDuplicate = true;
          } else {
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
            } catch (createError) {
              if (
                createError instanceof Prisma.PrismaClientKnownRequestError &&
                createError.code === "P2002"
              ) {
                lateDuplicate = true;
              } else {
                throw createError;
              }
            }
          }
        } else {
          const price = Number.parseInt(raw.basePriceCents || raw.price || "0", 10);
          const kind = (raw.kind || "PACKAGE").toUpperCase() as ProductKind;
          const slug = `${raw.sku}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          const existing = await tx.product.findFirst({
            where: { seasonId: season!.id, sku: raw.sku },
          });
          if (existing) {
            lateDuplicate = true;
          } else {
            try {
              await tx.product.create({
                data: {
                  seasonId: season!.id,
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
            } catch (createError) {
              if (
                createError instanceof Prisma.PrismaClientKnownRequestError &&
                createError.code === "P2002"
              ) {
                lateDuplicate = true;
              } else {
                throw createError;
              }
            }
          }
        }

        if (lateDuplicate) {
          skipped += 1;
          await tx.importRow.update({
            where: { id: row.id },
            data: {
              status: ImportRowStatus.SKIPPED,
              errors: ["duplicate at commit"],
            },
          });
          continue;
        }

        await tx.importRow.update({
          where: { id: row.id },
          data: { status: ImportRowStatus.COMMITTED },
        });
        committed += 1;
      }

      await tx.importBatch.update({
        where: { id: batch.id },
        data: {
          status: ImportBatchStatus.COMMITTED,
          committedById: input.staffId,
          committedAt: new Date(),
          summary: {
            ...(batch.summary as object),
            committed,
            skipped,
          },
        },
      });

      await writeAudit(
        {
          action: AuditAction.IMPORT_COMMITTED,
          actorId: input.staffId,
          meta: { batchId: batch.id, committed, skipped },
        },
        tx,
      );

      return { committed, skipped };
    });

    return ok(result);
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
