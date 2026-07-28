# P3 FIX NOTES — arm-06 (Test 4 fix pass)

**Date:** 2026-07-28 · **Source list:** `results/AGGREGATE-REVIEW-P3.md` (B1, M1–M8, m1–m21)
**Result:** B1 + 8/8 majors + 20/21 minors fixed; 1 deferred (m9), 1 partial (m11).
**Verification:** lint · typecheck · migration-guard (6 migrations) · test:unit (P3 helpers 51, permissions 19) · test:domain · build — all green. Smoke S1–S5 re-run end-to-end (23 + 36 checks incl. new regression probes) plus a live rate-limit probe — transcript in `workspace/.scratch/PHASE-P3-SMOKE.md`.

---

## Blocker

### B1 — No P3 smoke evidence; phase gate cannot close — FIXED
Refreshed `workspace/.scratch/PHASE-P3-SMOKE.md` and `workspace/.scratch/PHASE-P3-STATUS.md` with a full post-fix re-run: fresh `npm run build`, restart on 3106, `smoke-p3.ps1` (23 checks) + `smoke-admin-crud.mts` (36 checks) transcripts inline, state restored after. The quality/rules contradiction noted in the aggregate is resolved by the current files.

## Majors

### M1 — subscribe leaks HMAC token — FIXED
`app/api/subscribe/route.ts` returns only `{ ok: true }`; tokens are minted server-side only (the P11 email path delivers the manage link). `components/storefront/subscribe-form.tsx` copy updated ("link arrives by email"). Smoke: `.scratch/smoke-db.mts newsletter-token <email>` mints a token identically server-side so S4 still exercises the full round-trip, and `smoke-p3.ps1` S4a now asserts the response carries no token.

### M2 — role change without rank check — FIXED
New `canManageStaffRole(actorRole, targetRole)` in `lib/permissions.ts` (rank-checked on roles, so a `staff.manage` GRANT is never a takeover path). `app/api/admin/staff/[id]/route.ts` rejects role changes targeting accounts above the actor and assignments above the actor's own rank. Unit-tested in `scripts/test-permissions.mts`; live probes in `smoke-admin-crud.mts` (fixture STAFF + `staff.manage` grant → demote MANAGER = 403).

### M3 — overrides had no self-target block — FIXED
Same PATCH route: override writes now require `canTargetStaff` (self = 400) and a rank check against the target (403). Live probes cover both.

### M4 — staff create + revoke without rank check — FIXED
`app/api/admin/staff/route.ts` POST refuses to create a role above the actor's rank; `app/api/admin/staff/[id]/revoke/route.ts` refuses to revoke an account above the actor's rank. Live probes: create-MANAGER = 403, revoke-MANAGER = 403.

### M5 — product create deadlocks on slug collision — FIXED
`product-form.tsx` exposes an optional "Custom slug" field in create mode (hint explains the 409 escape); the POST route already accepted `slug`. Probe: same-name product with explicit slug → 201.

### M6 — add-on options differ create vs edit — FIXED
`products/new/page.tsx` and `products/[id]/page.tsx` now use the same rule: active add-ons **plus** any already-attached inactive ones (labeled "inactive" in the UI, `AddOnOption.active`), so create and edit enforce one trust boundary without orphaning existing restrictions.

### M7 — scalar PATCH wipes restrictions — FIXED
`api/admin/products/[id]/route.ts`: omitted `addOnIds` now maps to `null` (preserve); only an explicit `[]` clears. Probes: scalar PATCH omits → restrictions preserved; scalar PATCH with `[]` → cleared.

### M8 — duplicated image + glyph — FIXED
New shared `components/product-image.tsx` (`ProductImage` + exported `PackageGlyph`, single home of the intentional plain-`<img>` decision). Adopted at all five render sites: `packages-grid.tsx`, `past-collections/page.tsx`, `packages/[slug]/page.tsx`, `admin/products/[id]/page.tsx`, `admin/media/media-manager.tsx`.

## Minors

### m1 — subscribe not rate-limited — FIXED
New `lib/rate-limit.ts` (fixed-window, per-IP, in-memory; documented as a speed bump). Subscribe: 10/min. Live probe: 429 after window quota.

### m2 — delivery-check enumerates allowlist — FIXED
Same limiter: 60/min per IP. Live probe: 429 after window quota.

