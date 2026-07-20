# P3 Security Review — arm-02 (blind)

**Phase:** P3 — Storefront: marketing, catalog, archive, newsletter, admin catalog & media.
**Scope:** `arms/arm-02/workspace/` per `shared/phases/PHASE-P3-EXPECTED.md`.
**Method:** Findings only, no fixes. Trust boundaries, auth, secrets, IDOR, injection.
**Reviewer model:** blind to contestant identity.

## Summary

AuthN/AuthZ backbone is solid: every `/api/admin/*`, `/api/staff/*`, `/api/audit`, `/api/impersonate` route gates through `requirePermissionApi`; admin pages gate through `requirePermissionPage`; sessions are HMAC-tokenized with a server secret; passwords use scrypt + timing-safe compare; login has per-IP and per-account throttling; media uploads validate real file bytes, not extensions; the season gate is enforced server-side on `/order` and `/checkout`; audit entries commit atomically with their mutations. No injection, IDOR, or broken-access findings on the admin surface.

The findings below are on the newsletter trust boundary and a few deployment-hygiene / defense-in-depth gaps.

## Findings

### M1 — Unauthenticated newsletter subscribe lets anyone mint management tokens for arbitrary addresses (Medium)

`app/api/newsletter/subscribe/route.ts` accepts any email, upserts the row to `SUBSCRIBED`, and returns a valid HMAC preferences/unsubscribe token for that address in the response body:

```22:31:arms/arm-02/workspace/app/api/newsletter/subscribe/route.ts
  await db.newsletterSubscriber.upsert({
    where: { email },
    update: { status: "SUBSCRIBED", unsubscribedAt: null, ...(parsed.data.name ? { name: parsed.data.name } : {}) },
    create: { email, name: parsed.data.name },
  });
  const token = createNewsletterToken(email);
  return Response.json({ ok: true, manageUrl: `/newsletter/preferences?token=${token}` });
```

There is no email verification step. Consequences:

- An attacker can re-subscribe a victim who deliberately unsubscribed (`status` reset to `SUBSCRIBED`, `unsubscribedAt` cleared), defeating the victim's unsubscribe.
- The returned token is the same HMAC token used by `/api/newsletter/unsubscribe` and `/api/newsletter/preferences` (PATCH). The caller can immediately unsubscribe the victim or flip their preferences — no ownership proof required.
- The token encodes the email in base64url (not encrypted) and is valid for 90 days, so a single subscribe call yields long-lived control over the target's subscription state.

The HMAC token design (R-018 / R-123) protects against token forgery, but the subscribe endpoint mints the token for whoever calls it, not for the verified mailbox owner. The per-IP rate limit (5/min) only slows volume; it does not bind the token to ownership.

### L1 — `clientIp` trusts `x-forwarded-for` blindly (Low)

`lib/rate-limit.ts`:

```21:23:arms/arm-02/workspace/lib/rate-limit.ts
export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}
```

Without a trusted-proxy allowlist, any client can set `X-Forwarded-For` to rotate the per-IP rate-limit key used by `/api/auth/login`, `/api/newsletter/subscribe`, and `/api/client-error`. The per-account login limit (`login:email:*`, 10 / 15 min) still caps online guessing against a single account, so the impact is bounded to weakening per-IP throttling, not an open brute-force path.

### L2 — `SESSION_SECRET` entropy not enforced; example secret committed (Low)

`lib/env.ts` requires only `min(16)` characters:

```7:9:arms/arm-02/workspace/lib/env.ts
    SESSION_SECRET: z
      .string()
      .min(16, "SESSION_SECRET must be at least 16 characters (used to sign session tokens)"),
```

`.env.example` ships a literal placeholder:

```8:8:arms/arm-02/workspace/.env.example
SESSION_SECRET=change-me-to-a-random-string
```

A deployed weak or copied-from-example secret allows offline forging of staff session tokens (`lib/auth/session.ts` `hashToken`) and newsletter tokens (`lib/newsletter-token.ts`). The actual `.env` in this workspace uses a dev-only string, which is appropriate for the harness but not enforced. No entropy/`randomBytes` guidance is validated at startup.

### L3 — `SESSION_SECRET` reused across session and newsletter HMAC schemes (Low)

The same `env.SESSION_SECRET` keys both `hashToken` in `lib/auth/session.ts` (line 12) and `sign` in `lib/newsletter-token.ts` (line 12). Key reuse across two distinct HMAC schemes is not a current vulnerability but collapses two trust boundaries into one secret; compromise of either scheme's verifier (e.g. a future logging bug) breaks both. Separate per-scheme secrets would isolate blast radius.

### L4 — Newsletter token carried in URL query string (Low)

`/newsletter/preferences?token=...` places the 90-day HMAC token in the URL. Tokens in URLs leak via `Referer` to third-party destinations, browser history, and server/proxy access logs. The token also carries the subscriber's email in cleartext (base64url), so anyone with the link can read the address even though they cannot forge a new one. A header / POST body / fragment delivery channel would reduce exposure.

### L5 — No rate limiting on unsubscribe / preferences PATCH (Low)

`app/api/newsletter/unsubscribe/route.ts` and `app/api/newsletter/preferences/route.ts` perform DB writes on a token but apply no `rateLimit`. The token is unforgeable (HMAC-SHA256), so this is not a guessing path; impact is limited to unbounded request volume / log noise against a valid token. Subscribe is throttled, the other two token endpoints are not.

### L6 — `/api/setup` GET discloses setup-locked state to unauthenticated callers (Low)

`app/api/setup/route.ts`:

```13:16:arms/arm-02/workspace/app/api/setup/route.ts
export async function GET() {
  const staffCount = await db.staffUser.count();
  return Response.json({ locked: staffCount > 0 });
}
```

A public boolean for "has any staff account been provisioned" is a minor reconnaissance aid (tells an attacker whether the bootstrap window is still open). The POST is correctly locked inside a transaction, so this is informational only.

## Informational

- **I1 — Impersonation has no role-hierarchy guard.** `app/api/impersonate/route.ts` lets any holder of `staff.impersonate` impersonate any ACTIVE staff member regardless of role, including a MANAGER. Combined with per-user GRANT overrides, a STAFF granted `staff.impersonate` could escalate to MANAGER-equivalent privileges. Mitigated by audit logging and the high bar of granting `staff.impersonate`, but no check prevents impersonating "up."
- **I2 — CSRF defense relies solely on `SameSite=Lax`.** All state-changing admin endpoints depend on the session cookie with `sameSite: "lax"` (`lib/auth/session.ts` line 27) and carry no CSRF token. Lax blocks cross-site POST/PATCH/DELETE submissions, which is adequate for these methods, but there is no defense-in-depth token and no `Sec-Fetch-Site` validation.

## Severity counts

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 6 |
| Informational | 2 |
| **Total** | **9** |

## Not in scope / not found

- No SQL injection (all queries via Prisma parameterized APIs).
- No path traversal in local media serving (`/media/[id]` resolves by DB `id`, not user path).
- No XSS in audit log rendering (React text-node escaping; `JSON.stringify(detail)`).
- No broken object-level authorization on admin CRUD (every mutation gated by the relevant permission).
- No secret material committed (`.env` is gitignored; `.env.example` carries only placeholders).
