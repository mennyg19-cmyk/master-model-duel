import { ProductKind, type Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import type { StagedRow } from "@/lib/csv-import";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/normalize";

function normalizedPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits ? (digits.length === 10 ? `+1${digits}` : `+${digits}`) : null;
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  try {
    const session = await requirePermission("settings:manage");
    const { batchId } = await context.params;
    const batch = await db.importBatch.findUnique({ where: { id: batchId } });
    if (!batch || batch.status !== "STAGED") {
      return NextResponse.json({ error: "A staged import batch is required." }, { status: 404 });
    }
    if (batch.invalidRowCount || batch.duplicateCount) {
      return NextResponse.json(
        { error: "Correct every invalid and duplicate row, then stage a new preview." },
        { status: 409 },
      );
    }
    const rows = batch.rows as unknown as StagedRow[];
    const importedCount = await db.$transaction(async (transaction) => {
      if (batch.entityType === "customers") {
        await transaction.customer.createMany({
          data: rows.map((row) => ({
            displayName: row.displayname,
            email: row.email || null,
            emailNormalized: row.email ? normalizeEmail(row.email) : null,
            phone: row.phone || null,
            phoneNormalized: row.phone ? normalizedPhone(row.phone) : null,
          })),
        });
      } else {
        const currentSeasonSetting = await transaction.appSetting.findUnique({
          where: { key: "current-season-id" },
        });
        const seasonId =
          typeof currentSeasonSetting?.value === "string"
            ? currentSeasonSetting.value
            : null;
        if (!seasonId) throw new Error("Current season is required for product imports.");
        await transaction.product.createMany({
          data: rows.map((row) => ({
            seasonId,
            sku: row.sku,
            name: row.name,
            description: row.description || null,
            category: row.category || "Gifts",
            kind: ProductKind.PACKAGE,
            priceCents: Number(row.pricecents),
            isFinishedPackage: true,
          })),
        });
      }
      await transaction.importBatch.update({
        where: { id: batch.id },
        data: {
          status: "COMMITTED",
          committedByStaffId: session.actor.id,
          committedAt: new Date(),
        },
      });
      await transaction.auditLog.create({
        data: {
          actorStaffId: session.actor.id,
          action: "import.committed",
          targetType: "ImportBatch",
          targetId: batch.id,
          metadata: {
            entityType: batch.entityType,
            importedCount: rows.length,
          } satisfies Prisma.InputJsonValue,
        },
      });
      return rows.length;
    });
    return NextResponse.json({ importedCount });
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
