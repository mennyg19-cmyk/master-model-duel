# Reviewer specialist — Security

**Arm:** arm-02 (blind)  
**Tree / phase:** P9 — Delivery routes, driver magic links, reroute, pickup, bulk delivery, crons  
**Output:** `results/reviews/P9-security-arm-02.md`  
**Scope:** trust boundaries, auth, secrets, IDOR, injection. Findings only — no fixes.

## Summary

P9 adds a public trust boundary (driver magic links at `/d/[token]` and `/api/d/[token]/*`) alongside staff-gated admin routes and two cron endpoints. The magic-link design is sound: 32-byte tokens stored only as HMAC-SHA256 keyed by `SESSION_SECRET`, rotation revokes prior links, completion starts a 30-min expiry clock, PIN-gated links use a per-link 5-try/15-min DB lockout plus a per-IP rate limit, and stop mutations are scoped by `(routeId, seasonId)` so a driver can only touch their own route. Admin routes consistently gate on `fulfillment.manage` and write audit. Findings below are hardening gaps, not open holes.

## Findings

### S1 — Cron bearer secret compared with non-constant-time equality (LOW)
`lib/cron.ts:13` — `requireCronAuth` checks `header !== \`Bearer ${env.CRON_SECRET}\``. Plain `!==` on the Authorization header is a timing-side-channel candidate against the bearer secret. Mitigated by 16+ char secret and network jitter, but the project uses `timingSafeEqual` for PINs/cookies elsewhere — this path is inconsistent.

### S2 — PIN cookie value is a deterministic HMAC, replayable for its lifetime (LOW)
`lib/routes/links.ts:33-42` — `pinCookieValue(linkId)` is `HMAC("route-pin-ok|linkId")`, a fixed value per link, set with `maxAge: 24h` (`app/api/d/[token]/pin/route.ts:42`). A captured cookie replays for 24h with no per-session rotation; a shared device where the PIN was once entered grants PIN-less access to anyone holding the URL token for that window. Keyed by `linkId` so link rotation kills it, but no rotation on reuse.

### S3 — 4-digit PIN space with lockout that resets to zero (LOW)
`lib/routes/links.ts:91-122` — PIN is 4 digits (10k space). The per-link lockout is 5 tries → 15 min, then `pinAttempts` resets to 0 and the lock clears, so an attacker can sustain ~5 tries / 15 min / link indefinitely (≈21 days to exhaust). The HMAC is server-keyed so offline brute force is impossible; this is purely the online budget. Acceptable but weak for a credential that gates PII + delivery mutations.

### S4 — PIN IP rate limit collapses to one shared bucket when `TRUST_PROXY` is off (LOW)
`lib/rate-limit.ts:28-37` + `app/api/d/[token]/pin/route.ts:14` — without `TRUST_PROXY=true`, `clientIp()` returns the literal `"direct"` for every client, so all drivers share a single 20/min PIN bucket. A busy driver pool can self-lockout of PIN entry; conversely the per-link DB lockout is the real defense, making this layer noisy rather than protective. The X-Forwarded-For handling when `TRUST_PROXY` is on is correct (last hop only).

### S5 — `switchPackageMethod` voids the label outside the method-switch transaction (MEDIUM)
`lib/routes/service.ts:264-280` — `voidShipmentById` runs before the `$transaction` that flips `fulfillmentMethodId` and writes audit. If the carrier void succeeds but the transaction then fails, the shipping label is voided while the package remains on the shipping method — a money/label integrity drift (refund captured, customer still shows "shipping"). The code comments the carrier-refuse direction but not this reverse.

### S6 — `buildRoute` does not re-check package availability inside the transaction (MEDIUM)
`lib/routes/service.ts:54-101` — candidates are selected with `routeStop: null` outside the `$transaction`, then stops are created inside it without re-asserting the package is still unassigned. Two concurrent `POST /api/admin/routes` builds for the same method can both pick the same packages; correctness then depends entirely on a unique constraint on `routeStop.packageId` (not visible in the route handler). If that constraint is absent or per-(route,package), duplicate stops result.

