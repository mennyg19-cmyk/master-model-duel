# Aggregate Review P1 — arm-05 (blind)

Phase: P1 — Foundation, identity, roles, permissions, staff tooling.
Sources: P1-security, P1-quality, P1-rules, P1-clean-code specialist reviews.
Method: union + dedupe by location+claim; security blockers always survive; no new findings.

## Post-dedupe counts

| Severity | Count |
|---|---|
| Blocker | 9 |
| Major | 21 |
| Minor | 17 |
| **Total** | **47** |

## Prioritized fix list (one pass: blockers → majors → useful minors)

### Blockers (fix first)

**B1 — Middleware file misnamed; Clerk middleware never runs.**
Location: `proxy.ts` (root). Claim: Next.js only loads `middleware.ts`/`middleware.js` at root; `proxy.ts` exports `clerkMiddleware` + matcher but the file is never loaded, so no admin route is middleware-protected. Tags: quality-B1, rules-B1.

**B2 — Staff/audit/setup/admin-security API routes are unauthenticated; audit log PII disclosed.**
Location: `app/api/staff/route.ts` (GET/POST), `app/api/staff/[staffId]/route.ts` (PATCH), `app/api/audit/route.ts` (GET), `app/api/setup/route.ts` (POST), `app/api/admin/security/route.ts` (GET). Claim: none of these route handlers verify a Clerk session or call `requirePermission`; `GET /api/audit` returns the full audit trail (emails, security events) to any caller. Tags: security-B1, security-B5, quality-M8.

**B3 — Identity spoofable via `?actor=<email>` query parameter.**
Location: `app/api/admin/security/route.ts:4-9`. Claim: the only "auth" check reads actor email from the query string and trusts it; any caller can pass `?actor=manager@…` to pass the `audit.read` gate. Tags: security-B2, quality-B2, rules-B4.

**B4 — Unauthenticated privilege escalation: anyone can invite a MANAGER.**
Location: `app/api/staff/route.ts:16-23`. Claim: `POST /api/staff` accepts `role: "MANAGER"` with no caller auth and no `staff.manage` permission gate. Tags: security-B3.

**B5 — Unauthenticated IDOR on PATCH /api/staff/[staffId].**
Location: `app/api/staff/[staffId]/route.ts:13-43`. Claim: any caller can change any staff member's role/overrides, revoke, or start impersonation purely by supplying `staffId`; no auth, no ownership check, no `staff.manage` gate. Tags: security-B4.

**B6 — Unauthenticated bootstrap: anyone can create the first Manager.**
Location: `app/api/setup/route.ts:15-22`, `lib/staff-store.ts:51-66`. Claim: `POST /api/setup` is unauthenticated; until the in-memory `firstManagerCreated` flag flips, any network caller can create the bootstrap Manager. No rate limit, no token, no IP allowlist. Tags: security-B6.

**B7 — Health endpoint claims DB ok without checking the DB.**
Location: `app/api/health/route.ts:3-13`. Claim: `/api/health` always returns `database.ok: true` with `adapter: "development-memory"` regardless of any DB state; smoke S2 cannot fail. Tags: quality-M2, rules-B3.

**B8 — Entire data layer is in-memory; Prisma never used.**
Location: `lib/staff-store.ts:33-39`, `prisma/schema.prisma`. Claim: all staff/audit/setup state lives in `globalThis.__p1StaffState`; `@prisma/client` is never imported or instantiated; the Prisma schema is decorative. The P1 merge boundary (deployable shell with migrated DB, seeded identities) is not met. Tags: quality-B3, security-M3.

**B9 — Middleware matcher excludes every mutating endpoint.**
Location: `proxy.ts:11-13`. Claim: even if the file were renamed, the matcher `["/admin/:path*", "/api/admin/:path*"]` does not cover `/api/setup`, `/api/staff`, `/api/staff/[staffId]`, or `/api/audit`; Clerk middleware never executes on the most security-sensitive routes. Tags: security-M2, rules-B2.

### Majors (fix after blockers)

**M1 — Clerk middleware fails open when env vars are missing.** `proxy.ts:5-7`, `lib/env.ts:9-11`. `isClerkConfigured()` false → middleware degrades to `() => NextResponse.next()` (allow-all); `requireProductionEnvironment()` is exported but never called. Tags: security-M1.

