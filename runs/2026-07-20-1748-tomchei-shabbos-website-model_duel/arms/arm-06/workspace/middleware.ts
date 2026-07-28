import { NextRequest, NextResponse } from "next/server";
import { decodeSession, SESSION_COOKIE } from "@/lib/session-codec";

// Presence + signature check only. Role/permission gates run in the admin
// layout and API handlers where a DB read is available.
export async function middleware(request: NextRequest) {
  const raw = request.cookies.get(SESSION_COOKIE)?.value;
  const secret = process.env.AUTH_SECRET;
  const session = raw && secret ? await decodeSession(raw, secret) : null;
  if (!session) {
    // Dev-login only exists while the bypass flag is on (and off a production
    // deploy); otherwise unauthenticated visitors land on the storefront,
    // matching requireStaff's redirect.
    const bypassOn = process.env.DEV_AUTH_BYPASS === "true" && process.env.VERCEL_ENV !== "production";
    const loginUrl = new URL(bypassOn ? "/dev-login" : "/", request.url);
    if (bypassOn) loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/driver/:path*"],
};
