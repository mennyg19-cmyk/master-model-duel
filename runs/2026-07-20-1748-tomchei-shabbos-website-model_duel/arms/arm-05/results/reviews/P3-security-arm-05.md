# P3 Security Review — arm-05 (blind)

**Phase:** P3 — Storefront: marketing, catalog, archive, newsletter, admin catalog & media
**Scope:** trust boundaries, auth, secrets, IDOR, injection, upload validation, newsletter tokens
**Method:** findings only — no fixes. P3 scope only.

## Summary counts

- Critical: 0
- High: 1
- Medium: 3
- Low: 5
- Info: 3
- Total: 12

---

## H-1 — Newsletter unsubscribe token handed to any caller of the public subscribe endpoint

**Severity:** High
**Location:** `app/api/newsletter/route.ts:13-18` (POST) → `lib/newsletter.ts:47-55` (`subscribe`)
**Claim:** The public, unauthenticated `POST /api/newsletter` accepts any email, upserts a `NewsletterSubscriber` row (clearing `unsubscribedAt`), and returns the HMAC-signed unsubscribe token to the caller. This breaks the "only the subscriber can unsubscribe" trust model.
**Evidence:** `app/api/newsletter/route.ts:13-18` issues `subscribe(parsed.data.email)` and returns `{ unsubscribeToken, unsubscribeUrl }` to whoever POSTed. `lib/newsletter.ts:47-55` upserts on `email` and returns `createUnsubscribeToken(normalizedEmail)`. No authentication, no email verification, no rate limit, no same-origin check. An attacker who knows a victim's email can (a) subscribe the victim without consent — P11 will then send marketing email to an unconsented recipient; (b) harvest the victim's unsubscribe token; (c) call DELETE at any time to unsubscribe the victim. The HMAC secret does not help because the token is delivered to the attacker, not to the subscriber.

---

## M-1 — Unsubscribe token leaks subscriber email in plaintext

**Severity:** Medium
**Location:** `lib/newsletter.ts:18-20`, `26-29`
**Claim:** The token payload is `Buffer.from(JSON.stringify({ email, expiresAt })).toString("base64url")` — base64 is not encryption. The subscriber's email is recoverable by anyone who observes the token.
**Evidence:** `encodePayload` JSON-encodes `{ email, expiresAt }` and base64url-encodes it. `createUnsubscribeToken` returns `${payload}.${sign(payload)}`. Decoding the segment before the first `.` yields the raw email. Tokens travel in URLs (query string on `/unsubscribe?token=…`), so they leak via Referer headers, browser history, proxy logs, screenshots, and the storefront success message (see M-2). PII disclosure of the subscriber email.

---

## M-2 — Storefront renders the unsubscribe URL (with token) as visible page text

**Severity:** Medium
**Location:** `app/components/storefront-shell.tsx:19`
**Claim:** The subscribe success message puts the signed unsubscribe URL into the DOM as readable text, exposing the token (and therefore the subscriber email, per M-1) to screenshots, screen-shares, copy-paste, browser extensions, and any client-error capture that grabs the DOM.
**Evidence:** `setNewsletterMessage(\`Subscribed. Your private unsubscribe link is ${body.unsubscribeUrl}.\`)` then rendered as `<p role="status">{newsletterMessage}</p>`. The token is intended to be a private capability URL; printing it in the page defeats that.

---

## M-3 — Media upload trusts client-supplied Content-Type with no content validation

**Severity:** Medium
**Location:** `app/api/admin/media/route.ts:8-38` + `lib/media.ts:1-12`
**Claim:** Upload validation only inspects `file.type` (client-controlled) and `file.size`. The blob is stored with `contentType: file.type`, so a staff user (or anyone with a `settings.manage` session) can upload arbitrary bytes with a JPEG/PNG/WebP Content-Type. No magic-byte sniff, no re-encode, no SVG (good), but no defense against polyglot files served from the public blob URL.
**Evidence:** `lib/media.ts:8-12` returns the extension from `allowedMediaTypes.get(file.type)` and checks `file.size`. `app/api/admin/media/route.ts:24-28` calls `put(\`catalog/${randomUUID()}.${extension}\`, file, { access: "public", contentType: file.type })`. The blob URL is later rendered in `<img src={product.media.url}>` (`app/components/catalog-grid.tsx:55`, `app/admin/catalog/page.tsx:88`). If a future consumer opens the blob URL directly or the blob host sniffs content, content-type confusion can enable stored XSS from a public asset.

---

## L-1 — `hasSameOrigin` rejects requests with no Origin header and is unevenly applied

**Severity:** Low
**Location:** `lib/route-auth.ts:51-54`; absent from `app/api/newsletter/route.ts` and `app/api/client-error/route.ts`
**Claim:** The same-origin guard compares `request.headers.get("origin")` to `new URL(request.url).origin`. When `Origin` is missing (non-browser clients, some proxies), the comparison is `null === string` → 403. Safe-by-default, but it breaks legitimate same-server scripts. More importantly, the guard is not applied to the newsletter POST/DELETE or the client-error POST, leaving those endpoints without CSRF protection.
**Evidence:** `app/api/admin/media/route.ts:11`, `app/api/admin/catalog/route.ts:35`, `app/api/admin/settings/route.ts:28`, `app/api/staff/route.ts:23`, `app/api/staff/[staffId]/route.ts:20`, `app/api/setup/route.ts:19` all call `hasSameOrigin`. `app/api/newsletter/route.ts:13` (POST) and `:20` (DELETE) and `app/api/client-error/route.ts:9` (POST) do not.

