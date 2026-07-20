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

export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}