**M2 — Impersonation has no actor binding and no end event.** `lib/staff-store.ts:122-128`, `app/api/staff/[staffId]/route.ts:26-30`. `startImpersonation` records only the target email, never the initiator, never an `impersonation_ended` event; no stop-impersonation path. Tags: security-M4.

**M3 — No CSRF protection on state-changing endpoints.** `app/api/setup/route.ts` (POST), `app/api/staff/route.ts` (POST), `app/api/staff/[staffId]/route.ts` (PATCH), `app/api/client-error/route.ts` (POST). No CSRF token, no `Origin`/`Referer` validation. Tags: security-M5.

**M4 — `/api/client-error` is unauthenticated, unbounded, and ignores its advertised token.** `app/api/client-error/route.ts:9-14`, `.env.example:4`. Accepts any message/path and writes to logs; `ERROR_REPORTING_TOKEN` is advertised but never read. Log-injection vector. Tags: security-M6.

**M5 — `maskError` leaks raw error text outside production.** `lib/foundation.ts:26-29`. Masking only applies when `NODE_ENV === "production"`; staging/preview/dev return raw `Error.message`. Tags: security-M7.

**M6 — Route groups `(storefront)`, `(admin)`, `(driver)` missing.** `app/` tree is flat (`app/admin/`, `app/setup/`, `app/api/`, `app/page.tsx`). Plan § P1 requires the three route groups. Tags: quality-M1.

**M7 — Setup lockout is in-memory, resets on restart.** `lib/staff-store.ts:51-66`. `state.firstManagerCreated` is a boolean in memory; a fresh process re-enables setup. R-010/R-130 require a persisted lock. Tags: quality-M3.

**M8 — Staff management UI missing permission-override editor.** `app/admin/staff/page.tsx`. Page exposes only invite/impersonate/revoke; no UI to set per-user grant/deny overrides, though the PATCH endpoint accepts them. Tags: quality-M4.

**M9 — Impersonation banner missing.** `lib/staff-store.ts` (`impersonatingId`), `app/admin/staff/page.tsx`. State is set but no component reads it; no banner renders. R-099 requires banner + audit. Tags: quality-M5, rules-m3.

**M10 — Admin sidebar not permission-gated.** `app/admin/layout.tsx:5-14`. Three static `<Link>`s render to all viewers; no `requirePermission`, no role check. Tags: quality-M6, rules-m2.

**M11 — Admin pages themselves are unprotected.** `app/admin/page.tsx`, `app/admin/staff/page.tsx`, `app/admin/audit/page.tsx`. Server components with no auth gate; combined with B1/B9 the admin shell is fully open. Tags: quality-M7.

**M12 — Customer identity linking not implemented.** `prisma/schema.prisma:46-51`. `CustomerIdentity` model exists but no API/UI/code references it. R-114. Tags: quality-M9.

**M13 — Baseline seed is a stub.** `prisma/seed.ts:1`. Single `console.log`, seeds nothing. R-142. Tags: quality-M10, rules-M2.

**M14 — Self-target blocks missing.** `app/api/staff/[staffId]/route.ts`. No guard preventing a manager from revoking/downgrading themselves. R-119. Tags: quality-M11.

**M15 — Migration harness only string-matches the schema file.** `scripts/migration-harness.ts:3-9`. Reads `schema.prisma` and checks two substrings; no disposable DB, no migrations run, no drift detection. R-141. Tags: rules-M1, quality-m4.

**M16 — Env validation is not enforced.** `lib/env.ts`. `requireProductionEnvironment()` exported but never called; missing env vars do not fail startup. Tags: rules-M3.

**M17 — Dead helpers (Rule of 2 violation).** `lib/foundation.ts`, `lib/settings.ts`. `centsToDollars`, `normalizePhone`, `createPublicId`, `maskError`, `getSetting`, `setSetting` have zero call sites. Tags: rules-M4, quality-m10, cleancode-m2, cleancode-m3.

**M18 — `StaffUser` type duplicated across three locations (drift).** `lib/staff-store.ts:8-16`, `app/admin/staff/page.tsx:5-13`, `prisma/schema.prisma:21-34`. TS copies omit Prisma fields; page copy widens `overrides` key type. Tags: cleancode-M1.

**M19 — `AuditEvent` type duplicated and drifted.** `lib/staff-store.ts:18-24`, `app/admin/audit/page.tsx:5`, `prisma/schema.prisma:59`. Page copy omits `subjectId`; `details` is `string` in TS vs `Json` in Prisma. Tags: cleancode-M2, security-m3.

