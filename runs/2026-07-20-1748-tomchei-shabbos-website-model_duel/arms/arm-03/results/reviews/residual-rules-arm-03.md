# Test 5 — Residual rules review (arm-03, post-fix)

**Tree:** `arms/arm-03/workspace` (post self-fix)
**Mode:** single (residual reviewer — tree only, did not see self-review chat)
**Rules:** ponytail, clean-code, workflow, vocabulary, codegraph
**Source review:** `arms/arm-03/results/SELF-REVIEW.md` (18 findings: 3 blocker, 9 major, 6 minor)
**Fix notes:** `arms/arm-03/results/SELF-FIX-NOTES.md` (claims 7 fixed)
**Scope:** Findings only — no fixes applied.

## Counts

| Severity | Self-found | Fixed in tree | Residual |
|---|---:|---:|---:|
| blocker | 3 | 3 | 0 |
| major | 9 | 6 | 3 |
| minor | 6 | 1 | 5 |
| **Total** | **18** | **10** | **8** |

Self-found majors+blockers fix rate: **9 / 12 = 75%**.
Post-fix smoke: **5 / 5 PASS** (`PHASE-P12-SMOKE.md`; S3 legacy import now green, was 4/5 pre-fix).

## Verified fixes (in tree, not just claimed)

| Self-review ID | Fix verified |
|---|---|
| SR-B1 | `lib/auth.ts` `getStaffContext` prefers `clerkUserId` match; email match auto-links only when `clerkUserId` is null; unequal bound id → deny. |
| SR-B2 | `api/driver/[token]/route.ts` GET returns `{ linkId, pinRequired, unlocked:false }` until `isMagicPinUnlocked`; full stops only after unlock. |
| SR-B3 | `lib/stripe/client.ts` `getStripeMode` throws in production for mock/missing keys; `api/checkout/mock-complete` 404s in production. |
| SR-M1 | `admin/routes/page.tsx` and `[id]/page.tsx` call `requireAdminPage("admin.access")`. |
| SR-M2 | `lib/payments/webhook.ts` branches `refund.created` (Refund) vs `charge.refunded` (Charge → iterates `refunds.data` with correct refund id/amount). |
| SR-M3 | `middleware.ts` `isDevAuthBypass()` requires `NODE_ENV !== "production"`. |
| SR-M4 | `lib/orders/guest-token.ts` `guestDraftCookieOptions` sets `secure` from `NODE_ENV===production \|\| APP_URL.startsWith("https://")`. |
| SR-M6 | `lib/orders/finalize.ts` reformatted to single-spaced TS (248 lines, was ~500 double-spaced). |
| SR-M9 | `lib/routes/service.ts` `hashPin` uses scrypt + per-hash salt (`scrypt$<salt>$<hash>`); `verifyPinHash` accepts legacy SHA-256 for migration. |
| SR-m2 | `lib/stripe/client.ts` `verifyWebhookSignature` rejects `\|now - t\| > 300s`. |

## Residual findings (post-fix tree)

### Major residuals (3)

| ID | Location | Finding |
|---|---|---|
| RR-M1 | `src/lib/http/public-guard.ts` (SR-M5) | Rate limits still process-local `Map`s with a single shared `"anon"` identity. Multi-instance deploys reset counters per isolate; one noisy client exhausts the shared anon bucket. Skipped as infra (shared store / edge limits) — agreed debt. |
| RR-M2 | `src/lib/routes/service.ts` (SR-M7) | 965-line god file mixing geocode, route build, magic links, PIN throttle, notify, print PDF, nearby suggestions, reroute/void. Exceeds clean-code >500 / mixed-concerns. Skipped as large no-behavior refactor. |
| RR-M3 | `src/lib/ops/import.ts` (671), `src/lib/ops/repeat.ts` (665), `src/lib/orders/drafts.ts` (540), `src/lib/checkout/session.ts` (531), `src/lib/ops/print-batch.ts` (513) (SR-M8) | Five more modules over the >500-line / mixed-concerns threshold. Skipped as a set. |

### Minor residuals (5)

