import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";
import { TRIGGERED_KEYS, TriggeredKey } from "@/lib/email/triggered";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  subjectOverride: z.string().max(500).nullable().optional(),
  bodyTemplateOverride: z.string().nullable().optional(),
  templateId: z.string().nullable().optional(),
});

// R-086/R-178: per-key override upsert. enabled=false suppresses the send at
// enqueue time; overrides replace the coded default copy; templateId points
// the key at a reusable template (resolution order in lib/email/triggered.ts).
export async function PATCH(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const gate = await requireApiPermission("email.manage");
  if (!gate.ok) return gate.response;

  const { key } = await params;
  if (!TRIGGERED_KEYS.includes(key as TriggeredKey)) {
    return NextResponse.json({ error: `Unknown triggered key ${key}` }, { status: 404 });
  }
  const parsed = await parseBody(request, patchSchema, "At least one override field is required");
  if (!parsed.ok) return parsed.response;

  if (parsed.data.templateId) {
    const template = await prisma.emailTemplate.findUnique({ where: { id: parsed.data.templateId } });
    if (!template) return NextResponse.json({ error: "EmailTemplate not found" }, { status: 404 });
  }

  // Prisma ignores undefined fields on update, so the parsed patch applies
  // directly — no per-field unwrapping.
  const override = await prisma.emailTriggeredOverride.upsert({
    where: { key },
    update: parsed.data,
    create: { key, ...parsed.data },
  });
  await recordAudit({
    ctx: gate.ctx,
    action: "email_hub_update",
    targetType: "EmailTriggeredOverride",
    targetId: key,
    metadata: { kind: "triggered_override", ...parsed.data },
  });
  return NextResponse.json({ ok: true, override });
}
