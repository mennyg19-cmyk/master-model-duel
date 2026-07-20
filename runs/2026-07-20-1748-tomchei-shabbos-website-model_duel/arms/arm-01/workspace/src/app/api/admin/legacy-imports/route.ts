import { z } from "zod";
import { stageLegacyImport } from "@/domain/legacy-import";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

const addressSchema = z.object({
  id: z.string().min(1).max(120),
  recipientName: z.string().max(200),
  line1: z.string().max(250),
  line2: z.string().max(250).optional(),
  city: z.string().max(120),
  region: z.string().max(80),
  postalCode: z.string().max(30),
  greeting: z.string().max(2_000).optional(),
});
const documentSchema = z.object({
  customers: z.array(
    z.object({
      id: z.string().max(120),
      displayName: z.string().max(200),
      email: z.string().max(320).optional(),
      phone: z.string().max(80).optional(),
      addresses: z.array(addressSchema).max(25_000).optional(),
    }),
  ).max(25_000),
  products: z.array(
    z.object({
      id: z.string().max(120),
      seasonYear: z.number().int().min(1900).max(2200),
      sku: z.string().max(120),
      name: z.string().max(250),
      priceCents: z.number().int(),
    }),
  ).max(25_000),
  orders: z.array(
    z.object({
      id: z.string().min(1).max(120),
      seasonYear: z.number().int().min(1900).max(2200),
      customerId: z.string().min(1).max(120),
      orderNumber: z.number().int().positive().optional(),
      totalCents: z.number().int().nonnegative(),
      donationCents: z.number().int().nonnegative().optional(),
      lines: z.array(
        z.object({
          productId: z.string().min(1).max(120),
          quantity: z.number().int().positive().max(1_000),
          addressId: z.string().max(120).optional(),
          greeting: z.string().max(2_000).optional(),
        }),
      ).min(1).max(1_000),
    }),
  ).max(25_000),
});
const requestSchema = z.object({
  sourceName: z.string().trim().min(1).max(200),
  dryRun: z.boolean().default(true),
  document: documentSchema,
});

export async function POST(request: Request) {
  try {
    const session = await requirePermission("settings:manage");
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: "Legacy document does not match the documented entity map." },
        { status: 400 },
      );
    }
    const batch = await stageLegacyImport(db, {
      ...parsed.data,
      stagedByStaffId: session.actor.id,
    });
    await db.auditLog.create({
      data: {
        actorStaffId: session.actor.id,
        action: "legacy_import.staged",
        targetType: "LegacyImportBatch",
        targetId: batch.id,
        metadata: { dryRun: batch.dryRun, sourceName: batch.sourceName },
      },
    });
    return Response.json(batch, { status: 201 });
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
