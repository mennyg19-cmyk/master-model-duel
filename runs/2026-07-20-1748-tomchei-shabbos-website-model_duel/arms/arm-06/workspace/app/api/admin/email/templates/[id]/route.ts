import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  subject: z.string().min(1).max(500).optional(),
  bodyText: z.string().min(1).optional(),
});

// R-085: template edit. Keys are stable identifiers (triggered overrides
// reference them), so they never change after creation.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiPermission("customers.manage");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const parsed = await parseBody(request, patchSchema, "At least one field to update is required");
  if (!parsed.ok) return parsed.response;

  const existing = await prisma.emailTemplate.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "EmailTemplate not found" }, { status: 404 });

  const template = await prisma.emailTemplate.update({ where: { id }, data: parsed.data });
  await recordAudit({
    ctx: gate.ctx,
    action: "email_hub_update",
    targetType: "EmailTemplate",
    targetId: id,
    metadata: { kind: "template_edit", key: template.key },
  });
  return NextResponse.json({ ok: true, template });
}
