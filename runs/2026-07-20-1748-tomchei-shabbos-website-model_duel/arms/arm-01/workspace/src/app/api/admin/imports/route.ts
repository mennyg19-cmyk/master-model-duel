import { NextResponse } from "next/server";
import { z } from "zod";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { type ImportEntity, stageCsv } from "@/lib/csv-import";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/normalize";

const stageSchema = z.object({
  entityType: z.enum(["customers", "products"]),
  sourceName: z.string().trim().min(1).max(120),
  csv: z.string().min(1).max(2_000_000),
});

function normalizedPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits ? (digits.length === 10 ? `+1${digits}` : `+${digits}`) : "";
}

async function findDatabaseDuplicateRows(
  entityType: ImportEntity,
  rows: ReturnType<typeof stageCsv>["rows"],
) {
  if (entityType === "customers") {
    const emails = rows.map((row) => normalizeEmail(row.email || "")).filter(Boolean);
    const phones = rows.map((row) => normalizedPhone(row.phone || "")).filter(Boolean);
    const existing = await db.customer.findMany({
      where: {
        OR: [
          ...(emails.length ? [{ emailNormalized: { in: emails } }] : []),
          ...(phones.length ? [{ phoneNormalized: { in: phones } }] : []),
        ],
      },
      select: { emailNormalized: true, phoneNormalized: true },
      take: 2000,
    });
    const existingKeys = new Set(
      existing.flatMap((customer) =>
        [customer.emailNormalized, customer.phoneNormalized].filter(
          (key): key is string => Boolean(key),
        ),
      ),
    );
    return rows.filter((row) =>
      existingKeys.has(normalizeEmail(row.email || "")) ||
      existingKeys.has(normalizedPhone(row.phone || "")),
    );
  }
  const currentSeasonSetting = await db.appSetting.findUnique({ where: { key: "current-season-id" } });
  const seasonId = typeof currentSeasonSetting?.value === "string" ? currentSeasonSetting.value : "";
  const existing = await db.product.findMany({
    where: { seasonId, sku: { in: rows.map((row) => row.sku) } },
    select: { sku: true },
    take: 2000,
  });
  const existingSkus = new Set(existing.map((product) => product.sku.toUpperCase()));
  return rows.filter((row) => existingSkus.has(row.sku.toUpperCase()));
}

export async function POST(request: Request) {
  try {
    const session = await requirePermission("settings:manage");
    const parsed = stageSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Entity, source name, and CSV are required." }, { status: 400 });
    }
    let staged;
    try {
      staged = stageCsv(parsed.data.entityType, parsed.data.csv);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "CSV could not be parsed." },
        { status: 400 },
      );
    }
    if (staged.rows.length > 2000) {
      return NextResponse.json({ error: "Imports are capped at 2,000 rows per batch." }, { status: 400 });
    }
    const databaseDuplicates = await findDatabaseDuplicateRows(parsed.data.entityType, staged.rows);
    const duplicateIssues = databaseDuplicates.map((row) => ({
      rowNumber: Number(row.rowNumber),
      code: "DUPLICATE" as const,
      message: "A matching record already exists.",
    }));
    const issues = [...staged.issues, ...duplicateIssues].sort(
      (left, right) => left.rowNumber - right.rowNumber,
    );
    const batch = await db.importBatch.create({
      data: {
        entityType: parsed.data.entityType,
        sourceName: parsed.data.sourceName,
        rows: staged.rows,
        errors: issues,
        validRowCount: staged.rows.length - new Set(issues.map((issue) => issue.rowNumber)).size,
        invalidRowCount: issues.filter((issue) => issue.code === "INVALID").length,
        duplicateCount: issues.filter((issue) => issue.code === "DUPLICATE").length,
        stagedByStaffId: session.actor.id,
      },
    });
    await db.auditLog.create({
      data: {
        actorStaffId: session.actor.id,
        action: "import.staged",
        targetType: "ImportBatch",
        targetId: batch.id,
        metadata: {
          entityType: batch.entityType,
          rows: staged.rows.length,
          issues: issues.length,
        },
      },
    });
    return NextResponse.json({ batch }, { status: 201 });
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
