import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";
import { applyPreferences } from "@/lib/newsletter/subscribers";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  unsubscribeAll: z.boolean(),
  prefs: z
    .object({
      prefNewProducts: z.boolean(),
      prefReminders: z.boolean(),
      prefCommunity: z.boolean(),
    })
    .optional(),
});

// R-084: staff-side preference/unsubscribe management — the same engine the
// signed-token flow uses, audited because staff touch it without the token.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiPermission("email.manage");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const parsed = await parseBody(request, patchSchema, "unsubscribeAll (and optionally prefs) is required");
  if (!parsed.ok) return parsed.response;

  const existing = await prisma.newsletterSubscriber.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "NewsletterSubscriber not found" }, { status: 404 });

  const updated = await applyPreferences(id, {
    unsubscribeAll: parsed.data.unsubscribeAll,
    prefs: parsed.data.prefs,
  });
  await recordAudit({
    ctx: gate.ctx,
    action: "email_hub_update",
    targetType: "NewsletterSubscriber",
    targetId: id,
    metadata: {
      kind: "subscriber_prefs",
      unsubscribed: updated.unsubscribedAt !== null,
      prefs: {
        prefNewProducts: updated.prefNewProducts,
        prefReminders: updated.prefReminders,
        prefCommunity: updated.prefCommunity,
      },
    },
  });
  return NextResponse.json({ ok: true, subscriber: updated });
}
