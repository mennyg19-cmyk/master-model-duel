import { z } from "zod";
import { db } from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { createNewsletterToken } from "@/lib/newsletter-token";

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

  // No email provider until the Email phase, so the preferences link is
  // returned to the subscriber directly instead of being emailed.
  const token = createNewsletterToken(email);
  return Response.json({ ok: true, manageUrl: `/newsletter/preferences?token=${token}` });
}
