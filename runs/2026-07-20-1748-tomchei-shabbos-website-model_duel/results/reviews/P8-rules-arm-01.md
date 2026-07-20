# P8 Rules Review — arm-01

Reviewer specialist: Rules. Scope: adherence to this arm's selected catalog rules only (`ponytail`, `clean-code`, `workflow`, `vocabulary`, `codegraph`, `grill-protocol`). Findings only, no fixes. Blind to model identity.

Tree: `arms/arm-01/workspace/` · Phase: P8 (Shipping: Shippo, margin, labels).

## Summary

| Severity | Count |
|---|---|
| High | 0 |
| Medium | 3 |
| Low | 5 |
| Info | 2 |
| **Total** | **10** |

No `High` rule violations. The Shippo wrapper is accurate against current Shippo docs (`Authorization: ShippoToken <token>` confirmed), no new dependency was added (raw `fetch` — ponytail ladder satisfied), no god files (>500 lines), no narration comments, no swallowed errors. Issues cluster around duplicated margin math, nesting, and dead config.

## Findings

### M1 — Duplicated margin math across three sites (clean-code: duplicated logic)
`selectShippingMargin` in `src/domain/shipping.ts:28` owns charged/purchased/margin, but the fulfillment page and order-detail page re-derive it inline with `Math.max/Math.min` spreads over `shippingQuotes` instead of calling the domain helper. Rule of 2 is met (3 call sites) — extract a shared `summarizeQuotes(quotes)` helper.

- `src/app/(admin)/admin/fulfillment/page.tsx:121-138`
- `src/app/(admin)/admin/orders/[orderId]/page.tsx:71-79`

### M2 — Display margin diverges from stored margin (clean-code: type/schema drift, single source of truth)
Both pages compute max/min over **all** `shippingQuotes` without the carrier-eligibility + USD filter that `selectShippingMargin` applies (`src/domain/shipping.ts:29-34`). A non-USD or non-eligible quote would make the displayed `quoteSummary.marginCents` differ from the `marginCents` persisted on `ShippingLabel`. Latent today (the provider only returns filtered USD rates), but the display is not bound to the stored value.

### M3 — `planShipment` exceeds 3 levels of nesting (clean-code anti-AI-tics)
`src/domain/shipping.ts:57-104` reaches 4 levels: `for` → `planned.find(box => { if (...) { return (... && ...) } })`. Rule: "If a function has more than 3 levels of nesting, refactor it." The `existing` lookup callback is the deepest path.

### L1 — Duplicated product-dimensions guard (clean-code: duplicated logic)
The block `if (!product.widthMm || !product.heightMm || !product.depthMm || !product.weightGrams) throw new Error(\`${product.name} needs dimensions and weight before shipping.\`)` is duplicated verbatim in `loadPackagePlan` (`src/domain/shipping.ts:178-180`) and `quoteDraftShipping` (`src/domain/shipping.ts:452-454`). Extract a `toShipmentProduct(product, quantity)` helper.

### L2 — Eligible-carrier list duplicated (clean-code: magic values + duplicated logic)
`["fedex","ups","usps"]` is hardcoded in two places: `src/lib/shippo.ts:121` (rate filter) and `src/domain/shipping.ts:31` (margin eligibility). Two sources of truth for "eligible carriers" — drift risk. Hoist to a named constant.

### L3 — Declared-but-unused provider env (clean-code: "no 'just in case' code")
`SHIPPO_FEDEX_ACCOUNT_ID` and `SHIPPO_UPS_ACCOUNT_ID` are declared in `src/lib/env.ts:7-8` and `scripts/generate-env-example.mjs:25-26` / `.env.example:23-24`, but `ShippoProvider.getRates` never sends `carrier_accounts`/subaccounts to Shippo. Every line must have a reason; these have no consumer. (Note: this also leaves the P8 line-1 intent "org FedEx + UPS accounts" unfulfilled — phase-scope, not a rules finding, but flagged for the phase reviewer.)

### L4 — Magic value for rate TTL (clean-code: magic values)
`src/lib/shippo.ts:131` — `expiresAt: new Date(Date.now() + 20 * 60 * 1000)`. The 20-minute quote lifetime is an unnamed magic number. Name it (e.g. `QUOTE_TTL_MS`) and colocate with the eligibility constant from L2.

### L5 — Flat 409 for all shipping-route failures (clean-code: error-handling consistency)
`src/app/api/admin/shipping/route.ts:58-66` maps every non-`AccessDeniedError` to HTTP 409, including Shippo outages and Prisma `P2025` not-found. 409 "Conflict" is wrong for transient/provider failures. One error-handling approach is good; the status mapping is not.

### I1 — `quoteDraftShipping` return type drifts from domain Map convention (clean-code: consistency)
`src/domain/shipping.ts:421-484` returns `Record<string, number>`; both callers wrap it via `new Map(Object.entries(...))` (`src/app/api/checkout/stripe/route.ts:141`, `scripts/p8-smoke.ts:262`). The rest of the domain passes `ReadonlyMap<string, number>`. Return a `Map` directly.

### I2 — `checkout-form.tsx` casts untrusted JSON (clean-code: consistency)
`src/components/checkout-form.tsx:61` — `const typedPayload = payload as CheckoutPayload;` is a compile-time assertion on `any` from `response.json()` with no runtime validation, while the project's established pattern is zod (used in the sibling route handler). One validation pattern per project.

## Not flagged (verified clean)

- Shippo auth scheme `ShippoToken` — confirmed against current Shippo docs.
- No new package added for Shippo — raw `fetch` (ponytail ladder rung 2/3).
- No god files; `shipping.ts` is 485 lines (under 500).
- No narration/change-explanation comments; no swallowed errors; no empty catch blocks.
- UI reuses existing CSS-var theme (`--surface`, `--muted`, `--brand-dark`, `--ink`); back navigation via `BackLink` with fallback.
- `.env.example` carries placeholders for every new secret; `.env*` gitignored (workflow § Security Basics).
- Smoke (`scripts/p8-smoke.ts`) verifies in the running app (seeds data, exercises quote→buy→void→rebuy→track→validate→render), satisfying workflow "verify in the running app."
