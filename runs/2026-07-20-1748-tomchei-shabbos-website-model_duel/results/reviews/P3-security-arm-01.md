# P3 Security Review — arm-01

**Reviewer specialist:** Security
**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Arm:** `arm-01` (blind)
**Tree / phase:** `arms/arm-01/workspace/` — P3 (Storefront: marketing, catalog, archive, newsletter, admin catalog & media, settings hub)
**Scope:** trust boundaries, auth, secrets, IDOR, injection. Findings only — no fixes. No scope beyond P3.

## Summary

| Severity | Count |
|---|---|
| High | 1 |
| Medium | 3 |
| Low | 4 |
| Informational | 2 |
| **Total** | **10** |

Auth is layered consistently: admin server pages and `/api/admin/*` routes call `requirePermission(...)`, the storefront reads season status server-side, and the newsletter token uses HMAC-SHA256 with `timingSafeEqual`. The findings cluster around (a) a test-auth backdoor that becomes critical if misconfigured in a deployed environment, (b) an unsigned impersonation cookie that lets a manager bypass the audited impersonation flow, and (c) bearer-token / unauthenticated public endpoints that leak or grant capability beyond their intended trust boundary.

---

## High

### H1 — Test-auth header backdoor grants full identity takeover when `ENABLE_TEST_AUTH=true`
**File:** `src/lib/auth.ts:14-24`

`getAuthenticatedClerkUserId()` falls back, when `ENABLE_TEST_AUTH === "true"`, to reading the attacker-controlled request header `x-test-clerk-user-id` (defaulting to `__local_manager__`). The returned value is then used directly as `clerkUserId` to look up — or, via the bootstrap path, create — a `StaffUser` with `MANAGER` role.

- Any caller can set `x-test-clerk-user-id` to a known `clerkUserId` and authenticate as that staff user, or to `__local_manager__` to become the first active MANAGER.
- `requirePermission` and every admin route trust this identity. There is no allowlist of source IPs, no header signing, and no environment guard beyond the single boolean.
- `.env.example` ships `ENABLE_TEST_AUTH=false` and labels it "Never enable on preview, staging, or production deployments," but nothing in code prevents the flag from being flipped in a deployed environment. A misconfigured preview/production env = complete authentication bypass and privilege escalation to MANAGER.

This is the single highest-impact trust-boundary issue in the phase.

---

## Medium

### M1 — Unsigned `impersonate_staff_id` cookie enables audit-bypassing impersonation
**File:** `src/lib/auth.ts:43-54`, `src/app/api/admin/impersonation/route.ts:51-57`

The impersonation selector is stored as a raw, unsigned `impersonate_staff_id` cookie containing the target staff ID. `getCurrentStaffUser` reads it verbatim and loads the `effective` staff user from it. The only guard in `requirePermission` is that `actor` holds `staff:impersonate` — which any MANAGER already has.

- A MANAGER can craft/set this cookie directly to any active staff ID and skip `POST /api/admin/impersonation` entirely. That POST is the only place an `impersonationSession` record and a `staff.impersonation_started` audit log are written.
- Result: a manager can act under another staff member's identity with **no `ImpersonationSession` row and no `staff.impersonation_started` audit entry** — defeating the audit trail that the impersonation feature exists to create.
- The cookie is `httpOnly` + `secure` (prod) + `sameSite=lax`, so theft is not the primary risk; the issue is that the cookie is a trusted, unsigned capability token.

### M2 — Bootstrap `/api/setup` lets any Clerk-signed-up user become the first MANAGER
**File:** `src/app/api/setup/route.ts:16-72`

`POST /api/setup` only requires "a Clerk user identity" — it does not pre-approve or allowlist that identity. If Clerk is configured with public signups, any anonymous visitor can create a Clerk account and, before the first manager is bootstrapped, race to install themselves as the sole MANAGER and lock the bootstrap state. The transactional lock prevents two managers, but not an attacker winning the race against the legitimate operator. The window is small but the outcome is full admin takeover.

### M3 — Newsletter subscribe returns a valid capability token to the caller for any email
**File:** `src/app/api/newsletter/subscribe/route.ts:16-28`, `src/app/api/newsletter/preferences/route.ts:31-57`

