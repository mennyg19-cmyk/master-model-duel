# Reviewer specialist — Rules (P8, arm-06, blind)

**Arm:** arm-06 (late join)
**Phase:** P8 — Shipping: Shippo, rate margin, labels (per `shared/phases/PHASE-P8-EXPECTED.md` and `shared/MERGED-BUILD-PLAN.md` § P8)
**Rules in scope:** ponytail, clean-code, workflow, vocabulary, codegraph (per `ARM.md` / `.cursor/rules/*.mdc`)
**Reviewer posture:** findings only, no fixes. Blind to model name.
**Tree reviewed:** `arms/arm-06/workspace/` — `lib/shipping/{shippo,fixture-double,margin,packing,quotes,labels}.ts`, `lib/checkout/{shipping-quotes,fulfillment,submit}.ts`, `app/api/admin/packages/[packageId]/{label,label/void,label/track,label/validate}/route.ts`, `app/api/dev/shippo-fixture/{route,[...tail]/route}.ts`, `app/(admin)/admin/packages/[packageId]/label-actions.tsx`, `lib/packages/{materialize,stages}.ts`, `lib/audit.ts`, `lib/env-spec.ts`, `prisma/schema.prisma` (Shipment, ShippingQuote, ShipmentStatus, PackageType.weightGrams), `prisma/migrations/20260729140000_p8_shipping/migration.sql`, `prisma/migrations/20260729150000_package_type_weight/migration.sql`, `package.json`, `.env.example`, `.scratch/PHASE-P8-{STATUS,SMOKE}.md`.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 2 |
| Minor | 5 |

The P8 build is structurally consistent with the arm's rules: the margin engine is pure and unit-testable, the Shippo wrapper is a no-new-dep native-fetch+zod client (ponytail ladder satisfied), errors are typed and mapped through one ladder per route, comments carry intent, the UI reuses the existing Card/Button/`formatCents` kit, `.env.example` is regenerated and current, and `pdf-lib` is now pinned (the P7 Major is fixed). The two Majors are a concurrency/durability gap in the label-purchase path and an HTTP-inside-transaction pattern in checkout submit — both bite at the documented crunch scale (G-024). Minors are dead schema, an unreferenced stub, unbounded quote-row growth, and a hand-patched migration history.

## Findings

### Major

**M1. Live Shippo HTTP call runs inside the checkout submit Prisma transaction — concurrency / ponytail "complex requests" + G-024.**
`lib/checkout/submit.ts:65` opens `prisma.$transaction(async (tx) => { … })`, and line 124 calls `quoteRecipientShipping(tx, …)` for every SHIPPED recipient. That chain runs `quoteShipping({ db: tx, … })` → `createShipmentWithRates(…)` (`lib/shipping/quotes.ts:116`), which is a live HTTP round-trip to Shippo. The carrier call therefore holds the Prisma transaction (and the order/stock locks it took) open for the full carrier latency, once per recipient. At the documented crunch target (10+ concurrent staff, 1k+ orders — G-024), this extends lock hold time unpredictably and is the classic Postgres "HTTP inside a tx" anti-pattern: connection exhaustion, lock waits, and tx timeouts under load. The status doc explicitly states "submit resolves its fee from a live quote inside the tx" as if it were a feature; it is a real scaling risk. ponytail.mdc "complex requests: build what the user asked" and workflow.mdc "verify in the running app" both want the real shape, not a slice that works at one order. Fix scope (no fixes here, but the direction): resolve the live quote *before* opening the transaction, or move the quote outside the tx and only freeze the fee snapshot inside it.

