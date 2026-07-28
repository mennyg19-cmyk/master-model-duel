import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";
import { dollarsToCents } from "@/lib/money";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  priceDollars: z.coerce.number().nonnegative().optional(),
  active: z.boolean().optional(),
});

// R-066: add-on edit (rename, reprice, activate/deactivate).
export async function PATCH(request: Request, { params }: Props) {
  const gate = await requireApiPermission("catalog.manage");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const parsed = await parseBody(request, patchSchema, "Nothing to update");
  if (!parsed.ok) return parsed.response;

  const existing = await prisma.addOn.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Add-on not found" }, { status: 404 });
  }

  const updateFields: { name?: string; priceCents?: number; active?: boolean } = {};
  if (parsed.data.name !== undefined) updateFields.name = parsed.data.name.trim();
  if (parsed.data.active !== undefined) updateFields.active = parsed.data.active;
  if (parsed.data.priceDollars !== undefined) {
    const priceCents = dollarsToCents(parsed.data.priceDollars);
    if (priceCents === null) {
      return NextResponse.json({ error: "Price must be a clean dollar-and-cents amount" }, { status: 400 });
    }
    updateFields.priceCents = priceCents;
  }

  const addOn = await prisma.addOn.update({ where: { id }, data: updateFields });
  await recordAudit({
    ctx: gate.ctx,
    action: "addon_update",
    targetType: "AddOn",
    targetId: addOn.id,
    metadata: { slug: addOn.slug, changes: Object.keys(updateFields) },
  });

  return NextResponse.json({ addOn });
}