### m3 — upload trusts declared content-type — FIXED
`lib/media/validation.ts` `sniffImageType` matches magic bytes (PNG/JPEG/GIF/WEBP) against the declared type; mismatch → 400. Unit tests (6) + live probe (PNG bytes as JPEG → 400).

### m4 — DEV_AUTH_BYPASS without prod guard — FIXED
`lib/env.ts` `isProductionDeploy` (VERCEL_ENV=production) hard-disables the bypass regardless of the flag; `env-spec.ts` description updated. Local dev/smoke behavior unchanged.

### m5 — demotion keeps overrides — FIXED
A `role` PATCH that omits `permissionOverrides` now clears overrides to pure role-derived permissions (audit-logged); explicit override patches are untouched. Probe: manager demotes fixture → overrides empty.

### m6 — middleware redirects to 404 dev-login — FIXED
`middleware.ts`: unauthenticated `/admin` redirects to `/dev-login` only when the bypass is actually usable (flag on, non-prod deploy); otherwise to `/`.

### m7 — README "this season" claim — FIXED
README impact-bar wording corrected to cumulative counts (matches code).

### m8 — `addRate` bypasses `dollarsToCents` — FIXED
`settings-tabs.tsx` uses `dollarsToCents`; fractional cents are now rejected like everywhere else.

### m9 — MediaManager raw `fetch` for assign/delete — DEFERRED
Both calls already parse and surface the server's error message inline; the only deviation is not going through `apiFetch`. Converting is cosmetic, and the upload call legitimately stays raw (multipart), so the file keeps one style either way. Deferred to avoid churn with zero behavior change.

### m10 — `uploadedById` no FK — FIXED
`schema.prisma`: `MediaAsset.uploadedBy → StaffUser` relation (`ON DELETE SET NULL`); migration `20260728200500_p3_fix_media_uploaded_by_fk` applied; migration-guard passes (6 migrations).

### m11 — quick-view dialog a11y — PARTIAL
Focus is trapped inside the dialog on open, Tab cycles within it, and Escape closes (`packages-grid.tsx`, dialog extracted to its own component). Roving arrow-key navigation across the product grid deferred — the grid is a flat button list, already fully keyboard-sequential.

### m12 — backwards replacement links — FIXED
Editor lists only strictly newer-season products as replacement targets; PATCH route enforces direction server-side (400 on backwards/self links). Probe: current→2025 link rejected.

### m13 — dead branch in `priceLabel` — FIXED
Simplified: "from" prefix is driven by option presence only; impossible disjunct removed.

### m14 — closed-banner circular copy — FIXED
`(storefront)/layout.tsx`: with zero closed seasons the banner no longer points at the empty archive; copy varies by closed-season count.

### m15 — vague `note(result)` — FIXED
Renamed to `reportSaveResult(saveResult, …)` in `settings-tabs.tsx`.

### m16 — vague `data` param — FIXED
`lib/hmac.ts`: `hmacSha256(secret, message)`.

### m17 — vague `data` variable — FIXED
`api/admin/addons/[id]/route.ts`: `updateFields`.

### m18 — vague `result` state — FIXED
`checkout/zip-check-form.tsx`: `deliveryResult`.

### m19 — vague `item` loop var — FIXED
`components/admin/sidebar.tsx`: `navItem`.

### m20 — delete swallows all fs errors — FIXED
`lib/media/storage.ts`: the idempotent-delete catch now tolerates only `ENOENT`; other failures (EACCES/EBUSY) propagate.

### m21 — settings POST swallows error — FIXED
`api/admin/settings/route.ts`: catch logs the underlying error server-side before returning the generic 400.

---

## Test & smoke changes

- `scripts/test-p3.mts`: +12 checks (magic-byte sniffer ×6, rate limiter ×6) → 51 total.
- `scripts/test-permissions.mts`: +5 `canManageStaffRole` checks → 19 total.
- `.scratch/smoke-p3.ps1`: S4a asserts subscribe returns no token (M1).
- `.scratch/smoke-db.mts`: `newsletter-token` command (server-side token mint for S4).
- `.scratch/smoke-admin-crud.mts`: +17 regression probes (M2–M5, M7, m3, m5, m12) using a live fixture STAFF account with a `staff.manage` GRANT; cleanup now removes all `smoke-`-prefixed fixtures.
- Live rate-limit probe transcript recorded in `PHASE-P3-SMOKE.md`.
