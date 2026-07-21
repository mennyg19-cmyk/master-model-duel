# P8 Security Review — arm-03 (blind)

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Arm:** arm-03
**Phase:** P8 — Shipping: Shippo, rate margin, labels
**Reviewer:** external, security specialist
**Scope:** trust boundaries, auth, secrets, IDOR, injection
**Mode:** findings only — no fixes

## Surface reviewed

- `src/lib/shippo/client.ts` (rate/buy/void/track/validate, env handling)
- `src/lib/shipping/labels.ts` (create/void/refresh, audit)
- `src/lib/shipping/margin.ts` (charge-high / buy-low selection)
- `src/lib/shipping/checkout-rates.ts` (live Shippo at checkout)
- `src/lib/shipping/bin-packing.ts` (package planning)
- `src/app/api/admin/orders/[id]/labels/route.ts`
- `src/app/api/admin/packages/[id]/label/route.ts`
- `src/app/api/checkout/route.ts` + `src/lib/checkout/session.ts`
- `src/lib/auth.ts`, `src/lib/permissions.ts`, `src/middleware.ts`
- `src/lib/http/public-guard.ts`, `src/lib/orders/draft-access.ts`
- `src/lib/audit.ts`, `src/lib/api-error.ts`, `src/lib/result.ts`
- `.env`, `.env.example`, `.gitignore`

## Findings

| ID | Severity | Location | Claim | Evidence |
|---|---|---|---|---|
| P8-S-01 | major | `src/lib/shipping/labels.ts` (LabelError throw sites: `createLabelForPackage` L109/124, `voidLabelForPackage` L229; routes `orders/[id]/labels/route.ts` L84-86, `packages/[id]/label/route.ts` L82-84) | Raw upstream Shippo error text is returned to the client. `LabelError` is caught in a dedicated branch that returns `error.message` verbatim with the LabelError status, bypassing `apiErrorResponse`/`maskError`. The Shippo client throws `Shippo ${path} failed (${res.status}): ${text.slice(0, 200)}` (`client.ts:156`) — raw upstream response body. This leaks Shippo request/response detail (status codes, validation messages, account hints) to the API caller even in production, where `maskError` would otherwise have hidden internals. | `client.ts:154-157` builds the raw-text error; `labels.ts:109` re-throws `error.message` as LabelError; both label routes return `error.message` directly for `LabelError`. `apiErrorResponse` (which calls `maskError` for non-Auth/non-Zod errors in production) is never reached for LabelError. |
| P8-S-02 | minor | `src/app/api/admin/orders/[id]/labels/route.ts` L15-17, 62-82 | Missing object-level binding: `create`/`void` actions take `packageId` from the body and pass it to `createLabelForPackage`/`voidLabelForPackage` without verifying the package belongs to the order `id` in the URL. The URL `id` is decorative for these actions. | `bodySchema` only constrains `packageId: z.string().min(1)`; `createLabelForPackage` (`labels.ts:61`) loads the package by id alone and never references the route's orderId. An admin can target any package via this order-scoped endpoint. |
| P8-S-03 | minor | `src/app/api/checkout/route.ts` L36-49 → `src/lib/checkout/session.ts` `buildCheckoutSummary` L143-225 → `resolveDeliveryFeesLive` | Public GET `/api/checkout?draft=` triggers live Shippo rate quotes with no rate limit and no origin check. `buildCheckoutSummary` calls `resolveDeliveryFeesLive`, which calls `quoteMargin` → `getRates` (live `POST /shipments/`) per unique ship destination. The GET handler relies only on `loadDraftForAccess`; it does not pass through `withPublicGuard` (origin + rate limit) the way POST `prepare`/`start` do. | `route.ts` GET branch has no `withPublicGuard`; POST branches use it (L57, L81). A principal holding a valid draftRef can repeatedly trigger live Shippo calls outside the 30/20-per-minute limits. |
| P8-S-04 | minor | `src/lib/shipping/checkout-rates.ts` L88-114 | Unbounded destination fan-out: one checkout prepare/summary call issues a separate Shippo rate quote for every unique SHIP destination in the draft, with no cap on destination count. | Loop `for (const [key, line] of shipDestinations)` calls `quoteMargin` per destination; no `maxDestinations` guard. A draft with N distinct ship addresses ⇒ N live Shippo API calls per request, compounding the cost-amplification in P8-S-03. |
| P8-S-05 | minor | `src/lib/shippo/client.ts` L253-263 (`voidLabel`) | `transactionId` is interpolated into the request path without URL-encoding: `/transactions/${transactionId}/refund/`. | `client.ts:258`. Not client-controllable today (id originates from Shippo `object_id` stored after `buyLabel`), so not exploitable, but defensive `encodeURIComponent` is missing — a path-injection footgun if the source ever shifts. |
| P8-S-06 | minor | `src/lib/http/public-guard.ts` L8-53 | Rate limiter is process-local (in-memory `Map`) and per-instance; in a multi-instance/serverless deploy the effective limit is multiplied by instance count. With `TRUST_PROXY=1` and XFF rotation, the anonymous bucket can also be evaded. | `buckets = new Map<string, Bucket>()` at module scope; `rateLimitIdentity` falls back to a single `"anon"` bucket absent a session cookie, and only trusts XFF when `TRUST_PROXY=1`. |
| P8-S-07 | minor | `src/app/api/admin/orders/[id]/labels/route.ts` L18-29 (`validate` branch) | The `validate` action forwards a client-supplied address to Shippo with `z.string()` and no max-length bounds on any field (name/street1/street2/city/state/zip/country). | `bodySchema` validate branch uses `z.string()` for all address fields (no `.max()`). Admin-gated, but allows arbitrarily large payloads to be relayed to the Shippo `/addresses/` endpoint. |
| P8-S-08 | info | `src/lib/shippo/client.ts` L84-85 (`getShippoEnv`) | `UPS_CLIENT_ID` / `UPS_CLIENT_SECRET` are read from env into `ShippoEnv` but never transmitted anywhere in P8 (R-184 declaration-only). No leak; flagged only so the unused-load is on record before a future phase wires them up. | `ShippoEnv.upsClientId/upsClientSecret` typed and populated; no call site references them. |

