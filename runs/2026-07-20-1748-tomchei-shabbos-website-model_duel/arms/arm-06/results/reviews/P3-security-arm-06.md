# P3 Security Review — arm-06 (blind)

**Phase:** P3 — storefront, catalog, archive, newsletter, admin catalog & media, settings
**Scope:** `arms/arm-06/workspace/`
**Reviewer:** Security specialist (findings only, no fixes)
**Severity:** Blocker / Major / Minor

Trust boundaries reviewed: session cookie (HMAC-signed, server-side `AuthSession` revocation), admin layout `admin.access` gate, per-route `requireApiPermission` gates, HMAC newsletter unsubscribe token, media upload allowlist, `/uploads/<name>` path-traversal guard, settings writable-key whitelist, impersonation rank check, advisory-locked first-run setup, invite token TTL.

---

## Blockers

None.

## Majors

### M1. Newsletter subscribe returns the HMAC unsubscribe token to any caller
`app/api/subscribe/route.ts` — `POST /api/subscribe` is unauthenticated and returns `{ managePath: "/unsubscribe?token=<HMAC>" }` for whatever email is posted. `upsertSubscriber` reactivates an existing subscriber in place, so the token is minted for an already-subscribed address too. The token is the same one transactional emails will embed (`lib/newsletter/tokens.ts`), and `POST /api/unsubscribe` only checks the token — no proof that the caller owns the mailbox. Attack chain: `POST /api/subscribe {email: victim}` → read `managePath` → `POST /api/unsubscribe {token, unsubscribeAll: true}`. Result: anyone can unsubscribe anyone, or silently flip their three preference flags, without consent or notification. The code comment acknowledges the token is returned pre-email-platform, but the trust boundary break is real: an unauthenticated route hands out a bearer credential for an arbitrary victim identity.

### M2. Staff role change has no actor-vs-target rank check
`app/api/admin/staff/[id]/route.ts` PATCH — the only guard on `role` is `canTargetStaff(actorId, id)` (self-block). There is no equivalent of `canImpersonate`'s `ROLE_RANK` check. A holder of `staff.manage` (default: MANAGER only, but grantable to STAFF via `PermissionOverride`) can:
- demote any MANAGER to DRIVER/STAFF (privilege DoS), and
- promote a co-conspirator STAFF to MANAGER, who then elevates the original actor.

The impersonation path enforces rank (`canImpersonate`); the role-change path does not — inconsistent trust boundary.

### M3. Permission overrides have no self-target block
`app/api/admin/staff/[id]/route.ts` PATCH — `canTargetStaff` is applied only to `role` changes. The `overrides` array is written for any target id, including the actor's own. A STAFF who holds `staff.manage` (via a granted override) can PATCH their own account and grant themselves `catalog.manage`, `settings.manage`, `staff.impersonate`, `audit.view` — full privilege escalation within the permission system. `canImpersonate` would still block cross-rank impersonation, but the direct permissions are now theirs.

### M4. Staff create + revoke have no rank check
`app/api/admin/staff/route.ts` POST and `app/api/admin/staff/[id]/revoke/route.ts` — a `staff.manage` holder can create a new MANAGER account (then confirm its invite to log in as MANAGER) and can revoke any MANAGER (server-side session revocation = immediate lockout). Combined with M2/M3, a single misgranted `staff.manage` override is a full takeover path. The self-target block on revoke is correct but insufficient.

## Minors

### m1. `POST /api/subscribe` has no rate limiting
Unlike `app/api/client-error/route.ts` (sliding-window cap), the subscribe route is uncapped and unauthenticated. Spam/abuse vector against the DB upsert path; also amplifies M1.

### m2. `POST /api/delivery-check` is unauthenticated and enumerates the delivery-ZIP allowlist
The endpoint returns `{ deliverable: bool }` for any 5-digit ZIP. The checkout page only publishes the count, not the list — this endpoint lets an attacker brute-force all 100k ZIPs to reconstruct the allowlist. The allowlist may be considered public, but the route makes silent bulk enumeration free.

### m3. Media upload trusts client-declared content-type/extension, no magic-byte sniff
`lib/media/validation.ts` — `validateUpload` checks `file.type` (client-set) against an allowlist and matches the filename extension. No content sniffing. A polyglot or misnamed file (e.g. `evil.jpg` with `Content-Type: image/jpeg` but non-image bytes) is accepted and stored as `.jpg`, served as `image/jpeg`. Browsers won't execute it as HTML, but the library accepts arbitrary bytes under an image content-type — defense-in-depth gap.

### m4. `DEV_AUTH_BYPASS=true` has no runtime production guard
`app/api/dev-auth/route.ts` — when the flag is true, any caller can POST any active `staffUserId` and receive a signed session for that user; `/dev-login` lists all active staff ids. `lib/env-spec.ts` defaults the flag to `"false"` and the `.env.example` warns "Must be false in production", but there is no `NODE_ENV === "production"` hard-fail. If the flag leaks true in prod, it is a complete auth bypass.

### m5. Role demotion does not clear existing permission overrides
`app/api/admin/staff/[id]/route.ts` — when `role` is changed, overrides are only rewritten if `parsed.data.overrides` is supplied. A demoted MANAGER who had `GRANT` overrides (e.g. `staff.manage`, `staff.impersonate`) retains them after being demoted to STAFF/DRIVER, because the role change alone doesn't touch overrides. Revoke (status=REVOKED) is safe; demotion is not.

### m6. Middleware redirects unauthenticated `/admin` to `/dev-login` which 404s when `DEV_AUTH_BYPASS=false`
`middleware.ts` always redirects to `/dev-login`; `app/dev-login/page.tsx` calls `notFound()` when the flag is false. Not a vulnerability, but a broken trust-boundary redirect target — an unauthenticated admin request lands on a 404 instead of a safe landing.

---

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 4 |
| Minor | 6 |
| **Total** | **10** |
