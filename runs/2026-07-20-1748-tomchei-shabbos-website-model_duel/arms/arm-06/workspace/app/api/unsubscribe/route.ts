import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { parseBody } from "@/lib/parse-body";
import { applyPreferences } from "@/lib/newsletter/subscribers";
import { verifyUnsubscribeToken } from "@/lib/newsletter/tokens";

export const dynamic = "force-dynamic";

const unsubscribeSchema = z.object({
  token: z.string().min(1),
  unsubscribeAll: z.boolean(),
  prefs: z
    .object({
      prefNewProducts: z.boolean(),
      prefReminders: z.boolean(),
      prefCommunity: z.boolean(),
    })
    .optional(),
});

// R-018/R-123: preference changes and unsubscribe-all only ever happen behind
// a valid HMAC token — tampered or expired tokens are rejected before any
// database write.
export async function POST(request: Request) {
  const parsed = await parseBody(request, unsubscribeSchema, "token and unsubscribeAll are required");
  if (!parsed.ok) return parsed.response;

  const verified = await verifyUnsubscribeToken(parsed.data.token, env.AUTH_SECRET);
  if (!verified) {
    return NextResponse.json({ error: "That link is invalid or has expired" }, { status: 401 });
  }

  const subscriber = await prisma.newsletterSubscriber.findUnique({
    where: { id: verified.subscriberId },
  });
  if (!subscriber) {
    return NextResponse.json({ error: "That subscription no longer exists" }, { status: 404 });
  }

  const updated = await applyPreferences(subscriber.id, {
    unsubscribeAll: parsed.data.unsubscribeAll,
    prefs: parsed.data.prefs,
  });

  return NextResponse.json({
    ok: true,
    unsubscribed: updated.unsubscribedAt !== null,
    prefs: {
      prefNewProducts: updated.prefNewProducts,
      prefReminders: updated.prefReminders,
      prefCommunity: updated.prefCommunity,
    },
  });
}