`POST /api/newsletter/subscribe` is unauthenticated and returns `preferencesUrl` containing a freshly signed HMAC token bound to the (re)subscribed email. Because the token is a bearer capability for `GET/PATCH /api/newsletter/preferences`:

- An attacker can subscribe a victim's email and immediately receive a token granting read access to the victim's subscription state and write access to unsubscribe them or alter preferences — without ever controlling the victim's inbox.
- The token lifetime is 30 days (`src/lib/newsletter.ts:6`), so the granted capability is long-lived.
- The token is delivered in the response body to whoever calls subscribe, not via email verification, so email ownership is never established.

---

## Low

### L1 — `CLIENT_ERROR_TOKEN` declared but never enforced
**File:** `src/lib/env.ts:5,21`; `src/app/api/client-errors/route.ts`

`ServerEnvironment` declares `CLIENT_ERROR_TOKEN` and `.env.example` documents it as "Optional bounded client-error ingestion token," but `POST /api/client-errors` never reads or validates it. The endpoint is fully unauthenticated and writes attacker-supplied `route`/`category` strings (truncated to 200/80 chars) to `console.error`. Net effect: an unauthenticated log-injection / log-spam vector that the documented token gate was clearly intended to prevent.

### L2 — Newsletter bearer token transported in URL query string
**File:** `src/app/(storefront)/newsletter/preferences/page.tsx:8`; `src/components/newsletter-preferences.tsx:18`; `src/app/api/newsletter/preferences/route.ts:13`

The 30-day capability token is passed as `?token=...` on the preferences page and on the `GET /api/newsletter/preferences` call. Tokens in URLs are retained in browser history, server access logs, and any `Referer` leakage to third-party resources loaded by the page. The preferences page itself loads no third-party assets, which limits `Referer` exposure, but the URL persistence in logs/history remains a token-disclosure surface for a 30-day capability.

### L3 — Media upload trusts client-declared `Content-Type` with no magic-byte validation
**File:** `src/app/api/admin/media/route.ts:29-49`

The upload gate checks `upload.type` (the client-supplied MIME) against an allowlist and stores the asset to Vercel Blob with `contentType: upload.type`. There is no magic-byte / sniff validation. An attacker with `settings:manage` (or via a compromised manager) can upload arbitrary bytes labeled `image/jpeg`. SVG is correctly excluded from the allowlist (mitigating inline-script XSS), but content-type spoofing of the stored public blob is still possible. Severity is bounded by the `settings:manage` requirement and the public-blob `nosniff` behavior, hence Low.

### L4 — `imageUrl` accepted from admin body without scheme/host validation
**File:** `src/app/api/admin/catalog/route.ts:52,105`; `src/components/media-manager.tsx:55-63`

`PATCH /api/admin/catalog` stores `imageUrl` verbatim from the request body (the media manager sends the selected blob URL, but the API accepts any string). Rendering goes through `next/image`, whose `remotePatterns` (`next.config.ts:10-17`) restrict to `*.public.blob.vercel-storage.com`, so malicious external/`javascript:`/`data:` URLs will fail to render rather than execute. The residual risk is stored-URL injection of a disallowed host that breaks rendering or attempts SSRF via the next/image optimizer, hence Low.

---

## Informational

### I1 — `/api/health` discloses auth mode
**File:** `src/app/api/health/route.ts:12`

The unauthenticated health endpoint returns `auth: "clerk" | "local-development"`. In a deployed environment where Clerk is not yet configured, this publicly signals that the app is running in local-development mode — a useful reconnaissance hint that pairs with H1/M2 (bootstrap and test-auth exposure). No direct exploit; flag for awareness.

### I2 — `setup` GET leaks bootstrap lock state to anonymous callers
**File:** `src/app/api/setup/route.ts:9-14`

`GET /api/setup` is unauthenticated and reports `{ locked: boolean }`. Before bootstrap, it tells any caller that the first-manager race window (M2) is still open. Informational only; combined with M2 it shortens an attacker's reconnaissance step.

---

## Out of scope (noted, not scored)

- `/catalog/[id]` "View details" / "See full details" links in `catalog-explorer.tsx` resolve to a route not present in the P3 tree (404). Functional gap, not a security finding.
- Cart/checkout/POS/Stripe flows are explicitly out of scope for P3 and were not reviewed.
