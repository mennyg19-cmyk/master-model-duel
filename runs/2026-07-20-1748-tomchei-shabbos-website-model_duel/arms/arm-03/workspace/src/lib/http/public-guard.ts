import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getEnv } from "@/lib/env";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

const DEFAULT_LIMIT = 60;
const WINDOW_MS = 60_000;

/**
 * Rate-limit identity: prefer signed session cookie (not XFF-spoofable).
 * X-Forwarded-For is ignored unless TRUST_PROXY=1 (then use rightmost hop / x-real-ip).
 */
function rateLimitIdentity(request: Request): string {
  const cookie = request.headers.get("cookie") ?? "";
  const session =
    cookie.match(/(?:^|;\s*)dev_user_id=([^;]+)/)?.[1] ??
    cookie.match(/(?:^|;\s*)__session=([^;]+)/)?.[1] ??
    null;
  if (session) return `sess:${session}`;

  if (process.env.TRUST_PROXY === "1") {
    const real = request.headers.get("x-real-ip")?.trim();
    if (real) return `ip:${real}`;
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      const parts = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
      const hop = parts[parts.length - 1];
      if (hop) return `ip:${hop}`;
    }
  }

  // No session and no trusted proxy — shared anonymous bucket (fail-closed vs XFF rotation).
  return "anon";
}

export function rateLimitOk(
  key: string,
  limit = DEFAULT_LIMIT,
  windowMs = WINDOW_MS,
): boolean {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= limit) return false;
  existing.count += 1;
  return true;
}

/** Reset in-memory buckets (tests / smoke). */
export function resetRateLimitBuckets() {
  buckets.clear();
}

function originAllowed(request: Request): boolean {
  const env = getEnv();
  const appOrigin = new URL(env.APP_URL).origin;
  const origin = request.headers.get("origin");
  if (origin) return origin === appOrigin;
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === appOrigin;
    } catch {
      return false;
    }
  }
  // Fail closed: missing Origin/Referer (and Sec-Fetch-Site null) must not bypass.
  return false;
}

export type PublicGuardOk<T> = { ok: true; data: T; ip: string };
export type PublicGuardFail = { ok: false; response: NextResponse };

/**
 * Public JSON endpoint guard (R-122): same-origin, IP/session rate limit, Zod body.
 */
export async function withPublicGuard<T>(
  request: Request,
  schema: ZodType<T>,
  opts?: { rateKey?: string; limit?: number },
): Promise<PublicGuardOk<T> | PublicGuardFail> {
  if (!originAllowed(request)) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "Forbidden origin" }, { status: 403 }),
    };
  }

  const identity = rateLimitIdentity(request);
  const pathKey = opts?.rateKey ?? new URL(request.url).pathname;
  const bucketKey = createHash("sha256").update(`${pathKey}:${identity}`).digest("hex");
  if (!rateLimitOk(bucketKey, opts?.limit ?? DEFAULT_LIMIT)) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "Rate limit exceeded" }, { status: 429 }),
    };
  }

  try {
    const json = await request.json();
    const data = schema.parse(json);
    return { ok: true, data, ip: identity };
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        ok: false,
        response: NextResponse.json({ ok: false, error: error.flatten() }, { status: 400 }),
      };
    }
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 }),
    };
  }
}