**M2. Orphan `PURCHASING` Shipment row is unrecoverable without manual DB SQL — workflow "verify in the running app" + P12 "zero manual DB edits" goal.**
`lib/shipping/labels.ts:146` creates the `Shipment` row with `status: "PURCHASING"` on the bare `prisma` client (no transaction), then runs the carrier `buyLabelTransaction` HTTP (line 168), then a `$transaction` flips it to `PURCHASED` (177) — or the `catch` flips it to `FAILED` (215). If the process is hard-killed between the `create` and the catch handler (serverless timeout / cold-start during the HTTP call), the row stays `PURCHASING` and the catch never runs. `loadShippedPackage` (line 60) loads `status: { in: ["PURCHASING", "PURCHASED"] }` into `pkg.shipments`, so the next `buyLabel` sees `pkg.shipments.length > 0` (line 121) and returns 422 "already has an active label — void it before buying again". But `voidLabel` (line 229) only finds `status === "PURCHASED"` — a stuck `PURCHASING` row cannot be voided and cannot be re-bought. The package is permanently label-locked. The only escape is direct SQL on the `shipments` table, which the scratch artifacts confirm was needed during this very phase (`.scratch/p8-manual-sql.sql`, `.scratch/p8-rename-row.sql`, `.scratch/p8-fix-checksum.sql` all hand-edit the DB). workflow.mdc § Verification and the P12 dress-rehearsal "zero manual DB edits" goal both imply this state should not exist. Fix scope: either create the `PURCHASING` row inside the same transaction that buys the label (so it rolls back on crash), or give `voidLabel`/a recovery path the ability to retire a stale `PURCHASING` row older than a threshold.

### Minor

**m1. `Shipment.shippoShipmentId` column is never populated — clean-code "Dead code."**
`prisma/schema.prisma:670` declares `shippoShipmentId String?` on the `Shipment` model. `createShipmentWithRates` returns a `shipment.object_id` (the Shippo shipment id), but `quoteShipping` (`lib/shipping/quotes.ts`) does not surface it and `buyLabel` (`lib/shipping/labels.ts:146-156`) never writes it. The column is nullable and always null in practice — dead schema. clean-code.mdc § Abstraction Discipline: "Dead code — delete, don't comment out." Either wire it (store the Shippo shipment id at quote time) or drop the column. Minor (no behavior impact; reconciliation in P12 keys off `shippoTransactionId`, which is written).

**m2. `voidActiveShipmentForReroute` is a one-line re-export with zero current call sites — ponytail Rule of 2.**
`lib/shipping/labels.ts:272-278` is `return voidLabel(input);` — a wrapper that adds no logic and has no call site in this phase. ponytail.mdc § Code rules: "No unrequested abstractions (Rule of 2). Needs 2+ real call sites right now. Not 'might be useful later.'" The EXPECTED doc explicitly blesses a "P9 hook stub acceptable" for S3, so this is protocol-safe — but it is still a Rule-of-2 violation today. Minor because the phase spec anticipates the call site in P9; if P9 does not consume it, delete it.

**m3. No cleanup of expired `ShippingQuote` rows — unbounded growth.**
`lib/shipping/quotes.ts:19` sets `expiresAt` (30-min TTL) on every `ShippingQuote` row, and a row is written on every checkout submit (per SHIPPED recipient) and on every label buy (`labels.ts:141` persists by default). No cron or job deletes rows past `expiresAt`. The table grows monotonically with orders + label attempts. P11/P12 do not list a `ShippingQuote` purge in their cron set (R-172 is email-log purge only). Minor (low per-row cost, but it is the same unbounded-growth shape flagged as m8 in the P7 review for `printBatchItem`).

**m4. `ShippingQuote` written on every label buy, not just checkout — R-155 intent drift.**
R-155 frames `ShippingQuote` as the checkout rate-lock record. `buyLabel` (`labels.ts:141`) calls `quoteShipping({ parcels, destination, scope: { packageId } })` with the default `persist: true`, so every label purchase also writes a `ShippingQuote` row against the package. This is harmless (the row is honest) but means the `shipping_quotes` table mixes checkout rate-locks with label-purchase quotes against two different foreign keys (`orderId` vs `packageId`), and the P12 reconciliation view will need to distinguish them. Minor (schema allows both; the `scope` union is intentional — just note it for the P12 report).

**m5. Migration history was hand-patched via `_prisma_migrations` SQL — workflow / anti-hallucination hygiene.**
`.scratch/p8-rename-row.sql` runs `UPDATE "_prisma_migrations" SET "migration_name" = '20260729140000_p8_shipping' WHERE "migration_name" = '20260729043501_p8_shipping'` and `.scratch/p8-fix-checksum.sql` overwrites the `checksum` for the old name. The migration directory on disk is `20260729140000_p8_shipping` (the `20260729043501_p8_shipping` directory does not exist), so the `_prisma_migrations` table was edited by hand to rename a already-applied migration and patch its checksum rather than dropping/recreating the migration cleanly. `migration-guard` passes now, so the DB and the directory are in sync — but the hand-edit is the kind of out-of-band state change workflow.mdc § "Revert fully or not at all" and the anti-hallucination rule caution against. Minor (dev-scratch, not shipped code; flagged so the P12 migration-cleanup pass knows the history is patched).

