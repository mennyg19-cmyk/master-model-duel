import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublic = createRouteMatcher([
  "/",
  "/about",
  "/catalog(.*)",
  "/archive(.*)",
  "/newsletter(.*)",
  "/order(.*)",
  "/checkout(.*)",
  "/account",
  "/uploads(.*)",
  "/api/health",
  "/api/client-error",
  "/api/dev(.*)",
  "/api/newsletter(.*)",
  "/api/storefront(.*)",
  "/api/checkout(.*)",
  "/api/webhooks(.*)",
  "/api/drafts(.*)",
  "/api/driver(.*)",
  "/d(.*)",
  "/admin/setup",
  "/sign-in(.*)",
  "/sign-up(.*)",
]);

const isOrderRoute = createRouteMatcher(["/order", "/order/(.*)"]);

async function enforceOrderSeasonGate(request: NextRequest): Promise<NextResponse | null> {
  if (!isOrderRoute(request)) return null;
  try {
    const statusUrl = new URL("/api/storefront/status", request.nextUrl.origin);
    const statusRes = await fetch(statusUrl, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!statusRes.ok) return null;
    const status = (await statusRes.json()) as { storeOpen?: boolean };
    if (status.storeOpen) return null;
    // Route-wide closure: any /order/* rewrites to the gate page (B4).
    if (request.nextUrl.pathname !== "/order") {
      const rewriteUrl = request.nextUrl.clone();
      rewriteUrl.pathname = "/order";
      return NextResponse.rewrite(rewriteUrl);
    }
    return null;
  } catch {
    // Fail closed on order routes if status cannot be checked.
    if (request.nextUrl.pathname !== "/order") {
      const rewriteUrl = request.nextUrl.clone();
      rewriteUrl.pathname = "/order";
      return NextResponse.rewrite(rewriteUrl);
    }
    return null;
  }
}

const clerkHandler = clerkMiddleware(async (auth, request) => {
  const seasonGate = await enforceOrderSeasonGate(request);
  if (seasonGate) return seasonGate;
  if (isPublic(request)) return;
  if (process.env.AUTH_MODE === "dev") return;
  await auth.protect();
});

export default async function middleware(
  request: NextRequest,
  event: Parameters<typeof clerkHandler>[1],
) {
  // Dev auth is explicit opt-in only (AUTH_MODE=dev). Default/missing → Clerk fail-closed.
  if (process.env.AUTH_MODE === "dev") {
    const seasonGate = await enforceOrderSeasonGate(request);
    if (seasonGate) return seasonGate;
    return NextResponse.next();
  }
  return clerkHandler(request, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
