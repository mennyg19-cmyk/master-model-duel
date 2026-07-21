# Residual quality review — arm-02 (post self-fix, Test 5)

**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Arm:** `arm-02`
**Tree graded:** `arms/arm-02/workspace/` (post self-fix, full tree)
**Reviewer:** Quality specialist
**Scope:** correctness, broken flows, stubs, missing smoke, regressions vs EXPECTED. Findings only — no fixes.
**Method:** blind review of the post-fix tree only. SELF-REVIEW / SELF-FIX-NOTES / self-review chat were NOT read.

The self-fix pass touched: the registration / email-verification flow (`register`, `register/complete`, `verify-email`, `registration-token`, `auth-forms`, `verify-email-form`), the legacy-import split (`lib/legacy-import.ts` → `lib/legacy-import/{plan,commit}.ts` + route), the Stripe webhook, `lib/checkout/create-order.ts`, `lib/csv.ts`, `lib/env.ts`, and two tests (`exports-csv`, `legacy-plan`).

## Severity summary

| # | Severity | Area | Finding |
|---|---|---|---|
| F1 | Medium | Smoke / coverage | New SR-01 verify-email registration flow has zero smoke and zero unit-test coverage |
| F2 | Low-Med | Auth / rate-limit | `register` endpoint doubles as a sign-in path without the per-account throttle the login endpoint has |
| F3 | Low | Legacy import | `fallbackMethod` dereferences `methods[0].id` with no guard when no fulfillment methods exist |
| F4 | Low | Legacy import | `season.orderCounter` set to imported max with no invariant check (safe only because numbering is per-season + legacy season is CLOSED) |
| F5 | Info | Permissions | Stale "placeholder until ordering phases land" comment on `orders.view` |
| F6 | Info | Checkout | Dead `quote.fees!.ok ?` conditionals in `create-order.ts` after the earlier conflict return |
| F7 | Info | Auth | `register/complete` TOCTOU on the `passwordHash` check; token not single-used (DB state is the real guard) |

No regressions were found in the touched files. No product-code stubs were found (the only `placeholder`/`stub` hits are UI input placeholders or documentation prose).

## Findings

### F1 — Verify-email registration flow is untested (Medium)

The self-fix's headline change — proving email control before attaching a password to an existing passwordless customer (SR-01) — is not exercised by any smoke or unit test.

- New files with no test references:
  - `lib/auth/registration-token.ts` (`createRegistrationToken` / `verifyRegistrationToken`)
  - `app/api/account/register/complete/route.ts`
  - `app/(storefront)/verify-email/page.tsx`
  - `components/account/verify-email-form.tsx`
- A workspace-wide search for `verify-email`, `register/complete`, `pendingVerification`, `createRegistrationToken`, `verifyRegistrationToken` finds only the source files themselves — no `.scratch/*-SMOKE.md` and no `tests/*.ts` references them.
- The closest smoke, P12 S4 ("Imported order repeats through the P10 review page"), only proves the repeat-order bridge for an imported customer; it does not drive the register → `pendingVerification` → emailed link → `/verify-email?token=…` → `register/complete` set-password path.

Why it matters: this is the security-critical control that stops anyone who knows an email from taking over a staff-created / guest-checkout customer record. The HMAC token shape, the 24h TTL, the `register`-purpose HMAC scoping (vs the newsletter token), the `customer.passwordHash` 409 guard, and the `verify-email` page's invalid-token branch are all unverified. The P1 EXPECTED smoke rows (S1–S5) don't cover it either; nothing was added.

### F2 — `register` endpoint is a parallel login path without the per-account throttle (Low-Med)

`app/api/account/register/route.ts:61-68`: when the email already has a `passwordHash` and the supplied password verifies, the handler calls `createCustomerSession` and returns `{ ok: true }` — i.e. a successful sign-in via the **register** endpoint.

- `app/api/account/login/route.ts` enforces a per-IP limit (20/15min) **and** a per-account limit (10/15min) — the A1 brute-force fix.
- `register/route.ts` enforces only a per-IP limit (`register:ip`, 10/15min). There is no per-account throttle on the password-verify branch.

Consequence: the per-account lockout that protects a single account from password guessing can be bypassed by probing through `/api/account/register` instead of `/api/account/login`, which is only constrained by the per-IP bucket. A distributed attacker gains the same per-IP-only protection that A1 was designed to remove. The anti-enumeration shape (identical `pendingVerification` response for wrong-password vs passwordless) is preserved, so this is a rate-limit weakening, not an enumeration leak.

### F3 — `fallbackMethod` can dereference `undefined` (Low)

`lib/legacy-import/commit.ts:195`:

```193:        const methods = await tx.fulfillmentMethod.findMany({ select: { id: true, code: true } });
194:        const methodByCode = new Map(methods.map((method) => [method.code, method.id]));
195:        const fallbackMethod = methodByCode.get("local_delivery") ?? methods[0].id;
```

If `fulfillmentMethod` is empty (no seeded methods), `methods[0]` is `undefined` and `.id` throws synchronously inside the `orders` transaction, aborting the commit with a generic error rather than a readable message. The seeded DB always has methods so this is latent, but the import pipeline is otherwise careful to fail with explicit messages (e.g. the `Legacy season … missing` and `Customer … missing` throws above are guarded by `loadCatalogIds`/`loadCustomerIds`). This one is not.

