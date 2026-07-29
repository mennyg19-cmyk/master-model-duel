import { NextResponse } from "next/server";
import { z } from "zod";
import { isDevAuthBypass } from "@/lib/env";
import { parseBody } from "@/lib/parse-body";
import { fixtureIntentsStore } from "./store";

export const dynamic = "force-dynamic";

// Dev/test Stripe double (same honesty class as the email/shippo doubles):
// 404 unless DEV_AUTH_BYPASS=true. Point STRIPE_BASE_URL here and the P12
// reconciliation matcher runs its real HTTP list call end-to-end without a
// live account. This root route is the instrumentation surface: smoke
// injects the Stripe-side truth (including orphaned intents the local
// database never saw); the [...tail] sibling serves the provider-shaped
// list call.

const injectSchema = z.object({
  intents: z
    .array(
      z.object({
        id: z.string().min(1),
        amount: z.number().int().nonnegative(),
        currency: z.string().min(3).max(3).default("usd"),
        status: z.string().min(1),
        metadata: z.record(z.string(), z.string()).default({}),
      }),
    )
    .min(1)
    .max(500),
});

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDevAuthBypass) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const url = new URL(request.url);
  const intents = fixtureIntentsStore();
  if (url.searchParams.get("reset") === "1") {
    intents.length = 0;
    return NextResponse.json({ ok: true, count: 0, intents: [] });
  }
  return NextResponse.json({ ok: true, count: intents.length, intents });
}

// Inject the Stripe-side truth. Existing ids are replaced (idempotent
// re-injection); everything else appends.
export async function POST(request: Request): Promise<NextResponse> {
  if (!isDevAuthBypass) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const parsed = await parseBody(request, injectSchema, "intents are required");
  if (!parsed.ok) return parsed.response;

  const intents = fixtureIntentsStore();
  for (const intent of parsed.data.intents) {
    const existing = intents.findIndex((row) => row.id === intent.id);
    if (existing >= 0) intents[existing] = intent;
    else intents.push(intent);
  }
  return NextResponse.json({ ok: true, count: intents.length });
}
