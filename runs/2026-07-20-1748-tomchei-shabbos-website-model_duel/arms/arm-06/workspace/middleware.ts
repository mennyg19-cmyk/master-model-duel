import { NextRequest, NextResponse } from "next/server";
import { decodeSession, SESSION_COOKIE } from "@/lib/session-codec";
import { isDevAuthBypassEnabled } from "@/lib/dev-auth";

// Presence + signature check only. Role/permission gates run in the admin
// layout and API handlers where a DB read is available.
export async function middleware(request: NextRequest) {
  const raw = request.cookies.get(SESSION_COOKIE)?.value;
  const secret = process.env.AUTH_SECRET;
  const session = raw && secret ? await decodeSession(raw, secret) : null;
  if (!session) {
    // Dev-login only exists while the bypass is on (same shared predicate
    // lib/env exposes — off any Vercel deploy, and only under APP_ENV=test);
    // otherwise unauthenticated visitors land on the storefront, matching
    // requireStaff's redirect.
    const bypassOn = isDevAuthBypassEnabled();
    const loginUrl = new URL(bypassOn ? "/dev-login" : "/", request.url);
    if (bypassOn) loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/driver/:path*"],
};
