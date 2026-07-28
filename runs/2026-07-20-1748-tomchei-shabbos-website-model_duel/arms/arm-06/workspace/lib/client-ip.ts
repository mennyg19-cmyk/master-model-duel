// Client IP from x-forwarded-for: first hop only, capped at 45 chars (IPv6
// max). The header is client-controllable, so this is audit metadata and
// rate-limit key material — never an auth input. One helper so every route
// and session writer trims/caps identically.
export function clientIp(headers: { get(name: string): string | null }): string | null {
  return headers.get("x-forwarded-for")?.split(",")[0].trim().slice(0, 45) ?? null;
}
