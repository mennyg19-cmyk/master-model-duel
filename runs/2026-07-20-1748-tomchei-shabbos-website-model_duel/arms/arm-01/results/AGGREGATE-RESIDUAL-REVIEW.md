# Aggregate Residual Review — arm-01 (Test 5)

**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Arm:** arm-01
**Phase:** Test 5 residual (post self-fix, full tree)
**Inputs:** residual-security / residual-quality / residual-rules / residual-clean-code (arm-01)
**Method:** Union + dedupe by location+claim. No new findings. Security High → Blocker; Medium → Major; Low/Info → Minor.

## Counts

| Class | Count |
|---|---|
| BLOCKERS (High) | 3 |
| MAJORS (Medium) | 14 |
| MINORS (Low/Info) | 25 |
| **Total** | **42** |

Dedup merges (3 pairs collapsed):
- `x-real-ip` throttle: security L-1 + quality #3 (same `src/lib/public-request.ts:27`) → kept at Medium.
- env-access drift: rules R5 + clean-code M3 (same `src/lib/env.ts` + direct `process.env` reads) → Medium.
- magic values / inline time windows: rules R3 + clean-code L5 (overlapping `delivery.ts` magic-value claims) → Low.

## BLOCKERS

1. **CC-H1** — God file `src/domain/legacy-import.ts` (469 lines, mixed concerns: zod schema, doc inspection, staging, commit migration). clean-code §Abstraction Discipline.
2. **CC-H2** — Duplicated finalize-order flow in `src/domain/checkout.ts` (`commitStripePayment` 252–367 vs `finalizePosOrder` 369–415 share ~30-line preamble). clean-code §Duplicated logic.
3. **CC-H3** — Divergent admin route error handling (3 conventions: inline 409-catch-all in `delivery/route.ts`, `permissionError` helper in `staff/route.ts`, `adminRequestErrorResponse` in `lib/admin-request.ts`). clean-code §Consistency.

## MAJORS

1. **SEC-M-1** — Inconsistent CSRF / same-origin guard across admin mutation endpoints; `requireSameOriginAdminRequest` applied to only 5 routes.
2. **SEC-M-2** — Test-auth trust boundary rests on spoofable `Host` header + `__local_manager__` magic identity (`src/lib/auth.ts:29-56`).
3. **SEC-M-3** — `admin:view` (base STAFF) grants full draft + customer address-book read/write via `findAccessibleDraft` short-circuit (`src/lib/customer-access.ts:38-48`).
4. **SEC-M-4** — Staff invitation acceptance does not bind accepting Clerk identity to invited email (`POST /api/staff/accept-invite`).
5. **QUAL-1** — Random `draftReference` on `@unique` column → birthday-paradox 500s (`src/app/api/order/drafts/route.ts:86`).
6. **QUAL-2** — Stripe refund issued inside serializable DB transaction → reconciliation drift on rollback (`src/app/api/admin/orders/[orderId]/refunds/route.ts:51-65`).
7. **MERGED (SEC-L-1 + QUAL-3)** — Public throttle keyed on spoofable `x-real-ip` with shared `unknown` fallback (`src/lib/public-request.ts:27`).
8. **RULES-R1** — God file `src/domain/delivery.ts` (641 lines, 5 concerns: routing, driver auth, geocoding, fulfillment switching, pickup lifecycle). clean-code + ponytail §God files.
9. **CC-M1** — Address-snapshot parsing duplicated (`addressText` in `delivery.ts:30-46` vs `snapshotAddress` in `shipping.ts:116-130`).
10. **CC-M2** — `sha256` token-hash pattern repeated three ways (`delivery.ts`, `staff/route.ts:66`, `legacy-import.ts:222-224`); no shared `sha256Hex` helper.
11. **MERGED (CC-M3 + RULES-R5)** — Environment access drift: `lib/env.ts` typed accessor vs direct `process.env` reads; `ServerEnvironment` type incomplete.
12. **CC-M4** — Bulk "applied/conflicts" loop duplicated across `repeat-orders.ts`, `package-operations.ts` (4 call sites, 3 modules).
13. **CC-M5** — Duplicated UI blocks: package selects in `fulfillment-board.tsx:249-272`, address pickers in `order-builder.tsx:446-483`, inline `post()` helper.
14. **CC-M6** — Smoke-script boilerplate duplicated across `p4-smoke.ts`…`p12-smoke.ts` (env loader, `managerHeaders`, drifting `authSecret` default).

