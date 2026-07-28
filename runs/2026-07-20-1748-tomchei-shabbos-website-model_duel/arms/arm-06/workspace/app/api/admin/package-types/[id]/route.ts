import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

const patchSchema = z.object({
  active: z.boolean(),
});

export async function PATCH(request: Request, { params }: Props) {
  const gate = await requireApiPermission("settings.manage");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const parsed = await parseBody(request, patchSchema, "active is required");
  if (!parsed.ok) return parsed.response;

  const existing = await prisma.packageType.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Package type not found" }, { status: 404 });
  }

  const packageType = await prisma.packageType.update({
    where: { id },
    data: { active: parsed.data.active },
  });
  await recordAudit({
    ctx: gate.ctx,
    action: "settings_update",
    targetType: "PackageType",
    targetId: id,
    metadata: { active: packageType.active },
  });

  return NextResponse.json({ packageType });
}
