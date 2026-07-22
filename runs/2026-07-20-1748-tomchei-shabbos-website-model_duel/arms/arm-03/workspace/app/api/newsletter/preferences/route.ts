import { z } from "zod";
import { db } from "@/lib/db";
import { verifyNewsletterToken } from "@/lib/newsletter-token";

const updateSchema = z.object({
  token: z.string().min(1),
  wantsSeasonOpening: z.boolean(),
  wantsPurimReminders: z.boolean(),
});

export async function PATCH(request: Request) {
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid preferences payload." }, { status: 400 });
  }

  const email = verifyNewsletterToken(parsed.data.token);
  if (!email) {
    return Response.json({ error: "This link is invalid or has expired." }, { status: 403 });
  }

  const subscriber = await db.newsletterSubscriber.update({
    where: { email },
    data: {
      wantsSeasonOpening: parsed.data.wantsSeasonOpening,
      wantsPurimReminders: parsed.data.wantsPurimReminders,
    },
  }).catch(() => null);
  if (!subscriber) {
    return Response.json({ error: "No subscription found for this address." }, { status: 404 });
  }

  return Response.json({ ok: true });
}
