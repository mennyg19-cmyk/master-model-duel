import { env } from "@/lib/env";
import { rateLimit, clientIp } from "@/lib/rate-limit";

// Public endpoint guard (R-122): state-changing routes reachable without a
// staff session get same-origin + IP rate limit here; Zod stays at each
// route's own boundary. Webhooks are exempt from same-origin — Stripe posts
// cross-origin by design and is authenticated by signature instead.

/** Same-origin check via Origin (fall back to Referer). Requests with neither header are refused. */
export function isSameOrigin(request: Request): boolean {
  const allowed = new URL(env.APP_URL).origin;
  const origin = request.headers.get("origin");
  if (origin) return origin === allowed;
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === allowed;
    } catch {
      return false;
    }
  }
  return false;
}

/** Returns a Response to send when the request is blocked, null when it may proceed. */
export function guardPublicEndpoint(
  request: Request,
  bucket: string,
  limit: number,
  windowMs: number
): Response | null {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  }
  if (!rateLimit(`${bucket}:${clientIp(request)}`, limit, windowMs)) {
    return Response.json({ error: "Too many requests — try again in a minute" }, { status: 429 });
  }
  return null;
}