## MINORS

**Security (Low/Info):**
- **SEC-L-2** — `/api/setup` setup-token comparison not constant-time (`src/app/api/setup/route.ts:31`).
- **SEC-L-3** — Cron routes use GET for state-changing operations (5 cron handlers).
- **SEC-L-4** — `constructStripeEvent` falls back to hardcoded dummy Stripe key (`src/lib/stripe.ts:21`).
- **SEC-L-5** — No central auth gate (no `middleware.ts`); per-route enforcement only.
- **SEC-L-6** — Impersonation session id is DB row id (cuid), not high-entropy signed token.
- **SEC-L-7** — Guest draft access token grants address-book CRUD beyond the single draft.
- **SEC-L-8** — Newsletter preference URL falls back to `http://127.0.0.1:3101` when `APP_URL` unset.
- **SEC-I-1** — `POST /api/order/drafts` `posCustomerId` branch no try/catch + no rate limit (uncaught 500).
- **SEC-I-2** — Local secrets present in workspace tree (`.scratch/`, `.env`) — gitignored, archive-leak risk.

**Quality (Low):**
- **QUAL-4** — Bulk repeat TOCTOU on source-order version (no `SELECT … FOR UPDATE`) (`src/domain/repeat-orders.ts:428-434`).
- **QUAL-5** — `stampPickup` missing `isPickup` guard; redundant expiry condition (`src/domain/delivery.ts:582-590`).
- **QUAL-6** — `findNearbyShippingPackages` same-street heuristic fragile (first-token strip) (`src/domain/delivery.ts:459-461`).
- **QUAL-7** — Outbox sweep no-ops within same minute (minute-granular run key) (`src/app/api/cron/message-outbox/route.ts:9-12`).
- **QUAL-8** — Shippo label purchase holds row locks across network call (`src/domain/shipping.ts:300-302`).
- **QUAL-9** — `seedScaleFixture` packageLine index parsing convention-fragile (`src/domain/test-console.ts:120`).

**Rules (Low):**
- **RULES-R2** — Borderline god files at 500-line threshold (`order-builder.tsx` 542, `shipping.ts` 502).
- **MERGED (RULES-R3 + CC-L5)** — Magic values / inline time windows (`delivery.ts` geocode TTL x2, pickup expiry, earth radius, PIN lockout; `staff/route.ts:55` invite expiry).
- **RULES-R4** — Banned standalone name `result` (4 occurrences: `shipping.ts:272`, `catalog/route.ts:166`, `payments/route.ts:46,96`).
- **RULES-R6** — Floating dependency range `@vercel/blob: "^2.6.1"` (only unpinned dep).

**Clean-code (Low/Info):**
- **CC-L1** — Empty placeholder route/page files (21 zero-byte files UI references → silent 404s).
- **CC-L2** — Repeated Tailwind input/select class string across admin components.
- **CC-L3** — `countDocument` / `superRefine` reductions duplicated in `legacy-import.ts`.
- **CC-L4** — `importedTotals` recomputed in `commitLegacyImport` (`legacy-import.ts:450-456`).
- **CC-I1** — `Response.json` vs `NextResponse.json` mismatch between `public-request.ts:78` and `admin-request.ts:28`.
- **CC-I2** — `fulfillmentFees` re-export shape; zod enum derived via `Object.keys` (fragile).

## Notes

- All findings sourced from the four residual inputs; no new findings introduced during aggregation.
- Severity→class mapping per orchestrator instruction: High → Blocker, Medium → Major, Low/Info → Minor.
- Where two reviewers rated the same location+claim at different severities (x-real-ip throttle: Low vs Medium), the higher severity was retained (Medium → Major) and the lower entry collapsed.