### F4 — `season.orderCounter` overwritten to imported max with no invariant check (Low)

`lib/legacy-import/commit.ts:236-237`:

```236:        const maxNumber = Math.max(0, ...plan.orders.map((order) => order.orderNumber));
237:        await tx.season.update({ where: { id: seasonId }, data: { orderCounter: maxNumber } });
```

This is safe **only** because (a) the legacy season is created with `status: "CLOSED"` (line 77) and (b) order numbering is season-scoped, so the OPEN season's counter is unaffected. The code does not assert either invariant. If a future change reuses an OPEN season for legacy import, or if order numbers are ever global, this `update` would reset the counter downward and the next finalize would collide with existing numbers. The P12 S3 smoke proves the happy path (counter 108 after import) but not the invariant.

### F5 — Stale placeholder comment on `orders.view` (Info)

`lib/auth/permissions.ts:8`:

```8:  "orders.view": "View orders (placeholder until ordering phases land)",
```

Ordering phases (P4/P5) have landed; the comment is stale. Cosmetic only — the permission itself works.

### F6 — Dead `quote.fees!.ok` conditionals in `create-order.ts` (Info)

`lib/checkout/create-order.ts` returns a conflict at lines 67-73 when `!quote.fees || !quote.fees.ok`, so by the time the transaction runs, `quote.fees.ok` is guaranteed true. Lines 161 and 164 still gate on `quote.fees!.ok ?`:

```161:        feesCents: quote.fees!.ok ? quote.fees!.feesCents : 0,
164:        feeBreakdown: quote.fees!.ok ? quote.fees!.feeLines : undefined,
```

Dead branches; harmless but misleading (they imply the false case is reachable).

### F7 — `register/complete` TOCTOU + non-single-use token (Info)

`app/api/account/register/complete/route.ts:37-50`: `findUnique` → `if (customer.passwordHash) return 409` → `update`. Two concurrent completes with the same token both pass the check and both write the password (last write wins). Both callers hold a valid token, so both proved email control — not a security hole, and the account ends up with exactly one password.

The token itself is not invalidated after use; replay within the 24h TTL is blocked only by the `passwordHash` check (line 41). Acceptable since the DB state is the real guard, but worth noting that the token's TTL is the only thing keeping a leaked-but-unused token live.

## What held up (no regressions)

- **Legacy-import split is clean.** `lib/legacy-import.ts` was deleted; every importer now uses `@/lib/legacy-import/plan` or `@/lib/legacy-import/commit`. No dangling `@/lib/legacy-import` (bare) imports remain. The plan is pure (DB reads for merge targets only); the commit is staged (one `LegacyImportStage` marker per transaction) and resumable, as the P12 S3 smoke proves (interrupt after `customers`, resume skips catalog+customers, completes).
- **Stripe webhook idempotency** is sound: unique `stripeEventId` insert → conditional `updateMany` claim (pending OR stale-processing past the 5-min grace) → `processed` on success. Handlers are retry-safe (`priorCharge`/`isRetry` guards `postPayment`; `recordRefund` is idempotent on `stripeRefundId`; `autoRefund` checks for a prior refund row first). Both sides of an auto-refund are booked so the ledger mirrors Stripe 1:1.
- **`create-order.ts` guest registered-account guard (SR-07)** correctly refuses to attach a guest order to a `passwordHash`/`clerkUserId`-bearing account, while still linking to passwordless staff-created / prior-guest records (same person). Matches the P12 S5 e2e smoke (no regression to guest checkout).
- **CSV formula neutralization** (`lib/csv.ts`) prefixes `= + - @` with a tab, the writer/reader round-trips, and `tests/exports-csv.test.ts` + `tests/csv.test.ts` cover the injection cases and round-trip.
- **Env guards** (`lib/env.ts`) fail-closed for real mode on `SESSION_SECRET` (rejects the public `.env.example` and the dev secret), `STRIPE_WEBHOOK_SECRET` default, half-configured Shippo / Twilio, production `TRUST_PROXY`, and production `RESEND_API_KEY` / `STRIPE_SECRET_KEY`. The `phase-production-build` guard prevents false positives during `next build`.
- **Verify-email page placement** is correct: `/verify-email` lives inside the `(storefront)` group (no route prefix) but outside `/account` (which redirects sessionless visitors at `account/layout.tsx:15`), so the emailed link opens for a logged-out user. The link in `register/route.ts:92` matches (`${env.APP_URL}/verify-email?token=…`).
- **Anti-enumeration** in `register/route.ts`: the wrong-password-on-registered-account branch and the passwordless-account branch both return the identical `{ ok:true, pendingVerification:true }` shape, so the response leaks nothing about which emails have accounts.

## Recommendation

The one finding worth acting on before gating is **F1**: add a smoke (and ideally a unit test for `registration-token.ts` — sign/verify round-trip, tamper, expiry, wrong-purpose HMAC) that drives the full register-against-existing-passwordless-customer flow end to end. F2 is worth a deliberate decision (apply the per-account throttle to the register password-verify branch, or document why it's acceptable). F3–F7 are non-blocking.