---

## L-2 — Newsletter POST/DELETE have no same-origin check

**Severity:** Low
**Location:** `app/api/newsletter/route.ts:13-26`
**Claim:** A cross-origin form can POST to `/api/newsletter` to subscribe a victim's email without consent. The response body is not readable cross-origin (no CORS headers), but the side effect (re-subscribing a previously-unsubscribed victim, clearing `unsubscribedAt`) still executes. DELETE is largely protected by the token requirement, so CSRF cannot unsubscribe a victim without the token.
**Evidence:** No `hasSameOrigin` call in either handler. Combined with H-1, a third-party page can mass-subscribe visitor emails; P11 will then email them.

---

## L-3 — Static shared-secret comparison is not constant-time

**Severity:** Low
**Location:** `app/api/client-error/route.ts:10-13`
**Claim:** `request.headers.get("x-error-reporting-token") !== token` is a non-constant-time string compare on a static shared secret, exposing a timing oracle. The token is a single static value shared across all callers and shipped in the client bundle.
**Evidence:** `app/api/client-error/route.ts:11` uses `!==`. `process.env.ERROR_REPORTING_TOKEN` is a single value; the client must know it to report, so it is embedded in client-side code and trivially extractable. The `replace_me` guard is the only rotation protection.

---

## L-4 — Setup bootstrap state is probeable by unauthenticated callers

**Severity:** Low
**Location:** `app/api/setup/route.ts:10-16`
**Claim:** `GET /api/setup` returns `{ canBootstrap: boolean }` to anyone, leaking whether the system has been initialized. Useful for attacker reconnaissance of fresh deployments.
**Evidence:** `GET()` calls `canBootstrap()` and returns the boolean with no auth check. The POST still requires an authenticated Clerk session, so impact is limited to information disclosure.

---

## L-5 — Catalog admin update can move a product across seasons, bypassing archive invariant

**Severity:** Low
**Location:** `app/api/admin/catalog/route.ts:6-16, 39-47`
**Claim:** `productSchema` accepts `seasonId` and the update path passes it through to `prisma.product.update`. A `settings.manage` staff member can move a product from an archived season into the open season (or vice versa), bypassing the archive-browse-only invariant the season gate is supposed to enforce. No check that the target season is the current/open season.
**Evidence:** `app/api/admin/catalog/route.ts:42-43` `prisma.product.update({ where: { id }, data: product })` where `product` includes `seasonId`. The `@@unique([seasonId, sku])` constraint will reject duplicates but not cross-season moves with a fresh SKU.

---

## I-1 — Settings PUT toggles only the most-recent season, leaving older OPEN seasons live

**Severity:** Info
**Location:** `app/api/admin/settings/route.ts:33-43`; `lib/storefront.ts:13-28`
**Claim:** `prisma.season.findFirst({ orderBy: { year: "desc" } })` updates only the latest year's status. If multiple OPEN seasons exist, an older OPEN season stays open and `getStorefront` (which uses `findFirst({ where: { status: "OPEN" } })`) will still serve `/order` against it. Inconsistent season-gate enforcement.
**Evidence:** `app/api/admin/settings/route.ts:33` finds the latest season; `:40-43` conditionally updates only that one. `lib/storefront.ts:14-17` finds the first OPEN season by `year desc`. A manager who opens a second season cannot reliably close the storefront via this endpoint.

---

## I-2 — Dev auth bypass gated only on `NODE_ENV === "development"` string compare

**Severity:** Info
**Location:** `lib/dev-auth.ts:15-19`
**Claim:** If `NODE_ENV` is misconfigured to `"development"` in a deployed environment, `DEV_AUTH_MODE=true` plus a known `DEV_AUTH_SECRET` would let forged `x-dev-session` headers authenticate as any user. Defense in depth: also gate on a non-public deployment flag.
**Evidence:** `isDevAuthEnabled()` returns true iff `NODE_ENV === "development"` AND `DEV_AUTH_MODE === "true"` AND a secret exists. The dev session token is an HMAC-signed JSON payload with `userId`, `email`, `expiresAt`; forging it requires the secret, but the secret is a single env var and the only gate preventing misuse in production is the `NODE_ENV` string.

---

## I-3 — Impersonation is a stub that writes a misleading audit event

**Severity:** Info
**Location:** `lib/staff-store.ts:216-230`; `app/api/staff/[staffId]/route.ts:35-38`
**Claim:** `startImpersonation` only writes an `auditEvent` row with action `staff.impersonation_started`; it does not swap sessions or grant the actor the target's identity. The audit log records an impersonation that did not happen. Not exploitable in P3, but a correctness/audit-integrity issue for P6.
**Evidence:** `lib/staff-store.ts:216-230` creates the audit row and returns `true`; no session mutation. `app/api/staff/[staffId]/route.ts:36-38` returns "Impersonation session started and audited." to the caller.

---

## Notes on out-of-scope items observed

- `.env.local` exists in the workspace with `NEWSLETTER_TOKEN_SECRET` and `DEV_AUTH_SECRET`, but `.gitignore` excludes `.env.local`, so no leak path. Not a finding.
- Clerk middleware (`proxy.ts`) runs on all routes; the per-route `authorize` calls are the actual permission gate. No bypass observed.
- `app/api/health/route.ts` is unauthenticated and returns DB adapter only — no sensitive info.
- Season gate on `/order` (`app/order/page.tsx:7-8`) is server-side via `getStorefront` redirect. Consistent with S2.
