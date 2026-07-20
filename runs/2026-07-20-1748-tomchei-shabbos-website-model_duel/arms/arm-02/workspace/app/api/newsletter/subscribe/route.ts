import { z } from "zod";
import { db } from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const subscribeSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().max(120).optional(),
});

export async function POST(request: Request) {
  if (!rateLimit(`newsletter:${clientIp(request)}`, 5, 60_000)) {
    return Response.json({ error: "Too many attempts. Try again in a minute." }, { status: 429 });
  }

  const parsed = subscribeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase();
  await db.newsletterSubscriber.upsert({
    where: { email },
    update: { status: "SUBSCRIBED", unsubscribedAt: null, ...(parsed.data.name ? { name: parsed.data.name } : {}) },
    create: { email, name: parsed.data.name },
  });

  // The tokenized manage/unsubscribe link is only ever delivered by email
  // (Email phase). Returning it here would let anyone mint a management
  // token for an arbitrary address, so the response stays token-free.
  return Response.json({ ok: true });
}
