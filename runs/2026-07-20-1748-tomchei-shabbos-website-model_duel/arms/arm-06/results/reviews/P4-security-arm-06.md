# P4 Security Review — arm-06 (blind)

**Phase:** P4 — cart-first order builder, address book, customer account, guest checkout tokens
**Scope:** `arms/arm-06/workspace/`
**Reviewer:** Security specialist (findings only, no fixes)
**Severity:** Blocker / Major / Minor

Trust boundaries reviewed: customer session cookie (HMAC-signed `CustomerSession`, server-side revocation/expiry), per-route `requireApiCustomer` gate, guest draft HMAC token (one-time, never stored raw), draft ownership anti-enumeration (404 on miss, never 403), address-book ownership (`customerId` match in engine), staff address edit `customers.manage` gate + audit, draft line price snapshotting (server-side, no client price input), `x-forwarded-for` rate limiting, zod body schemas.

---

## Blockers

None.

## Majors

### M1. Guest draft save attaches to an existing customer account by email/phone with no verification
`app/api/drafts/route.ts` (guest branch, lines 95–105) → `lib/customers/dedupe.ts` `findOrCreateCustomer`. The unauthenticated guest path takes `body.guest = { name, email, phone }` and calls `findOrCreateCustomer`, which dedupes on normalized email/phone and returns the existing `Customer` row when the email/phone already belongs to someone. `customerId` is then set to that (possibly victim's) id, and `saveDraft` creates an order + recipients under it. Inside `writeRecipients` (`lib/orders/drafts.ts`), `recipient.saveToBook === true` calls `saveAddress(customerId, …)` — so the attacker also injects arbitrary rows into the victim's address book.

Attack chain: `POST /api/drafts { guest: { email: victim }, lines, recipients: [{ saveToBook: true, … }] }` → drafts and address-book entries appear under the victim's account; the victim sees them in `/account/orders` and `/account/addresses` on next login. No PII is read (the attacker gets no session cookie and cannot list the victim's existing data — those routes need `requireApiCustomer`), but this is an integrity / account-pollution violation against a known email with no verification gate. The dedupe is intended for returning guests, but the absence of any email-ownership proof makes it attacker-driven.

### M2. Guest draft access token (bearer secret) is carried in the URL query string
`app/(storefront)/order/page.tsx` and `app/(storefront)/checkout/page.tsx` read `?token=<guestToken>`; `components/order-builder/order-builder-shell.tsx` `proceedToCheckout` / `submitGuestIdentity` push `/checkout?ref=…&token=…` and `/order?draft=…&token=…` via `router.push`; `app/api/drafts/[draftRef]/route.ts` `accessFrom` reads the token from the query string. The token is a 32-byte HMAC bearer that grants load/cancel/save access to the draft (`loadDraft`, `loadOrderForCheckout`, `cancelDraft` all accept it as `DraftAccess.guestToken`).

Bearer secrets in URLs leak via browser history, server access logs (Vercel logs request paths including query strings by default), and `Referer` on any subsequent navigation. The token is also stored in `localStorage` (`GUEST_DRAFT_KEY`, see m4), so the URL is not the only exposure — but the URL channel is the avoidable one. A short-lived httpOnly cookie or a request body / header channel would keep the bearer out of logs and history.

## Minors

### m1. `POST /api/addresses/validate` is unauthenticated and reconstructs the delivery-ZIP allowlist
`app/api/addresses/validate/route.ts` returns `{ deliverable: bool }` for any normalized ZIP. The checkout page only publishes the count of delivery ZIPs, not the list — this endpoint lets an attacker probe arbitrary ZIPs to rebuild the allowlist (business information). Rate-limited at 30/min per IP, but per-instance on serverless (m3) and trivially parallelizable across IPs. Same pattern as the P3 `delivery-check` finding; re-flagged because P4 adds a second unauthenticated probe path.

### m2. `POST /api/addresses/validate` upserts a GeocodeCache row on every call
`lib/customers/geocode.ts` `geocodeAddress` runs `prisma.geocodeCache.upsert` for every validated address key. The endpoint is unauthenticated, so a caller can bloat the `GeocodeCache` table with arbitrary normalized keys (one row per distinct address string). Rate-limited but per-instance (m3); the table grows unbounded with attacker-chosen keys. The validate route does not need to persist a cache entry — it only returns the point + deliverability.

### m3. Rate limiter is in-memory per-instance
`lib/rate-limit.ts` — the fixed-window buckets live in module scope (`new Map`), so on Vercel serverless each instance keeps its own map. The per-IP caps on `drafts`, `addresses/validate`, `delivery-check`, and `subscribe` are only a speed bump across instances; a determined caller rotating across instances/IPs bypasses the intended ceiling. The code comment acknowledges this for `subscribe`, but it applies to every unauthenticated rate-limited route added in P3/P4.

### m4. Guest draft token stored in `localStorage`
`components/order-builder/use-auto-save.ts` `GUEST_DRAFT_KEY = "arm06_guest_draft"` persists `{ …, guestToken }` as JSON in `localStorage`. Any XSS (now or via a future dependency) exfiltrates the bearer and gains draft load/save/cancel. The token is also written to the URL (M2). `localStorage` is reachable from JS by design; a session-style httpOnly cookie would not be.

### m5. Guest draft token never expires on the order row
`lib/orders/guest-token.ts` / `lib/orders/drafts.ts` — `guestTokenHash` is stored on the `Order` row with no `expiresAt`. `loadOrderForCheckout` accepts the token for any status including `FINALIZED`. A token that leaks once (logs, history, XSS) grants permanent read access to the draft and its recipient PII. A short TTL (or clearing `guestTokenHash` on `FINALIZED`) would bound the exposure.

### m6. Inconsistent `x-forwarded-for` extraction across routes
`app/api/drafts/route.ts` `clientIp` slices the first hop to 45 chars; `app/api/addresses/validate/route.ts` only `.trim()`s (no cap); `lib/auth.ts` / `lib/customers/session.ts` cap to 45. The header is spoofable client-side either way (acknowledged as audit metadata only), but the inconsistency means the rate-limit key shape varies per route and the uncapped variant can produce arbitrarily long map keys.

---

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 2 |
| Minor | 6 |
| **Total** | **8** |
