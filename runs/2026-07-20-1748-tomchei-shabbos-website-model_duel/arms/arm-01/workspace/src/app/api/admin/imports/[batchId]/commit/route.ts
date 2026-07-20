import { Prisma, ProductKind } from "@prisma/client";
import { NextResponse } from "next/server";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import type { StagedRow } from "@/lib/csv-import";
import { db } from "@/lib/db";
import { normalizeEmail, normalizePhone } from "@/lib/normalize";

class ImportConflictError extends Error {}

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
      const claimed = await transaction.importBatch.updateMany({
        where: { id: batch.id, status: "STAGED" },
        data: { status: "COMMITTING" },
      });
      if (claimed.count !== 1) {
        throw new ImportConflictError("This import batch is already being committed.");
      }
      if (batch.entityType === "customers") {
        const emails = rows
          .map((row) => normalizeEmail(row.email || ""))
          .filter(Boolean);
        const phones = rows
          .map((row) => normalizePhone(row.phone || ""))
          .filter((phone): phone is string => Boolean(phone));
        const duplicate = await transaction.customer.findFirst({
          where: {
            OR: [
              ...(emails.length ? [{ emailNormalized: { in: emails } }] : []),
              ...(phones.length ? [{ phoneNormalized: { in: phones } }] : []),
            ],
          },
          select: { id: true },
        });
        if (duplicate) {
          throw new ImportConflictError(
            "A matching customer was created after this preview. Stage the import again.",
          );
        }
        await transaction.customer.createMany({
          data: rows.map((row) => ({
            displayName: row.displayname,
            email: row.email || null,
            emailNormalized: row.email ? normalizeEmail(row.email) : null,
            phone: row.phone || null,
            phoneNormalized: row.phone ? normalizePhone(row.phone) : null,
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
        const duplicate = await transaction.product.findFirst({
          where: {
            seasonId,
            sku: { in: rows.map((row) => row.sku) },
          },
          select: { id: true },
        });
        if (duplicate) {
          throw new ImportConflictError(
            "A matching product was created after this preview. Stage the import again.",
          );
        }
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
        where: { id: batch.id, status: "COMMITTING" },
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
    if (
      error instanceof ImportConflictError ||
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002")
    ) {
      return NextResponse.json(
        {
          error:
            error instanceof ImportConflictError
              ? error.message
              : "A matching record was created concurrently. Stage the import again.",
        },
        { status: 409 },
      );
    }
    throw error;
  }
}