### S7 — `confirmReroute` appends a stop without re-verifying the package is still unassigned (LOW-MEDIUM)
`lib/routes/service.ts:379-411` — after `switchPackageMethod` commits, `routeStop.create` is issued with no check that the package hasn't meanwhile been placed on another route (e.g. by a concurrent `buildRoute` or reroute). `switchPackageMethod` only refuses a route conflict when the *target* is SHIPPING, not for the delivery reroute case. Same dependency on the `routeStop.packageId` unique constraint as S6.

### S8 — Bulk-delivery date validated by regex only, no semantic or future-date check (LOW)
`app/api/admin/bulk-delivery/route.ts:9` — `date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` accepts `2026-99-99` and past dates; `window` is free text up to 60 chars. A staff member with `fulfillment.manage` can schedule a notification for a nonsensical or past date and every bulk customer receives it. Staff-gated, so low severity, but no sanity guard.

### S9 — `payment-reminders` cron assumes a non-empty customer email (LOW)
`app/api/cron/payment-reminders/route.ts:39-48` — `recipient: order.customer.email` is passed straight to `captureNotification`; if the schema permits an empty/null email the row is still created with a bad recipient, and `notifyCustomer` (used by the P9 day-of/bulk/pickup paths) has the same assumption. No guard before send.

### S10 — Driver magic-link page is a public URL carrying full stop PII with no `noindex` (LOW)
`app/d/[token]/page.tsx` — the token IS the credential and the page renders recipient name, address, items, and order refs. External navigation uses `rel="noreferrer"` (good), but the page itself sets no robots/noindex meta, so a URL leaked into a log or shared publicly is crawlable and indexable. Inherent to magic links; the indexability is the added gap.

### S11 — No CSRF token; mutations rely solely on `sameSite=lax` session cookie (LOW)
`lib/api-client.ts` + all `app/api/admin/**` POST/PATCH routes — mutations are cookie-authenticated with `sameSite: "lax"` and no CSRF token. Lax blocks cross-site POST cookies, which mitigates the classic CSRF, but top-level GET-bearing-state and any future lax-bypass surface rely on the cookie attribute alone. The driver `/api/d/[token]/*` routes are token-in-path authenticated (not cookie-session), so they are not CSRF-relevant; admin routes are the surface.

### S12 — `pickup/ready` sweep is not concurrency-safe (LOW)
`lib/pickup.ts:55-75` — the `!entry.pickupReadyAt` filter and the subsequent `package.update({ pickupReadyAt })` are not in one transaction; two staff clicking simultaneously can both pass the filter and both increment `readied`. The notification `dedupeKey` backstops double-notify, but the `readied`/`notified` counts and the audit detail can be inflated.

### S13 — Pickup-expiry cron writes `packageAudit` but no `auditLog` row (LOW)
`lib/pickup.ts:134-141` — `expireOverduePickups` creates a `packageAudit` entry per package but no `auditLog` entry; the cron run itself is recorded in `CronRunLog`. Other P9 mutations (link create, start, reroute, method switch, bulk schedule, ready sweep) all write `auditLog`. Expiry is the only state-changing path without an `auditLog` row, so it's invisible to the audit-log-only review surface.

### S14 — `verifyPin` returns `{ ok: true }` for a link with no `pinHash` (INFO)
`lib/routes/links.ts:96` — posting a PIN for a no-PIN link returns ok and mints a PIN cookie. Reachable only by someone already holding the URL token; the cookie is meaningless for a no-PIN link. No impact, noted for completeness.

## Severity counts

- Critical: 0
- High: 0
- Medium: 2 (S5, S6)
- Low: 9 (S1, S2, S3, S4, S7, S8, S9, S10, S11, S12, S13) — counted as 11 low-severity items
- Info: 1 (S14)

Totals: **0 critical · 0 high · 2 medium · 11 low · 1 info** (14 findings).
