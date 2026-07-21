import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { TEMPLATE_DEFAULTS, TEMPLATE_KEYS, isTemplateKey, resolveTemplate } from "@/lib/email/templates";

/** Every triggered key with its default, current override, and enabled flag. */
export async function GET() {
  const gate = await requirePermissionApi("email.manage");
  if ("response" in gate) return gate.response;

  const templates = await Promise.all(
    TEMPLATE_KEYS.map(async (key) => {
      const resolved = await resolveTemplate(key);
      const override = await db.emailTemplate.findUnique({ where: { key } });
      return {
        key,
        label: TEMPLATE_DEFAULTS[key].label,
        placeholders: TEMPLATE_DEFAULTS[key].placeholders,
        default: { subject: TEMPLATE_DEFAULTS[key].subject, body: TEMPLATE_DEFAULTS[key].body },
        subject: resolved.subject,
        body: resolved.body,
        isEnabled: resolved.isEnabled,
        hasOverride: Boolean(override?.subject || override?.body),
      };
    })
  );
  return Response.json({ templates });
}

const patchSchema = z.object({
  key: z.string(),
  // null clears the override back to the code default.
  subject: z.string().max(300).nullable().optional(),
  body: z.string().max(50_000).nullable().optional(),
  isEnabled: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  const gate = await requirePermissionApi("email.manage");
  if ("response" in gate) return gate.response;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isTemplateKey(parsed.data.key)) {
    return Response.json({ error: "Unknown template key" }, { status: 400 });
  }
  const { key, ...changes } = parsed.data;
  await db.emailTemplate.upsert({
    where: { key },
    update: changes,
    create: { key, ...changes, isEnabled: changes.isEnabled ?? true },
  });
  await writeAudit(gate.staff, { action: "email.template.update", targetType: "EmailTemplate", targetId: key });
  return Response.json({ ok: true });
}
