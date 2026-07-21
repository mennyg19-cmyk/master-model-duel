# Residual Rules Review — arm-01 (Test 5)

**Reviewer specialist:** Rules
**Arm:** arm-01
**Tree / phase:** `arms/arm-01/workspace/` — post self-fix, full tree
**Arm rules:** ponytail, clean-code, workflow, vocabulary, codegraph
**Output:** `results/reviews/residual-rules-arm-01.md`
**Method:** Blind review of the post-fix tree only. Self-review notes, self-fix notes, and self-review chats were not read. Findings only — no fixes proposed.

## Scope

Graded adherence to this arm's selected catalog rules only. The tree is a Next.js 16 / Prisma / Clerk storefront + admin application (P1–P12 phases). 145 source files under `src/`, plus `prisma/`, `tests/`, `scripts/`. Line counts surveyed for the god-file rule (>500 lines); only three source files clear that threshold: `src/domain/delivery.ts` (641), `src/components/order-builder.tsx` (542), `src/domain/shipping.ts` (502). `prisma/schema.prisma` (1072) is a single-file schema by Prisma convention and is excluded.

## Findings

### R1 — God file: `src/domain/delivery.ts` mixes concerns (clean-code §Abstraction Discipline; ponytail §God files)
**Severity: Medium**

`delivery.ts` (641 lines) bundles at least five distinct concerns behind one module:
- Delivery route creation + audit (`createDeliveryRoute`, `reassignDeliveryRoute`)
- Driver magic-link + PIN authentication (`accessDriverRoute`, the `pinHash`/`equalHashes` helpers, the lockout raw SQL)
- Mapbox geocoding + cache (`geocodePackage`, `addressText`, `googleMapsUrl`)
- Fulfillment-method switching and reroute (`switchFulfillmentMethod`, `confirmRouteReroute`, `findNearbyShippingPackages`)
- Pickup lifecycle and bulk delivery (`markPickupReady`, `stampPickup`, `scheduleBulkDelivery`, `expireUnclaimedPickups`)

Both `clean-code.md` ("split when >500 lines, mixed concerns, or a refactor command") and `ponytail.md` ("God files: split when >500 lines, or mixed concerns") trigger on this file. It is over the line count **and** mixes concerns. The geocoding + driver-auth + pickup sub-systems each have a single clear concern and are the natural split lines.

### R2 — Borderline god files at the 500-line threshold (clean-code §Abstraction Discipline)
**Severity: Low**

- `src/components/order-builder.tsx` (542 lines) — single `OrderBuilder` component: draft restore/save, product list, cart, recipient picker, dialogs. Cohesive, but over the threshold. The draft-persistence logic (restore/save/409-retry) is a separable concern from the JSX.
- `src/domain/shipping.ts` (502 lines) — cohesive (carrier rates, box planning, label buy/void/track, address validation, draft shipping). Just over the threshold; the label-purchase transaction is the largest separable block.

Both pass the "mixed concerns" test but fail the bright-line ">500 lines" rule. Borderline, low severity.

### R3 — Magic values, some duplicated (clean-code §Abstraction Discipline cat. 4)
**Severity: Low**

In `src/domain/delivery.ts`:
- Geocode cache TTL `30 * 24 * 60 * 60 * 1000` is written twice (lines 109 and 117) with no named constant.
- Pickup expiry window `14 * 24 * 60 * 60 * 1000` inline at line 555.
- Earth-radius `3958.8` inline in `distanceMiles` (line 437).
- PIN lockout threshold `5` inline in the lockout SQL (line 243).

`routeLinkLifetimeMs`, `pinLockMs`, and `nearbyMiles` at the top of the file are correctly named — the rest should follow that pattern.

### R4 — Banned standalone name `result` (clean-code §Naming Conventions)
**Severity: Low**

`result` is on the banned-as-standalone list. Four occurrences, all wrapping a `$transaction` return:
- `src/domain/shipping.ts:272`
- `src/app/api/admin/catalog/route.ts:166`
- `src/app/api/admin/orders/[orderId]/payments/route.ts:46`
- `src/app/api/admin/orders/[orderId]/payments/route.ts:96`