## What passed (not findings)

- **Margin law (UR-003, G-006):** `lib/shipping/margin.ts` is pure — `resolveMargin` charges `eligible[eligible.length-1]`, buys `eligible[0]`, books `marginCents = charge − buy`. Single-carrier → margin 0, honestly recorded. Ground-comparable service tokens (`GROUND_SERVICE_TOKENS`) prevent the FedEx-Ground-vs-UPS-Next-Day fabrication the merged plan flagged as risk #2. USPS gated on `SHIPPO_INCLUDE_USPS`.
- **R-175 compensation:** `buyLabel`'s catch (labels.ts:210-219) flips the row to `FAILED` with the carrier reason and writes a `label_failed` event; the paid order total is never touched on a label failure. Verified.
- **R-177 validate-before-money:** `buyLabel` (line 129) calls `validateAddress` before any row is created; an undeliverable address 422s with an `address_validate` event and no `Shipment` row. `validatePackageAddress` exposes the same check on demand.
- **R-176 tracking:** `refreshTracking` pulls carrier status onto the row with a `tracking_refresh` event.
- **R-081 bin packing:** `planParcels` (first-fit-decreasing, 85% fill cap, smallest fitting box, sorted-dims dimensional check) with `PackageType.weightGrams` fallback for products without dims — never under-declares. Add-on lines ride the parent's parcel.
- **R-055 / R-183 / R-184 env:** `env-spec.ts` declares `SHIPPO_API_TOKEN` (required-ish, optional), `SHIPPO_BASE_URL`, `SHIPPO_FEDEX_ACCOUNT_ID`, `SHIPPO_UPS_ACCOUNT_ID`, `SHIPPO_INCLUDE_USPS`, and `UPS_CLIENT_ID`/`UPS_CLIENT_SECRET` as declaration-only (R-184 — never read by code, comment says so). `.env.example` regenerated and current (P7's stale-example Major is fixed).
- **No new dependency:** Shippo runs over native `fetch` + `zod`; the `shippo` npm package is deliberately not added (ponytail ladder: stdlib + native + existing deps cover it). `pdf-lib` is now pinned to `1.17.1` (P7 Major fixed).
- **Error handling consistency:** one `mapDomainError` ladder per route; `ShippoNotConfiguredError` → 503, `ShippoApiError`/`LabelPurchaseError`/`LabelVoidError` → 502, `DomainRuleError` → 422. Typed errors with `status`/`name`.
- **Concurrency on the active-label guard:** the partial unique index `shipments_one_active_per_package` (migration.sql:41) plus the `P2002` catch in `buyLabel` (labels.ts:161) makes two concurrent buys race-decided with the same 422 a serial attempt would get (R-072).
- **Naming / comments:** no vague standalone names; comments carry intent (the margin law, the comparability rule, the R-175 compensation, the P9 reroute hook, the `PURCHASING`-race comment). No narration comments.
- **UI consistency:** `PackageLabelActions` reuses `Card`, `Button`, `formatCents`, the existing `apiFetch`; `data-*` attributes mirror the test-hook convention used elsewhere. Failed/voided attempts stay visible — staff see the cause.
- **Checkout SHIPPED integration:** `submit.ts` re-quotes inside the tx and freezes `deliveryFeeCents` from the live quote; a stale page total 409s (R-034/R-037). Display quotes (`shipping-quotes.ts:78`) persist nothing. One quote path for display + submit.
- **Codegraph rule:** not applicable to a static code review (no live structural lookups performed); the arm's `.codegraph/` index exists.
- **Vocabulary rule:** no command-scope words in the reviewed artifacts; not applicable.
- **No secrets committed:** `.env` is gitignored; `SHIPPO_API_TOKEN` lives only in the local `.env`; `.env.example` carries placeholders only.