## Notes (not findings)

- **Secrets hygiene:** `.env*` is gitignored (`.gitignore:34`); `.env` is untracked (git status `??`). `.env.example` carries only placeholders. `SHIPPO_API_TOKEN` is sent solely via `Authorization: ShippoToken ${env.apiToken}` (`client.ts:149`) and is never logged. No secret leak found.
- **Auth boundaries:** all label/package mutation and read routes require `admin.access` via `requirePermission`. Checkout endpoints are public but gated by `loadDraftForAccess`/`assertCanMutateDraft` with uniform 404 (no cross-customer enumeration). Dev auth is cookie-only and allowlisted (`auth.ts:53-64`); the `x-dev-user-id` header is explicitly not trusted.
- **Injection:** Prisma parameterized queries (`audit.ts:56-107`, `ops/orders.ts`); Shippo calls are JSON bodies to fixed endpoints. `trackShipment` uses `encodeURIComponent` on carrier and tracking number (`client.ts:279`). No SQL/command injection found.
- **IDOR for customers:** label data is exposed only through admin routes; no customer-facing label endpoint exists. No horizontal customer IDOR on the P8 surface.
- **`getOrderDetail` change** (git diff): adds `fulfillmentMethod` include to packages — no security impact.

## Counts by severity

| Severity | Count |
|---|---|
| blocker | 0 |
| major | 1 |
| minor | 6 |
| info | 1 |
| **total** | **8** |

## Output

- Path: `runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/results/reviews/P8-security-arm-03.md`