Each holds a transaction outcome (label, catalog mutation, payment) — a domain-specific name (`labelResult`, `committed`, etc.) would describe what the transaction produced.

### R5 — Two env-access patterns for the same concern (clean-code §Consistency)
**Severity: Low**

`src/lib/env.ts` centralizes a subset of server env vars behind `readServerEnvironment()` and `requireEnvironmentValue()`, and `shipping.ts` correctly uses it via `organizationAddress()`. But a larger set of secrets is read directly from `process.env` elsewhere:
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BLOB_READ_WRITE_TOKEN`, `APP_URL`, `EMAIL_TEST_MODE` — read ad hoc in stripe/checkout routes and `lib/stripe.ts`.
- `TEST_AUTH_SECRET`, `ENABLE_TEST_AUTH` — read directly in `lib/auth.ts`.
- `NEWSLETTER_HMAC_SECRET` — read directly in `lib/newsletter.ts`.
- `CLIENT_ERROR_TOKEN`, `CRON_SECRET`, `MAPBOX_ACCESS_TOKEN` — read directly at call sites.

The `ServerEnvironment` type in `env.ts` does not list these, so the central source of truth is incomplete. Two patterns (centralized reader vs. direct `process.env`) for one concern. `.env.example` does cover all of them, so the drift is in code, not in the example.

### R6 — Floating dependency range (clean-code §Dependency Discipline)
**Severity: Low**

`package.json` pins every dependency to an exact version except `@vercel/blob: "^2.6.1"`. The rule is "Pin versions — no floating ranges." Single offender.

## Rules with no findings

### ponytail
Ladder and YAGNI are honored. No unrequested abstractions, no speculative wrappers, no boilerplate-for-later. The `BackLink` component (3 lines of JSX with logic) is correctly kept. The god-file overlap with R1 is the only ponytail touch-point. Chat-output / anti-slop rules are not gradeable from a static tree.

### workflow
- README is current and explicitly documents the "one pattern per concern" choices (server components for reads, route handlers for mutations, Prisma, Tailwind tokens, `node:test` via `tsx`). Satisfies the "Keep README current" and "pick patterns in the first session and document" rules.
- `.scratch/` exists and is gitignored (`.gitignore` line 36). Expectation-file/run-state hygiene is possible.
- `.codegraph/` index present — `codegraph init` was run (see codegraph below).
- Security basics met: `.env*` ignored with `!.env.example` exception; `.env.example` has placeholders for every secret.
- No drive-by rewrites or scope-creep signals in the tree. No findings.

### vocabulary
No command verbs (tidy/refactor/rebuild/etc.) were issued in this review task, so the scope-vocabulary table is not exercised. Naming conventions are otherwise followed (booleans read as yes/no questions: `isAvailable`, `isCorrect`, `hasShipping`; collections plural: `lines`, `stops`, `addresses`; domain abbreviations `id`/`url` only). The `result` issue is captured under clean-code R4. No separate findings.

### codegraph
`.codegraph/` exists in the workspace root, so the arm ran `codegraph init` as required before structural work. No structural-lookup rule violations are observable from a static tree (chat-time tool choice is not auditable here). The index being present and the absence of obvious grep-for-symbol scaffolding in the source is the only gradeable signal, and it passes.

## Severity summary

| Severity | Count | Findings |
|---|---|---|
| High     | 0 | — |
| Medium   | 1 | R1 |
| Low      | 5 | R2, R3, R4, R5, R6 |
| Info     | 0 | — |
| **Total**| **6** | |

## Overall

The post-fix tree is largely rule-conformant. The one finding worth acting on is **R1**: `src/domain/delivery.ts` is a true god file by both line count and mixed concerns, and it is the only Medium. The remaining five are Low-severity hygiene items — a few magic values, a banned `result` name repeated in three files, one floating dependency range, and an env-access pattern that is centralized for some secrets and ad hoc for others. No High findings. No security, trust-boundary, or anti-hallucination violations observed in the surveyed files (`lib/auth.ts`, the Stripe webhook, and `checkout/stripe/route.ts` all use timing-safe compares, signed webhooks, idempotency keys, and zod validation).
