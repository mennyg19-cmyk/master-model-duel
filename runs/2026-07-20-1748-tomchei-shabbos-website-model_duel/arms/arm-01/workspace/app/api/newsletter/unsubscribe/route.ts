import { z } from "zod";
import { db } from "@/lib/db";
import { verifyNewsletterToken } from "@/lib/newsletter-token";

const unsubscribeSchema = z.object({ token: z.string().min(1) });

export async function POST(request: Request) {
  const parsed = unsubscribeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Missing unsubscribe token." }, { status: 400 });
  }

  const email = verifyNewsletterToken(parsed.data.token);
  if (!email) {
    return Response.json({ error: "This link is invalid or has expired." }, { status: 403 });
  }

  await db.newsletterSubscriber
    .update({
      where: { email },
      data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date() },
    })
    .catch(() => null); // Unknown address: still report success — unsubscribing is idempotent.

  return Response.json({ ok: true });
}
