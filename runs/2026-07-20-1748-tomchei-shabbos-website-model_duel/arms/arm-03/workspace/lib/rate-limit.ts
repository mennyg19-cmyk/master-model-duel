import { env } from "@/lib/env";

// In-memory fixed-window rate limiter. Per-process only — sufficient for the
// single-node dev deployment; swap for a shared store before horizontal scaling.
type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const window = windows.get(key);
  if (!window || window.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  window.count += 1;
  if (windows.size > 10_000) {
    for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
  }
  return window.count <= limit;
}

// X-Forwarded-For is client-controlled unless a proxy we run appends to it, so
// trusting it lets an attacker mint a fresh rate-limit key per request. Only
// when TRUST_PROXY=true (deployed behind exactly one reverse proxy) do we read
// the LAST hop — the one our proxy appended, which the client cannot forge.
// Direct-serving dev/single-node ignores the header and shares one bucket.
export function clientIp(request: Request): string {
  if (env.TRUST_PROXY) {
    const chain = (request.headers.get("x-forwarded-for") ?? "")
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);
    if (chain.length > 0) return chain[chain.length - 1];
  }
  return "direct";
}
