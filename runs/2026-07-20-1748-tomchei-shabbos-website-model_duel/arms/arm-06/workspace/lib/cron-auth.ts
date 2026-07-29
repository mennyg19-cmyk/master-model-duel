import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

// R-182/R-124: the bearer gate every /api/cron/* route runs first. The check
// is constant-time and refuses every caller when CRON_SECRET is unset, so an
// unauthenticated caller can neither probe the configuration state nor chip
// away at the secret via response timing.
export function isCronAuthorized(request: Request): boolean {
  const auth = request.headers.get("authorization");
  const expected = env.CRON_SECRET ? `Bearer ${env.CRON_SECRET}` : null;
  return (
    expected !== null &&
    auth !== null &&
    auth.length === expected.length &&
    timingSafeEqual(Buffer.from(auth, "utf8"), Buffer.from(expected, "utf8"))
  );
}
