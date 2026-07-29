import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { parseBody } from "@/lib/parse-body";
import { upsertSubscriber } from "@/lib/newsletter/subscribers";
import { createUnsubscribeToken } from "@/lib/newsletter/tokens";
import { enqueueTriggeredEmail } from "@/lib/email/triggered";
import { newsletterRateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

export const dynamic = "force-dynamic";

const subscribeSchema = z.object({
  email: z.string().email(),
  name: z.string().max(200).optional(),
  source: z.enum(["footer", "homepage"]).optional(),
});

// R-009: newsletter subscribe. The response never carries a manage/unsubscribe
// token — this route is unauthenticated, so handing out the HMAC bearer token
// here would let anyone unsubscribe an arbitrary victim address. Tokens are
// minted only inside the subscription_manage transactional email (P11),
// addressed to the mailbox owner via the outbox. Rate-limited per client IP
// to blunt spam/upsert abuse.
export async function POST(request: Request) {
  if (!newsletterRateLimit(clientIp(request.headers) ?? "unknown")) {
    return NextResponse.json({ error: "Too many subscribe attempts — try again in a minute" }, { status: 429 });
  }

  const parsed = await parseBody(request, subscribeSchema, "A valid email address is required");
  if (!parsed.ok) return parsed.response;

  const { subscriber } = await upsertSubscriber({
    email: parsed.data.email,
    name: parsed.data.name || null,
  });

  // The manage link travels by email only (above); on a keyless host the
  // outbox captures it, so the flow is exercisable end-to-end either way.
  const manageToken = await createUnsubscribeToken(subscriber.id, env.AUTH_SECRET);
  const manageUrl = `${new URL(request.url).origin}/unsubscribe?token=${manageToken}`;
  await enqueueTriggeredEmail({
    key: "subscription_manage",
    recipient: subscriber.email,
    tokens: { customerName: subscriber.name ?? "there", manageUrl },
    metadata: { subscriberId: subscriber.id },
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
