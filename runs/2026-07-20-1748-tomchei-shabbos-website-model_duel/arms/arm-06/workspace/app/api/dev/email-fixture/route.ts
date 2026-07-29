import { NextResponse } from "next/server";
import { isDevAuthBypass } from "@/lib/env";
import { fixtureSendsStore } from "./store";

// Dev/test Resend double (same honesty class as /api/dev/shippo-fixture):
// 404 unless DEV_AUTH_BYPASS=true. Point RESEND_BASE_URL here and the whole
// email stack runs the real HTTP wrapper end-to-end without a live account.
// The provider-shaped calls land on the [...tail] sibling; this root route is
// the instrumentation surface. Sent payloads are recorded in-process so smoke
// can assert exact contact counts (the no-duplicates law) and that capture
// mode never contacts a provider.

// Test instrumentation: how many sends this server process recorded, with
// enough detail to assert per-recipient contact counts. ?reset=1 clears.
export async function GET(request: Request): Promise<NextResponse> {
  if (!isDevAuthBypass) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const url = new URL(request.url);
  const sends = fixtureSendsStore();
  if (url.searchParams.get("reset") === "1") {
    sends.length = 0;
    return NextResponse.json({ ok: true, count: 0, sends: [] });
  }
  return NextResponse.json({ ok: true, count: sends.length, sends });
}

export async function POST(): Promise<NextResponse> {
  if (!isDevAuthBypass) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ message: "unknown fixture path /" }, { status: 404 });
}