**M20 — Two parallel persistence patterns for the same entity.** `prisma/schema.prisma:21-69` vs `lib/staff-store.ts:33-39`. Prisma schema + in-memory `globalThis` store with no adapter interface; migration path is a rewrite, not a swap. Tags: cleancode-M3.

**M21 — Role union literal re-declared in four places.** `lib/permissions.ts:9`, `app/api/staff/route.ts:9`, `app/api/staff/[staffId]/route.ts:9`, `app/admin/staff/page.tsx:9`. Adding a role requires touching four files. Tags: cleancode-M4.

### Minors (useful, fix if time allows)

**m1 — `/api/health` discloses required env var names.** `app/api/health/route.ts:11`. Returns `requiredEnvironment: ["DATABASE_URL", ...]` to any caller. Recon aid. Tags: security-m1.

**m2 — `SessionLoginStamp` schema exists but is never written.** `prisma/schema.prisma:63-69`. R-120 control absent in implementation. Tags: security-m2, quality-m7.

**m3 — `normalizePhone` performs no validation.** `lib/foundation.ts:18-20`. Strips non-digits but never validates a 10-digit US number; garbage accepted. Tags: security-m4.

**m4 — `revokeStaff` is irreversible and silently idempotent.** `lib/staff-store.ts:114-120`. Repeat calls re-stamp `revokedAt` and append duplicate audit rows. Tags: security-m5.

**m5 — No shadcn-style kit.** `app/styles.css`, `lib/foundation.ts`. Only CSS vars + `brand` object; no `components/ui`. R-188..R-190. Tags: quality-m1.

**m6 — Global error page is route-level.** `app/error.tsx`. Route error boundary, not root `global-error.tsx`; root layout errors uncaught. Tags: quality-m2.

**m7 — Migration guard is `prisma validate` only.** `scripts/migration-guard.ts:4`. Checks schema syntax, not migration drift. R-140. Tags: quality-m3.

**m8 — CI missing build step.** `.github/workflows/ci.yml:18-22`. Runs lint/typecheck/migration/test but no `npm run build`. Tags: quality-m5.

**m9 — Helper libs incomplete.** `lib/foundation.ts`. Missing season/date helpers; `centsToDollars` is display formatting, not integer money-in-cents math. Tags: quality-m6.

**m10 — Marketing imagery assets missing.** Workspace tree. R-192. Tags: quality-m8.

**m11 — Typed settings store is in-memory only.** `lib/settings.ts:7-11`. Hardcoded module-level object, no DB backing. R-161. Tags: quality-m9.

**m12 — PATCH rejects legitimate partial updates.** `app/api/staff/[staffId]/route.ts`. Runtime guard requires `version`+`role`+`overrides` even though Zod marks them optional; a version-only bump returns 400. Tags: rules-m1.

**m13 — `PermissionEffect` literal re-inlined despite existing export.** `app/api/staff/[staffId]/route.ts:38`, `app/admin/staff/page.tsx:12`. Should import `PermissionEffect`; page copy also drops `Permission` key constraint. Tags: cleancode-m1.

**m14 — `loadStaff` duplicated by initial `useEffect` in same file.** `app/admin/staff/page.tsx:19-30`. Two fetch patterns for `/api/staff` in one component. Tags: cleancode-m4.

**m15 — Vague name: `act` in admin staff page.** `app/admin/staff/page.tsx:43`. `act(staffId, action)` should be `dispatchStaffAction` or similar. Tags: cleancode-m5.

**m16 — Magic numbers duplicated across setup and staff schemas.** `app/api/setup/route.ts:7-8`, `app/api/staff/route.ts:7-8`. `min(2).max(80)` and email schema repeated verbatim. Tags: cleancode-m6.

**m17 — No mobile nav toggle in admin layout.** `app/admin/layout.tsx`. CSS has mobile media query but layout has no mobile nav control. Tags: rules-m2 (notes).

## Notes

- All findings within P1 deliverables; no out-of-phase scope introduced.
- The arm status doc acknowledges the PostgreSQL adapter is not live-tested (dev-memory fallback). B6, B8, M7, M13 are aggravated by that fallback but the route-handler auth gaps (B2–B5, B9) would still apply against a Prisma-backed implementation.
- Security blockers (B2–B6, B9) always survive dedupe regardless of overlap with quality/rules findings.



