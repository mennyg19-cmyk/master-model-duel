import { z } from "zod";
import { db } from "@/lib/db";
import { verifyNewsletterToken } from "@/lib/newsletter-token";
import { isRecordNotFound } from "@/lib/prisma-errors";

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

  try {
    await db.newsletterSubscriber.update({
      where: { email },
      data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date() },
    });
  } catch (error) {
    // Unknown address: still report success — unsubscribing is idempotent (CAN-SPAM).
    // Any other DB failure must surface — never claim ok when the row is unchanged (A-08).
    if (!isRecordNotFound(error)) throw error;
  }

  return Response.json({ ok: true });
}
