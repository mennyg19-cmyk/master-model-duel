import { NextResponse } from "next/server";
import { isDevAuthBypass } from "@/lib/env";
import { fixtureIntentsStore } from "../store";

export const dynamic = "force-dynamic";

// Provider-shaped half of the Stripe dev double: serves exactly the wire
// shape listPaymentIntents reads (GET /v1/payment_intents → { data, has_more
// }). Anything else 404s — the double never fakes writes.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ tail: string[] }> },
): Promise<NextResponse> {
  if (!isDevAuthBypass) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { tail } = await params;
  const path = `/${tail.join("/")}`;
  if (path !== "/v1/payment_intents") {
    return NextResponse.json({ error: { message: `unknown fixture path ${path}` } }, { status: 404 });
  }

  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? "100") || 100));
  const startingAfter = url.searchParams.get("starting_after");
  const intents = fixtureIntentsStore();
  const startIndex = startingAfter ? intents.findIndex((intent) => intent.id === startingAfter) + 1 : 0;
  const page = intents.slice(Math.max(0, startIndex), Math.max(0, startIndex) + limit);
  return NextResponse.json({
    object: "list",
    data: page,
    has_more: Math.max(0, startIndex) + page.length < intents.length,
  });
}
