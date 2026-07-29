import { NextResponse } from "next/server";
import {
  fixtureCreateRefund,
  fixtureCreateShipment,
  fixtureCreateTransaction,
  fixtureGetRefund,
  fixtureGetTrack,
  fixtureStats,
  fixtureValidateAddress,
} from "@/lib/shipping/fixture-double";
import { isDevAuthBypass } from "@/lib/env";

// Dev/test-only Shippo double (same honesty class as /api/dev/stripe-fixture):
// 404 unless DEV_AUTH_BYPASS=true. Point SHIPPO_BASE_URL at this route and the
// whole shipping stack runs end-to-end against deterministic carrier data.

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDevAuthBypass) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const url = new URL(request.url);
  const rawTail = url.pathname.split("/api/dev/shippo-fixture")[1] ?? "/";
  const tail = rawTail.replace(/\/+$/, "") || "/";
  const body = (await request.json().catch(() => ({}))) as Record<string, never>;

  if (tail === "/shipments") {
    const result = fixtureCreateShipment(body as never);
    return NextResponse.json(result.payload, { status: result.status });
  }
  if (tail === "/transactions") {
    const result = fixtureCreateTransaction(body as never);
    return NextResponse.json(result.payload, { status: result.status });
  }
  if (tail === "/refunds") {
    const result = fixtureCreateRefund(body as never);
    return NextResponse.json(result.payload, { status: result.status });
  }
  if (tail === "/addresses") {
    const result = fixtureValidateAddress(body as never);
    return NextResponse.json(result.payload, { status: result.status });
  }
  return NextResponse.json({ detail: `unknown fixture path ${tail}` }, { status: 404 });
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDevAuthBypass) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const url = new URL(request.url);
  const trackMatch = /\/tracks\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (trackMatch) {
    const result = fixtureGetTrack(decodeURIComponent(trackMatch[1]), decodeURIComponent(trackMatch[2]));
    return NextResponse.json(result.payload, { status: result.status });
  }
  const refundMatch = /\/refunds\/([^/]+)$/.exec(url.pathname);
  if (refundMatch) {
    const result = fixtureGetRefund(decodeURIComponent(refundMatch[1]));
    return NextResponse.json(result.payload, { status: result.status });
  }
  // Test instrumentation: how many shipment-creates this server process has
  // served, and the last destination — pins the display-quote cache and the
  // line2 passthrough end-to-end.
  if (url.pathname.endsWith("/stats")) {
    return NextResponse.json(fixtureStats);
  }
  return NextResponse.json({ detail: "unknown fixture path" }, { status: 404 });
}
