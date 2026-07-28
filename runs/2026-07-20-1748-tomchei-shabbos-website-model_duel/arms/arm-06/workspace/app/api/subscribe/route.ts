import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody } from "@/lib/parse-body";
import { upsertSubscriber } from "@/lib/newsletter/subscribers";
import { newsletterRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const subscribeSchema = z.object({
  email: z.string().email(),
  name: z.string().max(200).optional(),
  source: z.enum(["footer", "homepage"]).optional(),
});

// R-009: newsletter subscribe. The response never carries a manage/unsubscribe
// token — this route is unauthenticated, so handing out the HMAC bearer token
// here would let anyone unsubscribe an arbitrary victim address. Tokens are
// minted only inside transactional emails (P11), addressed to the mailbox
// owner. Rate-limited per client IP to blunt spam/upsert abuse.
export async function POST(request: Request) {
  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0].trim().slice(0, 45) ?? "unknown";
  if (!newsletterRateLimit(clientIp)) {
    return NextResponse.json({ error: "Too many subscribe attempts — try again in a minute" }, { status: 429 });
  }

  const parsed = await parseBody(request, subscribeSchema, "A valid email address is required");
  if (!parsed.ok) return parsed.response;

  await upsertSubscriber({
    email: parsed.data.email,
    name: parsed.data.name || null,
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
