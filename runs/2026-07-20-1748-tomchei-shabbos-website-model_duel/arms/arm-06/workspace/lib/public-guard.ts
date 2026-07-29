import { NextResponse } from "next/server";
import { clientIp } from "@/lib/client-ip";
import { checkoutRateLimit } from "@/lib/rate-limit";

// R-122 shared guard for public mutation endpoints: a cross-site POST can
// send no Origin (curl) or a matching one (same-site form/fetch); anything
// else is refused. Browsers always send Origin on cross-origin fetches, so
// this kills CSRF-style replays of the checkout endpoints without touching
// legitimate same-origin and non-browser callers.
export function assertSameOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return NextResponse.json({ error: "Bad Origin header" }, { status: 403 });
  }
  if (originHost !== request.headers.get("host")) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  }
  return null;
}

// R-122 public-checkout preamble: same-origin first, then the 20/min per-IP
// checkout limiter. One guard order and one 429 message for both checkout
// routes; null means the request may proceed.
export function guardPublicCheckoutMutation(request: Request): NextResponse | null {
  const originBlock = assertSameOrigin(request);
  if (originBlock) return originBlock;
  if (!checkoutRateLimit(clientIp(request.headers) ?? "unknown")) {
    return NextResponse.json({ error: "Too many checkout attempts — try again in a minute" }, { status: 429 });
  }
  return null;
}
