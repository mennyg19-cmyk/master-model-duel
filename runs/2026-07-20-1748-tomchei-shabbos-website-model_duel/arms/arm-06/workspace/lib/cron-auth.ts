import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

// R-182/R-124: the bearer gate every /api/cron/* route runs first. The check
// is constant-time and refuses every caller when CRON_SECRET is unset, so an
// unauthenticated caller can neither probe the configuration state nor chip
// away at the secret via response timing.
export function isCronAuthorized(request: Request): boolean {
  const auth = request.headers.get("authorization");
  const expected = env.CRON_SECRET ? `Bearer ${env.CRON_SECRET}` : null;
  if (expected === null || auth === null) return false;
  // m3: compare fixed-length hashes of both sides — a wrong-length guess takes
  // the same code path and time as a right-length one, so the 401 timing can
  // never leak the secret's length.
  const authHash = createHash("sha256").update(auth, "utf8").digest();
  const expectedHash = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(authHash, expectedHash);
}
