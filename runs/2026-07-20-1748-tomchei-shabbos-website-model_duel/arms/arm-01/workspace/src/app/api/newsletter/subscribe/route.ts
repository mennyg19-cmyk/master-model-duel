import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/normalize";

export async function POST(request: Request) {
  const body = (await request.json()) as { email?: string };
  const email = body.email ? normalizeEmail(body.email) : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Enter a valid email address to join the newsletter." },
      { status: 400 },
    );
  }

  await db.newsletterSubscriber.upsert({
    where: { email },
    create: { email },
    update: {
      isSubscribed: true,
      unsubscribedAt: null,
    },
  });
  return NextResponse.json({
    message: "You’re on the list. Check your inbox for preference controls.",
  });
}
