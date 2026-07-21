import { NextResponse } from "next/server";
import { processStripeWebhook } from "@/lib/payments/webhook";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  const result = await processStripeWebhook({ rawBody, signature });
  if (!result.ok) {
    const status = result.error === "sig" ? 400 : 500;
    return NextResponse.json({ ok: false, error: result.publicMessage }, { status });
  }
  return NextResponse.json({
    ok: true,
    type: result.value.type,
    replay: result.value.replay,
  });
}