| ID | Location | Finding |
|---|---|---|
| RR-m1 | `.env.example` (SR-m1) | Still ships concrete dev secrets (`NEWSLETTER_HMAC_SECRET=tomchei-arm03-…`, `CRON_SECRET=tomchei-arm03-…`, `whsec_mock_dev_only`, mock Stripe key). Dev-only but easy to copy verbatim into a real deploy. Should be `<set-me>` placeholders. |
| RR-m2 | `src/lib/ops/settings-keys.ts`; `src/lib/ops/test-ops.ts` (SR-m3) | `TestModeSetting` type defined in both files. Drift risk. |
| RR-m3 | `src/app/api/client-error/route.ts` (SR-m4) | Public POST logs client errors with no rate-limit / origin guard — log spam vector. |
| RR-m4 | `src/components/admin/imports-client.tsx` (SR-m5) | `MESSY_ORDERS` fixture CSV + "Bad Row" seed text still embedded in the shipped admin client bundle. |
| RR-m5 | `src/lib/ops/prior-year-stub.ts`; ORDERS path in `src/lib/ops/import.ts` (SR-m6) | `seedImportedPriorYearOrder` stub still creates a prior-year paid order directly; real `ImportKind.ORDERS` stage+commit not exercised end-to-end by smoke. |

### Process / hygiene findings (residual reviewer, tree-only)

| ID | Finding |
|---|---|
| RR-P1 | **Self-fix notes undercount the fixes.** `SELF-FIX-NOTES.md` lists 7 fixed items but the tree shows 10 (B3 Stripe-mock fail-closed, M4 guest-cookie `secure`, M9 PIN scrypt KDF were also fixed but omitted from the notes). Auditability of the self-loop is reduced. |
| RR-P2 | **Self-fix note IDs drift from self-review IDs.** The notes renumber findings (e.g. notes-"SR-B1" = review-SR-B2 magic-link PII; notes-"SR-M2" = review-SR-B1 getStaffContext; notes-"SR-M5" = review-SR-M3 middleware; notes-"SR-M6" = review-SR-m2 webhook timestamp; notes-"SR-M7" = review-SR-M6 finalize). A reviewer cannot map note → review finding without re-reading both. |
| RR-P3 | **`verifyPinHash` legacy SHA-256 fallback** (`lib/routes/service.ts:55`) keeps weak unsalted `pin:${pin}` hashes valid until each route is re-saved. Acceptable as a migration bridge, but no re-hash-on-unlock path was added — weak hashes persist indefinitely. |
| RR-P4 | **Driver GET still loads full stops before redaction.** `loadMagicLinkSession(token)` reads the full stop rows from the DB before the PIN-unlock check redacts the response. PII is not leaked to the client, but is materialized in memory on every unauthenticated GET. Low impact; note for a future short-circuit. |
| RR-P5 | **Middleware `isDevAuthBypass()` evaluated twice** per request (once inside `clerkHandler`, once in the `middleware` wrapper). Cheap, but redundant. |

### Regressions introduced

None observed. Post-fix `npm run ci` green and `smoke:p12` 5/5 (per `SELF-FIX-NOTES.md`); S3 legacy import moved from FAIL to PASS. No new blocker/major introduced by the fix pass; the items above are carry-over debt, not regressions.

## Rule-by-rule residual adherence

| Rule | Adherence | Notes |
|---|---|---|
| ponytail | **Partial** | Ladder held (scrypt via stdlib, no new deps). God files (RR-M2/M3) and dead-code-adjacent fixtures (RR-m4) keep it partial. |
| clean-code | **Partial** | All 3 blockers closed. Residual: one-pattern-per-concern (RR-M2/M3 god files), type/schema drift (RR-m2), swallowed-error-adjacent (RR-m3), anti-AI-tics (RR-m4 fixtures in bundle), consistency (RR-m1 env placeholders). |
| workflow | **Pass (with caveat)** | Gate discipline held (P12 status + smoke written, refunds idempotent). Caveat: self-fix notes inaccurate (RR-P1/P2) — process hygiene slip on the self-loop. |
| vocabulary | **N/A** | No refactor/tidy/rebuild commands in the fix pass. |
| codegraph | **N/A for product** | Index healthy; this review used Read + Grep over the post-fix tree (literal/string lookups for PIN, env, and route guards). |

## Net

All three self-found blockers are closed in the tree and smoke is 5/5 green. The residual is 3 majors (all agreed debt: shared rate-limit store + six god files over 500 lines) and 5 minors (env placeholders, dup type, unguarded client-error log, embedded fixtures, stub-vs-real ORDERS path). No regressions from the fix pass. The one substantive process gap is that `SELF-FIX-NOTES.md` undercounts and re-IDs the fixes — three real fixes (B3, M4, M9) landed in the tree without being recorded, and the note IDs do not map back to the self-review IDs.
