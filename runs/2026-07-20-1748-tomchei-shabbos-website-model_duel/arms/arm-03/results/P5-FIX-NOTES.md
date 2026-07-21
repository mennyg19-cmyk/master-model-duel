# P5 Fix Notes — arm-03

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel  
**Pass:** single fix pass after AGGREGATE-REVIEW-P5  
**Smoke:** `npm run smoke:p5` → **PASS 5/5** (see `PHASE-P5-SMOKE.md`)

## Blockers fixed

| ID | Fix |
|---|---|
| **B1** | `claimWebhookEvent` only treats Prisma `P2002` as replay; other DB errors rethrow → HTTP 500. Meta tracks `processing`/`processed`; unfinished claims are reclaimable so Stripe retries re-run handlers. |
| **B2** | `/api/checkout/mock-complete` gated on `getStripeMode() !== "mock"` only (no `NODE_ENV` bypass). Wrapped with `withPublicGuard` + `loadDraftForAccess` (`draftRef` required; orderId must match). |
| **B3** | Refund apply keyed by `refund_applied:{refund.id}` via the same claim table so `charge.refunded` + `refund.created` cannot double-increment `refundedCents`. |

## Majors fixed

| ID | Fix |
|---|---|
| **M3** | `originAllowed` fail-closed: require matching `Origin` or `Referer`; no bypass when `Sec-Fetch-Site` is null. Smoke sends `Origin`. |
| **M4** | Rate-limit key prefers `dev_user_id` / `__session` cookie; ignores client XFF unless `TRUST_PROXY=1` (then rightmost hop / `x-real-ip`). |
| **M5** (stale_price) | `refreshOrderLinePrices` + prepare `refreshPrices: true`; UI “Refresh prices” button. Detection on start unchanged (S3 still PASS). |
| **M7** (tx) | `prepareCheckout` fulfillment writes in `$transaction`; hosted session row + audit in `$transaction` after Stripe/mock session create. |
| **M10** | `toFeeLines(order)` shared across summary / prepare / start. |
| **M16** | `ZipBlockedError` with `zips`; both prepare and start handle via `instanceof` (no string match). |

## Deferred (per brief)

- M9 `finalize.ts` reformat  
- DECISION-LOG  
- `DEFAULT_COUNTRY` constant  

## Files touched

- `src/lib/payments/webhook.ts`
- `src/app/api/checkout/mock-complete/route.ts`
- `src/lib/http/public-guard.ts`
- `src/lib/checkout/session.ts`
- `src/lib/checkout/delivery.ts`
- `src/lib/checkout/greetings.ts`
- `src/app/api/checkout/route.ts`
- `src/components/checkout/checkout-client.tsx`
- `src/app/(storefront)/checkout/mock-pay/mock-pay-inner.tsx`
- `scripts/smoke-p5.mjs` (Origin header)
