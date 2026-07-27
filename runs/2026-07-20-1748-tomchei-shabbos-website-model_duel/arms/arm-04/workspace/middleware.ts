import { NextResponse, type NextRequest } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";

// Dev mode: cookie-presence gate only (edge can't reach the DB).
// Full session validation + permission checks happen server-side in requirePermission*.
function devSessionGate(request: NextRequest) {
  const hasSessionCookie = request.cookies.has("tomchei_session");
  if (!hasSessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

const middleware =
  process.env.AUTH_MODE === "clerk" ? clerkMiddleware() : devSessionGate;

export default middleware;

export const config = {
  matcher: ["/admin/:path*", "/driver/:path*"],
};
