import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  key: z.string().min(1).max(100).regex(/^[a-z0-9_]+$/, "keys are lowercase snake_case"),
  name: z.string().min(1).max(200),
  subject: z.string().min(1).max(500),
  bodyText: z.string().min(1),
});

// R-085: reusable email templates with {{token}} placeholders (renderer in
// lib/email/render.ts; branding tokens come from the email.branding setting).
export async function GET() {
  const gate = await requireApiPermission("customers.manage");
  if (!gate.ok) return gate.response;

  const templates = await prisma.emailTemplate.findMany({ orderBy: { key: "asc" } });
  return NextResponse.json({ ok: true, templates });
}

export async function POST(request: Request) {
  const gate = await requireApiPermission("customers.manage");
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(request, createSchema, "key, name, subject, and bodyText are required");
  if (!parsed.ok) return parsed.response;

  const existing = await prisma.emailTemplate.findUnique({ where: { key: parsed.data.key } });
  if (existing) return NextResponse.json({ error: `A template with key ${parsed.data.key} already exists` }, { status: 409 });

  const template = await prisma.emailTemplate.create({ data: parsed.data });
  await recordAudit({
    ctx: gate.ctx,
    action: "email_hub_update",
    targetType: "EmailTemplate",
    targetId: template.id,
    metadata: { kind: "template_create", key: template.key },
  });
  return NextResponse.json({ ok: true, template }, { status: 201 });
}
