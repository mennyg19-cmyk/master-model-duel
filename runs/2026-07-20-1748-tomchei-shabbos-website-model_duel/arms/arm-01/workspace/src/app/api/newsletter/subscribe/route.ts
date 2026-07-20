import { NextResponse } from "next/server";
import { enqueueTransactionalEmail } from "@/domain/messaging";
import { db } from "@/lib/db";
import { createNewsletterToken } from "@/lib/newsletter";
import { normalizeEmail } from "@/lib/normalize";
import {
  guardPublicRateLimit,
  publicRequestErrorResponse,
} from "@/lib/public-request";

export async function POST(request: Request) {
  try {
    await guardPublicRateLimit(request, "newsletter-subscribe", {
      limit: 10,
      rateLimitMessage: "Too many subscription attempts. Try again in a minute.",
    });
    const body = (await request.json()) as { email?: string };
    const email = body.email ? normalizeEmail(body.email) : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "Enter a valid email address to join the newsletter." },
        { status: 400 },
      );
    }

    const subscriber = await db.newsletterSubscriber.upsert({
      where: { email },
      create: { email },
      update: {
        isSubscribed: true,
        unsubscribedAt: null,
      },
    });
    const token = createNewsletterToken(subscriber.id);
    await enqueueTransactionalEmail(db, {
      idempotencyKey: `newsletter-preferences:${subscriber.id}:${subscriber.updatedAt.getTime()}`,
      templateKey: "newsletter.preferences",
      recipient: subscriber.email,
      variables: {
        preferenceUrl: `${process.env.APP_URL ?? "http://127.0.0.1:3101"}/newsletter/preferences?token=${encodeURIComponent(token)}`,
      },
    });
    return NextResponse.json({
      message: "You’re on the list. Check your inbox for preference controls.",
      ...(process.env.EMAIL_TEST_MODE === "true"
        ? { preferenceToken: token }
        : {}),
    });
  } catch (error) {
    return publicRequestErrorResponse(error);
  }
}
