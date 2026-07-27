import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deliverSubscriptionConfirmation,
  getNewsletterSubscription,
  subscribe,
  unsubscribe,
  updateNewsletterPreferences,
} from "@/lib/newsletter";
import { hasSameOrigin } from "@/lib/route-auth";

const subscribeSchema = z.object({
  email: z.string().email().max(254),
});

const unsubscribeSchema = z.object({
  token: z.string().min(20).max(1000),
});

const preferencesSchema = z.object({
  token: z.string().min(20).max(1000),
  preferences: z.object({
    marketing: z.boolean(),
    updates: z.boolean(),
    reminders: z.boolean(),
  }),
});

const subscribeAttempts = new Map<string, { count: number; startedAt: number }>();
const subscribeWindowMs = 60_000;
const maximumSubscribeAttempts = 5;

function isRateLimited(request: Request) {
  const clientAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")
    ?? "unknown";
  const now = Date.now();
  const attempt = subscribeAttempts.get(clientAddress);
  if (!attempt || now - attempt.startedAt >= subscribeWindowMs) {
    subscribeAttempts.set(clientAddress, { count: 1, startedAt: now });
    return false;
  }
  attempt.count += 1;
  return attempt.count > maximumSubscribeAttempts;
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  if (isRateLimited(request)) return NextResponse.json({ error: "Please wait before subscribing again." }, { status: 429 });
  const parsed = subscribeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  const { confirmationToken } = await subscribe(parsed.data.email);
  try {
    await deliverSubscriptionConfirmation(parsed.data.email, confirmationToken, new URL(request.url).origin);
  } catch (error) {
    console.error("Newsletter confirmation delivery failed.", error);
    return NextResponse.json({ error: "We could not send a confirmation email. Please try again later." }, { status: 503 });
  }
  return NextResponse.json({ message: "Check your email to confirm your subscription." }, { status: 202 });
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "A valid email preferences link is required." }, { status: 400 });
  const subscription = await getNewsletterSubscription(token);
  if (!subscription) return NextResponse.json({ error: "This email preferences link is invalid or expired." }, { status: 400 });
  return NextResponse.json(subscription);
}

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = preferencesSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !(await updateNewsletterPreferences(parsed.data.token, parsed.data.preferences))) {
    return NextResponse.json({ error: "This email preferences link is invalid or expired." }, { status: 400 });
  }
  return NextResponse.json({ message: "Your email preferences have been saved." });
}

export async function DELETE(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = unsubscribeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !(await unsubscribe(parsed.data.token))) {
    return NextResponse.json({ error: "This unsubscribe link is invalid or expired." }, { status: 400 });
  }
  return NextResponse.json({ message: "You have been unsubscribed." });
}
