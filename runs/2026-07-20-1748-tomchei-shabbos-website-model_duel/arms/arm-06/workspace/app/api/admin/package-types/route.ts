import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  lengthMm: z.coerce.number().int().positive(),
  widthMm: z.coerce.number().int().positive(),
  heightMm: z.coerce.number().int().positive(),
  maxWeightGrams: z.coerce.number().int().positive().nullable().optional(),
});

// R-094 (Orders tab): package types used by shipment planning (P8).
export async function POST(request: Request) {
  const gate = await requireApiPermission("settings.manage");
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(request, createSchema, "Name and box dimensions are required");
  if (!parsed.ok) return parsed.response;

  const name = parsed.data.name.trim();
  const existing = await prisma.packageType.findUnique({ where: { name } });
  if (existing) {
    return NextResponse.json({ error: "A package type with that name already exists" }, { status: 409 });
  }

  const packageType = await prisma.packageType.create({
    data: {
      name,
      lengthMm: parsed.data.lengthMm,
      widthMm: parsed.data.widthMm,
      heightMm: parsed.data.heightMm,
      maxWeightGrams: parsed.data.maxWeightGrams ?? null,
    },
  });
  await recordAudit({
    ctx: gate.ctx,
    action: "settings_update",
    targetType: "PackageType",
    targetId: packageType.id,
    metadata: { name: packageType.name },
  });

  return NextResponse.json({ packageType }, { status: 201 });
}
