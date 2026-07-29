# Aggregate Review — P8 — arm-06

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Arm:** arm-06 (late join)
**Phase:** P8 — Shipping: Shippo, rate margin, labels
**Inputs:** P8-security, P8-quality, P8-rules, P8-clean-code (arm-06, all blind)
**Method:** Union + dedupe by location+claim. Security blockers always survive. No new findings. Mixed-severity clusters resolve to the highest severity (Blocker > Major > Minor).

## Counts

| Severity | Count |
|---|---|
| Blocker | 1 |
| Major | 9 |
| Minor | 18 |
| **Total** | **28** |

Source totals (pre-dedupe): security 8 (0B/4M/4m), quality 11 (1B/3M/7m), rules 7 (0B/2M/5m), clean-code 10 (0B/3M/7m) = 36. 7 clusters merged (M1: 3 src; M2: 2 src; M9: 2 src — merges a Major and a Minor, resolves to Major; m1: 2 src; m2: 2 src; m3: 2 src; m4: 2 src) → 8 duplicates removed → net 28 unique. No security blockers were raised by the security specialist; the single Blocker comes from quality (tracking-refresh correctness) and survives aggregation.

## Blockers (1)

### B1 — `refreshTracking` is refused at SENT — the only stage where it matters
**Sources:** quality Blocker 1
**Location:** `lib/shipping/labels.ts:280` (`refreshTracking`); `lib/shipping/labels.ts:60-72` (`loadShippedPackage` terminal-stage guard); route `app/api/admin/packages/[packageId]/label/track/route.ts`
**Claim:** `refreshTracking` calls `loadShippedPackage`, which throws `DomainRuleError` when `pkg.stage === pkg.fulfillmentMethod.terminalStage`. For SHIPPED the terminal stage is `SENT` — the point at which the carrier has the package and tracking is the live operation. The guard message ("the carrier has it; labels can't change now") is correct for buy/void, but wrong for R-176 tracking refresh, whose entire purpose is post-handoff status. Smoke S3b and the domain suite both advance `westPkg` to SENT and assert that void and re-buy are refused — neither asserts `refreshTracking` at SENT, so the regression is unexercised. The route surfaces this as a 422/DomainRuleError instead of the carrier status. Fix: split the terminal-stage guard by operation (buy/void refuse at SENT; tracking refresh must require SENT-or-earlier with a PURCHASED shipment; validate can stay refused at SENT).

## Majors (9)

### M1 — Stuck `PURCHASING` Shipment row permanently blocks label buys (availability on the money path)
**Sources:** security M1, quality Major 3, rules M2
**Location:** `lib/shipping/labels.ts:146` (create `PURCHASING`); `lib/shipping/labels.ts:210-219` (catch → FAILED); `lib/shipping/labels.ts:60` (`loadShippedPackage` loads `status in ["PURCHASING","PURCHASED"]`); `lib/shipping/labels.ts:121` (`buyLabel` rejects when `pkg.shipments.length > 0`); `lib/shipping/labels.ts:229` (`voidLabel` only acts on `PURCHASED`); partial unique index `shipments_one_active_per_package`
**Claim:** `buyLabel` creates the `Shipment` row with `status: "PURCHASING"` on the bare `prisma` client (no transaction) **before** calling `buyLabelTransaction`. The catch block flips it to `FAILED` on error — but only if execution reaches the `try`. A hard crash, cold-start, or fetch timeout between the `create` and the `update` leaves the row `PURCHASING` forever. `loadShippedPackage` loads `PURCHASING`/`PURCHASED` into `pkg.shipments`, so the next `buyLabel` sees `pkg.shipments.length > 0` and returns 422 "already has an active label — void it before buying again" — but there is no label to void (`voidLabel` requires `status === "PURCHASED"`). There is no timeout, no `PURCHASING`-sweep cron, and no staff UI affordance to clear a stuck row; the only escape is direct SQL on the `shipments` table (scratch artifacts confirm manual SQL was needed this phase). The package is permanently label-locked at the exact failure mode the spec calls out (5k packages, provider outages). Fix scope: create the `PURCHASING` row inside the same transaction that buys the label (rollback on crash), or add a short-TTL `PURCHASING`→`FAILED` sweep / staff "force-fail stuck purchase" path gated by `fulfillment.manage`.

### M2 — Async refund failure is never reconciled (money-ledger integrity)
**Sources:** security M2, quality Major 4
**Location:** `lib/shipping/labels.ts:237-249` (`voidLabel`); `lib/shipping/labels.ts:229` (active-shipment find)
**Claim:** `voidLabel` calls `voidLabelTransaction`, throws only on `refund.status === "ERROR"`, and for `SUCCESS`/`QUEUED`/`PENDING` immediately marks the row `VOIDED` and records `reversedCostCents: active.costCents` in the event/audit. Shippo processes voids asynchronously — a `QUEUED`/`PENDING` refund can still fail carrier-side after the row is marked `VOIDED` (e.g. label already scanned into the network). There is no follow-up poll, no webhook, no re-fetch of the refund status, and no `label_void_rejected` event. The package can re-buy, and the org is billed for two labels while the reconciliation ledger (P12) shows the voided label as fully reversed. The code comment at `labels.ts:243` ("the refund settles carrier-side") accepts the optimistic mark, but nothing detects a later settlement failure. Smoke S2b only asserts the happy-path `VOIDED` + event; the rejected-refund path is unexercised. Fix scope: record `refundStatus` on the row and add a sweeper that re-checks pending refunds, emitting `label_void_rejected` and reverting the row to `PURCHASED` if Shippo ultimately declines.

### M3 — Live Shippo HTTP call runs inside the checkout submit Prisma transaction
**Sources:** rules M1
**Location:** `lib/checkout/submit.ts:65` (`prisma.$transaction`); `lib/checkout/submit.ts:124` (`quoteRecipientShipping(tx, …)` per SHIPPED recipient); `lib/shipping/quotes.ts:116` (`createShipmentWithRates` — live HTTP)
**Claim:** `submit.ts` opens `prisma.$transaction`, then calls `quoteRecipientShipping(tx, …)` for every SHIPPED recipient, which runs `quoteShipping({ db: tx, … })` → `createShipmentWithRates(…)` — a live HTTP round-trip to Shippo. The carrier call therefore holds the Prisma transaction (and the order/stock locks it took) open for the full carrier latency, once per recipient. At the documented crunch target (10+ concurrent staff, 1k+ orders — G-024), this extends lock hold time unpredictably and is the classic Postgres "HTTP inside a tx" anti-pattern: connection exhaustion, lock waits, and tx timeouts under load. The status doc states "submit resolves its fee from a live quote inside the tx" as if it were a feature; it is a real scaling risk. Fix scope: resolve the live quote *before* opening the transaction, or move the quote outside the tx and only freeze the fee snapshot inside it.

### M4 — `costCents` parsed from Shippo echo with no numeric validation (money-path robustness)
**Sources:** security M4
**Location:** `lib/shipping/labels.ts:175` (`costCents = Math.round(Number(transaction.rate?.amount ?? "0") * 100)`); `lib/shipping/shippo.ts:94` (`rate.amount` zod schema)
**Claim:** `buyLabel` computes `costCents` via `Number(transaction.rate?.amount ?? "0")`. The zod schema validates `rate.amount` as `z.string()` only — not a numeric string. If Shippo returns a non-numeric amount (API change, transient malformed body, fixture returning `"N/A"`), `Number(...)` is `NaN`, `Math.round(NaN)` is `NaN`, and `marginCents = chargedCents - NaN` is `NaN`. Prisma throws on the `Int` write inside the `$transaction`, leaving the Shipment in `PURCHASING` (see M1) and the label already bought carrier-side — money spent with no ledger row. The cost is also trusted as the actual charge with no cross-check against the rate that was selected (`quote.margin.buy.amountCents`); a mismatch is silently recorded as margin drift rather than flagged. Fix scope: validate `rate.amount` as a numeric string at the zod boundary, and cross-check the echoed cost against the selected rate.

### M5 — Margin ledger diverges for merged SHIPPED packages
**Sources:** quality Major 2
**Location:** `lib/shipping/labels.ts:100-107` (`chargedCentsFor(pkg)` sums per-recipient frozen `deliveryFeeCents`); `lib/checkout/shipping-quotes.ts` (`quoteRecipientShipping` → `planParcelsForLines` for recipient's lines only); `lib/shipping/quotes.ts:145` (`planParcelsForPackage` re-packs all package lines into one combined parcel set)
**Claim:** Each recipient's checkout fee was quoted on that recipient's own lines' parcel plan. At label buy, `planParcelsForPackage` re-packs all the package's lines (every member) into one combined parcel set and `quoteShipping` prices that combined set. So for a package merged from two same-address recipients, `chargedCents = recipientA_quote_high + recipientB_quote_high` (two separate 1-parcel quotes) while `costCents` is the cheaper carrier quote for the 2-parcel combined shipment. `marginCents = chargedCents − costCents` is then neither the per-recipient spread nor the per-shipment spread — it conflates two different parcel plans. The P12 reconciliation view (UR-003 report) will show inflated or distorted margins for any merged SHIPPED package, with no way to tell the honest spread from the packing artifact. The status doc states "charge = frozen checkout snapshot, cost = what Shippo bills" as if the parcel plans always match; they match only when the package has exactly one recipient. Fix scope: either quote the combined parcel set at checkout too (so the frozen fee reflects the merged shipment), or record the per-recipient charge and the combined cost as separate ledger fields with a computed-blend note.

### M6 — `line2` dropped on the Shippo quote path (type/schema drift + functional consequence)
**Sources:** clean-code M1
**Location:** `lib/shipping/shippo.ts:51` (`ShippoAddress.line2`); `lib/checkout/shipping-quotes.ts:13-21` (`RecipientQuoteTarget` — no `line2`); `lib/checkout/shipping-quotes.ts:62-71` (`quoteRecipientShipping` builds destination without `line2`); `lib/shipping/labels.ts:87-95` (`destinationFor` uses `line2`); `lib/checkout/recipient-props.ts:6-20` (`CheckoutRecipientProps` folds `line2` into `addressLine`)
**Claim:** `ShippoAddress` carries `line2`, and the label-purchase path uses it. But the checkout quote path goes through `RecipientQuoteTarget`, which has no `line2` field, and `quoteRecipientShipping` builds the destination without it. `CheckoutRecipientProps` also omits `line2` as a standalone field. So both the display quote (`quoteCheckoutShipping`) and the submit re-quote (`submit.ts:124`) send Shippo an address with no apartment/suite. The customer is charged on a quote for an incomplete address, then the label is bought against the full address — address validation at label time can fail where the quote succeeded, and the rate can differ for carrier services that zone on full address. `RecipientQuoteTarget` should match `ShippoAddress` (or be `ShippoAddress` plus `id`), and `buildCheckoutRecipients` should expose `line2` so the quote path and the label path see the same destination. Violates: type/schema drift, one-pattern-per-concern.

### M7 — `shipping.rates` setting is editable but unread by any business logic (dead config + schema drift)
**Sources:** clean-code M2
**Location:** `lib/settings.ts:14` (`"shipping.rates": z.array(z.object({ name, feeCents }))`); `app/(admin)/admin/settings/settings-tabs.tsx:103-106, 364-369` (manager editor); cf. `lib/checkout/fulfillment.ts:83` (`resolveDeliveryFeeCents` reads `delivery.fees`); `lib/shipping/quotes.ts` (live Shippo)
**Claim:** P8 replaced the P5 placeholder rate path with live Shippo quotes for `SHIPPED` and `delivery.fees` for the two delivery channels. `lib/settings.ts` still declares `shipping.rates`, and the settings hub still lets managers add/edit rows with a `feeCents` value — but no checkout or label path reads `shipping.rates` (repo-wide search returns only `settings.ts`, the admin settings route, and the settings UI). A manager can configure a rate table that the system silently ignores — the exact "looks configured but does nothing" trap the clean-code rule calls out as dead code. Either wire it (if it still means something for a non-carrier channel) or drop the schema key, the settings-tab editor, and the route allow-list entry. `shipping.rules` (name + description, no `feeCents`) is informational and fine to keep; `shipping.rates` is not. Violates: dead code, schema drift.

### M8 — `buyLabel` marks the Shipment `FAILED` even when the carrier transaction succeeded
**Sources:** clean-code M3
**Location:** `lib/shipping/labels.ts:167-219` (try wraps both `buyLabelTransaction` and the `prisma.$transaction`); `lib/shipping/labels.ts:215-216` (catch → `FAILED` + `label_failed` event)
**Claim:** `buyLabel` wraps both `buyLabelTransaction` and the follow-up DB transaction (which persists `PURCHASED` + audit) in one try/catch. If `buyLabelTransaction` returns `SUCCESS` but the follow-up DB transaction throws (connection drop, `P2002` on a concurrent re-buy, `recordAudit` failure), the catch flips the row to `FAILED` and writes a `label_failed` event. The label was actually purchased at Shippo — the org is paying for it carrier-side — but the local row flips to `FAILED` and the package becomes "label-less" from the staff UI's view. The R-175 comment ("the failed attempt is recorded with the carrier's reason and the package stays label-less; the paid order total is never touched") describes a carrier rejection, not a post-success DB failure. The catch needs to distinguish "transaction never succeeded" (mark FAILED) from "transaction succeeded, DB persist failed" (leave PURCHASING or escalate for reconciliation). Violates: error handling (error messages say what went wrong AND the expected state), anti-AI-tics ("just in case" code that misrepresents state).

### M9 — Checkout display quotes trigger unbounded Shippo rate calls (cost abuse + no concurrency cap)
**Sources:** security M3, quality Minor 6
**Location:** `lib/checkout/shipping-quotes.ts:78-102` (`quoteCheckoutShipping` `Promise.all` over recipients); `app/(storefront)/checkout/page.tsx:126` (runs on every SSR); cf. `lib/checkout/submit.ts:124` (submit re-quotes live)
**Claim:** `quoteCheckoutShipping` runs `Promise.all` over recipients, each calling `quoteShipping` → `createShipmentWithRates` → one live Shippo shipment create. This runs on every server-side render of `/checkout?ref=...`, with no cache, no persisted-quote reuse, no rate limit, and no concurrency cap. The public guard and `checkoutRateLimit` apply only to the submit/pay mutation endpoints, not page loads. Shippo bills per rate request in production. Anyone holding a draft ref (logged-in customer's own draft, guest cookie, leaked URL) can reload the checkout page to fire N recipient-rate requests per load with no throttle; a 20-recipient checkout fires 20 concurrent Shippo requests on every load. The submit path already re-quotes live, so the display quote is pure UX — yet it spends real carrier API budget on every render and can self-inflict a Shippo rate-limit burst. Fix scope: batch or cap concurrency (p-limit-style 3–5 in flight), add a short per-order quote cache for the display path, and/or gate the display quote behind a rate limit. Severity resolves to Major (security rates Major; quality rates Minor — highest wins).

## Minors (16)

### m1 — `GROUND_SERVICE_TOKENS` is a hardcoded carrier-service map with no setting seam
**Sources:** quality Minor 8, clean-code Minor 6
**Location:** `lib/shipping/margin.ts:21-25`
**Claim:** `GROUND_SERVICE_TOKENS` whitelists `fedex_ground`, `fedex_home_delivery`, `ups_ground`, `usps_priority`, `usps_ground_advantage`. If the org's negotiated account returns a service outside this list as the cheapest (e.g. `fedex_2_day`), `eligibleRates` returns empty and `quoteShipping` throws `ShippingUnavailableError("no ground-comparable services came back")` — the SHIPPED option is disabled at checkout for that address with no operator recourse. The merged plan flags this as open question #4; the code picks one answer and offers no settings toggle. The moment Shippo renames a token or the org adds a negotiated service level, eligibility silently drops that carrier from the margin contest with no signal. Surface it as a typed `shipping.groundServiceTokens` setting (defaulted to the current list) so an operator can widen it without a code change, or document in `README` § Rule Preferences that this is intentionally code-owned. Violates: magic values, dependency discipline (config the org can't reach).

### m2 — `voidActiveShipmentForReroute` is a one-line passthrough wrapper with zero current call sites
**Sources:** rules Minor 2, clean-code Minor 7
**Location:** `lib/shipping/labels.ts:272-278`
**Claim:** `voidActiveShipmentForReroute(input) { return voidLabel(input); }` is a one-line forwarder with no logic and no call site in this phase. ponytail.mdc § Code rules: "No unrequested abstractions (Rule of 2). Needs 2+ real call sites right now. Not 'might be useful later.'" The EXPECTED doc explicitly blesses a "P9 hook stub acceptable" for S3, so this is protocol-safe — but it is still a Rule-of-2 violation today. If P9 does not consume it, delete it; if kept, a one-line comment pointing at the P9 caller is enough.

### m3 — No cleanup of expired `ShippingQuote` rows — unbounded growth
**Sources:** quality Minor 7, rules Minor 3
**Location:** `lib/shipping/quotes.ts:19` (`expiresAt` 30-min TTL); `lib/shipping/labels.ts:141` (persist on label buy); `lib/checkout/submit.ts` (persist on submit re-quote)
**Claim:** `quoteShipping` writes a rate-lock row on every label buy and on every submit re-quote (`persist !== false`), with a 30-min `expiresAt`. The engine never reads stored quotes ("always prices fresh") and no sweeper deletes expired rows. Over a 5k-package season this is thousands of write-only JSONB rows per season that the P12 reconciliation view will have to filter. P11/P12 do not list a `ShippingQuote` purge in their cron set (R-172 is email-log purge only). Same unbounded-growth shape flagged as m8/m13 in the P7 review for `printBatchItem`. Add a purge cron (P11/P12 class) or stop persisting on the label-buy path.

### m4 — Migration history was hand-patched via `_prisma_migrations` SQL (orphan-row risk)
**Sources:** quality Minor 11, rules Minor 5
**Location:** `prisma/migrations/20260729140000_p8_shipping/` (the persisted dir); the deleted `20260729043501_p8_shipping/` directory; `.scratch/p8-rename-row.sql`, `.scratch/p8-fix-checksum.sql`; the `_prisma_migrations` table
**Claim:** The glob returned both `20260729043501_p8_shipping/` and `20260729140000_p8_shipping/`; the directory listing shows only `20260729140000_p8_shipping` persists. `.scratch/p8-rename-row.sql` runs `UPDATE "_prisma_migrations" SET "migration_name" = '20260729140000_p8_shipping' WHERE "migration_name" = '20260729043501_p8_shipping'` and `.scratch/p8-fix-checksum.sql` overwrites the `checksum` for the old name — i.e. the `_prisma_migrations` table was edited by hand to rename an already-applied migration and patch its checksum rather than dropping/recreating the migration cleanly. `migration-guard` passes now, so the DB and the directory are in sync — but if the earlier timestamped dir was ever applied to a dev DB and then deleted, the migration-guard hash set could drift on machines that still have the old `_prisma_migrations` row. Verify the `prisma_migrations` table on the smoke DB has no orphan `20260729043501` entry; if it does, the guard's "DB in sync" pass is hiding a real divergence. The hand-edit is the kind of out-of-band state change workflow.mdc § "Revert fully or not at all" and the anti-hallucination rule caution against. Minor (dev-scratch, not shipped code; flagged so the P12 migration-cleanup pass knows the history is patched).

### m5 — Raw Shippo error body surfaced to the client (info leak)
**Sources:** security Minor 1
**Location:** `lib/shipping/shippo.ts:17-24` (`ShippoApiError` embeds `JSON.stringify(raw).slice(0, 300)`); `mapDomainError` returns the message verbatim on track (502) and validate (502) routes
**Claim:** `ShippoApiError` embeds a truncated JSON of the carrier response in the message, and `mapDomainError` returns that message verbatim as `{ error: error.message }`. The truncated body can include Shippo account references, carrier account ids, or internal request ids. Exposure is staff-only (`fulfillment.manage`), but carrier-side internals should be logged server-side and summarized for the client, not echoed raw.

### m6 — `labelUrl` rendered as `href` with no scheme validation (reflected URL)
**Sources:** security Minor 2
**Location:** `lib/shipping/shippo.ts:91` (`transactionSchema` validates `label_url` as `z.string().nullish()` only); `app/(admin)/admin/packages/[packageId]/label-actions.tsx:110` (`<a href={active.labelUrl} target="_blank" rel="noreferrer">`)
**Claim:** `label_url` is validated as a nullable string with no URL/scheme check, then rendered as an `<a href>`. In production Shippo returns an HTTPS S3 link, but if `SHIPPO_BASE_URL` is pointed at an attacker-controlled or compromised proxy (env trust boundary), or a future fixture returns a `javascript:` URI, the link becomes an XSS vector in the admin shell. `rel="noreferrer"` does not mitigate `javascript:` execution. Validate the scheme at the zod boundary (`https` only) or sanitize before render.

### m7 — `ShippoApiError` detail length cap is on serialized JSON, not semantic fields
**Sources:** security Minor 3
**Location:** `lib/shipping/shippo.ts:180`
**Claim:** `JSON.stringify(raw)` is truncated to 300 chars. JSON truncation can cut mid-field, producing malformed strings that leak half a secret (e.g. a partial account id) while losing the actionable error code. A field-level extraction (`raw.messages`, `raw.detail`) with per-field caps would be safer than slicing the serialized blob. Related to m5 (both touch the error-body handling); distinct claim (truncation shape vs client exposure).

### m8 — `getShippoConfig` caches the token in a module-level singleton
**Sources:** security Minor 4
**Location:** `lib/shipping/shippo.ts:34`
**Claim:** `shippoConfigCache` is held for the process lifetime. Token rotation (e.g. after a leak) requires a full process restart — there is no TTL or invalidation hook. Operationally fragile if a secret-rotation runbook expects hot-reload. Low security impact (the cached token is still valid until rotated carrier-side), but worth noting for the P12 launch-readiness secret-rotation checklist.

### m9 — `lastFailed` lookup can miss when the package has >5 shipments
**Sources:** quality Minor 5
**Location:** `app/(admin)/admin/packages/[packageId]/page.tsx:46` (`shipments: { take: 5 }` ordered desc); `app/(admin)/admin/packages/[packageId]/label-actions.tsx:43` (derives `lastFailed` from that slice)
**Claim:** The package detail query takes `shipments: { take: 5 }` ordered desc. `PackageLabelActions` derives `lastFailed` from that slice. A package with many voids/rebuys plus a failure can age the FAILED row out of the top 5, so the "Last attempt failed" panel disappears while a FAILED row still exists in the DB. Bump the take or filter `status: "FAILED"` into the query for the failed-row leg.

### m10 — `destinationFor` fallback uses `lines[0]` without a documented invariant
**Sources:** quality Minor 9
**Location:** `lib/shipping/labels.ts:82-96`
**Claim:** `destinationFor` picks `pkg.recipientAddress ?? pkg.lines[0]?.orderLine.recipient`. For a merged SHIPPED package this is safe only because the grouping key normalizes the address across members. If grouping ever splits on a finer key (e.g. a future per-recipient greeting split that re-merges two addresses), `lines[0]` silently picks one member's address for the whole label. Add an assertion that all member recipients share the normalized address, or derive the destination from the grouping key rather than a member row.

### m11 — `planParcels` first-fit can strand small items in oversized boxes
**Sources:** quality Minor 10
**Location:** `lib/shipping/packing.ts:73-80`
**Claim:** Units are sorted descending by volume and `parcels.find` returns the first open parcel that dimensionally fits. Parcels are created in unit-processing order, so the first parcel is the largest box. A small unit arriving after the large box opened can land in it even when a smaller box would fit, wasting volume and over-rating the parcel. For rate quotes this is a cost-accuracy issue, not a correctness bug — but it interacts with M5: an over-rated combined parcel inflates `costCents`, which deflates `marginCents` for merged packages. Consider best-fit (smallest open parcel that fits) rather than first-fit.

### m12 — `Shipment.shippoShipmentId` column is never populated (dead schema)
**Sources:** rules Minor 1
**Location:** `prisma/schema.prisma:670` (`shippoShipmentId String?` on `Shipment`); `lib/shipping/quotes.ts` (does not surface the Shippo shipment id); `lib/shipping/labels.ts:146-156` (never writes it)
**Claim:** `createShipmentWithRates` returns a `shipment.object_id` (the Shippo shipment id), but `quoteShipping` does not surface it and `buyLabel` never writes it. The column is nullable and always null in practice — dead schema. clean-code.mdc § Abstraction Discipline: "Dead code — delete, don't comment out." Either wire it (store the Shippo shipment id at quote time) or drop the column. Minor (no behavior impact; reconciliation in P12 keys off `shippoTransactionId`, which is written).

### m13 — `ShippingQuote` written on every label buy, not just checkout (R-155 intent drift)
**Sources:** rules Minor 4
**Location:** `lib/shipping/labels.ts:141` (`quoteShipping({ parcels, destination, scope: { packageId } })` with default `persist: true`)
**Claim:** R-155 frames `ShippingQuote` as the checkout rate-lock record. `buyLabel` calls `quoteShipping` with the default `persist: true`, so every label purchase also writes a `ShippingQuote` row against the package. This is harmless (the row is honest) but means the `shipping_quotes` table mixes checkout rate-locks with label-purchase quotes against two different foreign keys (`orderId` vs `packageId`), and the P12 reconciliation view will need to distinguish them. Minor (schema allows both; the `scope` union is intentional — just note it for the P12 report). Distinct from m3 (growth/GC vs intent/scope).

### m14 — `["PURCHASING", "PURCHASED"]` active-shipment set is an unowned magic value
**Sources:** clean-code Minor 1
**Location:** `lib/shipping/labels.ts:60` (query `shipments: { where: { status: { in: ["PURCHASING", "PURCHASED"] } } }`); `lib/shipping/labels.ts:121` (`pkg.shipments.length > 0`); `lib/shipping/labels.ts:229` / `:282` (`find(... === "PURCHASED")`)
**Claim:** The "active shipment" set and the "purchased" singleton are spelled inline three times. The `ShipmentStatus` enum owns the four values; the active subset belongs next to it (or as an exported `ACTIVE_SHIPMENT_STATUSES` const in `lib/shipping/labels.ts`). Violates: magic values, duplicated logic.

### m15 — `find(... === "FAILED")` picks "first" not "last" (and the PURCHASED find is duplicated)
**Sources:** clean-code Minor 2
**Location:** `lib/shipping/labels.ts:229` (`voidLabel` find PURCHASED); `lib/shipping/labels.ts:282` (`refreshTracking` find PURCHASED); `app/(admin)/admin/packages/[packageId]/label-actions.tsx:43` (`find(... === "FAILED")`); `lib/shipping/labels.ts:60` (`loadShippedPackage` orders by nothing)
**Claim:** `voidLabel` and `refreshTracking` both run `pkg.shipments.find((shipment) => shipment.status === "PURCHASED")` — duplicated. `label-actions.tsx:43` does `find(... === "FAILED")` to show "last attempt failed", but `find` returns the first match in array order, and `loadShippedPackage` orders shipments by nothing (Prisma default order), while the detail page (`page.tsx:46`) orders `{ createdAt: "desc" }`. "Last failed" can therefore show an earlier failure if multiple exist. Extract a `pickActiveShipment(pkg)` helper for the PURCHASED find, and either sort or use `findLast` for the failed one. Distinct from m9 (m9 is the `take: 5` missing-row problem; this is the in-memory first-not-last + duplicated-find problem).

### m16 — `AuditAction` lags `PackageEventAction` for P8 events (type drift)
**Sources:** clean-code Minor 3
**Location:** `lib/packages/stages.ts:27-38` (`PackageEventAction` extended with `label_buy`, `label_failed`, `label_void`, `tracking_refresh`, `address_validate`); `lib/audit.ts:4-43` (`AuditAction` extended with only `label_buy` and `label_void`)
**Claim:** Today `recordAudit` is only called for `label_buy` and `label_void`, so the compiler is happy — but `tracking_refresh` and `address_validate` already produce `PackageEvent` rows and are plausible audit candidates (P9 reroute audit, P12 reconciliation). The two unions will drift further the next time someone adds a `recordAudit` call for a P8 event and forgets to extend `AuditAction`; the type system won't catch it until compile. Keep the two lists in lockstep or derive `AuditAction` from `PackageEventAction` with an explicit allow-list. Violates: type/schema drift, one-typing-discipline-per-concern.

### m17 — Banned standalone name `result` in `label-actions.tsx`
**Sources:** clean-code Minor 4
**Location:** `app/(admin)/admin/packages/[packageId]/label-actions.tsx:49` (`const result = await apiFetch<...>(path, ...)`)
**Claim:** `result` is on the clean-code banned list as a standalone name. Rename to `response` or `apiResponse` (the fetch result is a response object). The same file's `validation` and `note` are fine.

### m18 — `carrierOf` is a normalizer named like a getter
**Sources:** clean-code Minor 5
**Location:** `lib/shipping/margin.ts:27-29` (`carrierOf(provider)` returns `provider.trim().toLowerCase()`)
**Claim:** The name reads as "give me the carrier of this provider" (a lookup), not "normalize this provider string to the carrier key." Rename to `normalizeCarrier` so it matches the `normalizeRates` / `normalizePostalCode` / `normalizeWhitespace` family already in the codebase. Violates: naming (function names describe what they DO), consistency.

## Dedupe map

| Aggregate | Merged sources |
|---|---|
| M1 | security M1 ; quality Major 3 ; rules M2 |
| M2 | security M2 ; quality Major 4 |
| M9 | security M3 ; quality Minor 6 (Major + Minor → Major) |
| m1 | quality Minor 8 ; clean-code Minor 6 |
| m2 | rules Minor 2 ; clean-code Minor 7 |
| m3 | quality Minor 7 ; rules Minor 3 |
| m4 | quality Minor 11 ; rules Minor 5 |

All other aggregate IDs are single-source. No new findings introduced.

Related-but-distinct pairs kept separate:
- **m5 vs m7** (security): both touch `ShippoApiError` body handling — m5 is client exposure of the raw body, m7 is the truncation shape cutting mid-field. Different claims.
- **m3 vs m13** (rules/quality): both touch `ShippingQuote` rows — m3 is unbounded growth / no GC, m13 is intent drift (checkout rate-lock vs label-purchase quote mixing). Different claims.
- **m9 vs m15** (quality/clean-code): both touch the "last failed" derivation in `label-actions.tsx:43` — m9 is the `take: 5` missing-row problem, m15 is the in-memory `find` first-not-last plus the duplicated PURCHASED find. Different defects.
- **m4 vs m12** (rules): both touch migration/schema hygiene — m4 is the hand-patched `_prisma_migrations` history, m12 is the dead `shippoShipmentId` column. Different locations and claims.

## Pass notes (not counted)

- **Auth boundary** (security PASS): every admin label endpoint gates on `requireApiPermission("fulfillment.manage")`; the dev fixture is hard-disabled on any Vercel deploy (`isDevAuthBypass` checks `VERCEL_ENV` not `NODE_ENV`); the Shippo token is optional and fails closed (`ShippoNotConfiguredError` → 503); the cron bearer pattern is consistent. Prisma parameterizes every query (no SQL injection). Audit rows written for staff-initiated label mutations. The four security findings are money-path integrity / cost-abuse / info-leak gaps, not boundary breaches.
- **Margin law (UR-003, G-006)** (rules PASS): `lib/shipping/margin.ts` is pure — `resolveMargin` charges `eligible[eligible.length-1]`, buys `eligible[0]`, books `marginCents = charge − buy`. Single-carrier → margin 0, honestly recorded. Ground-comparable service tokens prevent the FedEx-Ground-vs-UPS-Next-Day fabrication the merged plan flagged as risk #2. USPS gated on `SHIPPO_INCLUDE_USPS`.
- **R-175 compensation** (rules PASS, with M8 gap): `buyLabel`'s catch flips the row to `FAILED` with the carrier reason and writes a `label_failed` event; the paid order total is never touched on a label failure. M8 is the post-success-DB-failure misrepresentation, not the carrier-rejection path.
- **R-177 validate-before-money** (rules PASS): `buyLabel` calls `validateAddress` before any row is created; an undeliverable address 422s with an `address_validate` event and no `Shipment` row. `validatePackageAddress` exposes the same check on demand.
- **R-176 tracking** (rules PASS, with B1 gap): `refreshTracking` pulls carrier status onto the row with a `tracking_refresh` event — but only when it can reach the row; B1 is the terminal-stage guard blocking the only stage where it matters.
- **R-081 bin packing** (rules PASS, with m11 gap): `planParcels` (first-fit-decreasing, 85% fill cap, smallest fitting box, sorted-dims dimensional check) with `PackageType.weightGrams` fallback for products without dims — never under-declares. m11 is a cost-accuracy best-fit improvement, not an under-declaration.
- **R-055 / R-183 / R-184 env** (rules PASS): `env-spec.ts` declares `SHIPPO_API_TOKEN`, `SHIPPO_BASE_URL`, `SHIPPO_FEDEX_ACCOUNT_ID`, `SHIPPO_UPS_ACCOUNT_ID`, `SHIPPO_INCLUDE_USPS`, and `UPS_CLIENT_ID`/`UPS_CLIENT_SECRET` as declaration-only (R-184 — never read by code, comment says so). `.env.example` regenerated and current (P7's stale-example Major is fixed).
- **No new dependency** (rules PASS): Shippo runs over native `fetch` + `zod`; the `shippo` npm package is deliberately not added (ponytail ladder: stdlib + native + existing deps cover it). `pdf-lib` is now pinned to `1.17.1` (P7 Major M3 fixed).
- **Error handling consistency** (rules PASS): one `mapDomainError` ladder per route; `ShippoNotConfiguredError` → 503, `ShippoApiError`/`LabelPurchaseError`/`LabelVoidError` → 502, `DomainRuleError` → 422, `NotFoundError` → 404. Typed errors with `status`/`name`.
- **Concurrency on the active-label guard** (rules PASS): the partial unique index `shipments_one_active_per_package` plus the `P2002` catch in `buyLabel` makes two concurrent buys race-decided with the same 422 a serial attempt would get (R-072).
- **UI consistency** (rules PASS): `PackageLabelActions` reuses `Card`, `Button`, `formatCents`, the existing `apiFetch`; `data-*` attributes mirror the test-hook convention. Failed/voided attempts stay visible — staff see the cause.
- **Checkout SHIPPED integration** (rules PASS, with M3 gap): `submit.ts` re-quotes inside the tx and freezes `deliveryFeeCents` from the live quote; a stale page total 409s (R-034/R-037). Display quotes persist nothing. M3 is the HTTP-inside-tx scaling risk, not a correctness gap.
- **Codegraph rule** (rules PASS): the arm's `.codegraph/` index exists; init obligation met.
- **Vocabulary rule** (rules PASS): no command-scope words in the reviewed artifacts.
- **No secrets committed** (rules PASS): `.env` is gitignored; `SHIPPO_API_TOKEN` lives only in the local `.env`; `.env.example` carries placeholders only.

## Bottom line

No Critical. P8 arm-06 is functionally complete against EXPECTED (all five items implemented, smoke S1–S3 pass 19/0, domain suite 29 checks, unit suite covers margin/packing/lifecycle). The single Blocker (B1) is a real correctness regression on the R-176 tracking-refresh path that the smoke and domain suites do not exercise — `refreshTracking` is refused at the only stage where it matters. The 9 Majors cluster on the money path: the stuck-`PURCHASING` recovery hole (M1, raised by all three non-security specialists plus security), the unreconciled async void refund (M2), HTTP-inside-the-checkout-tx scaling risk (M3), unvalidated `costCents` parse (M4), the merged-package margin-ledger divergence (M5), the `line2` quote-path drop (M6), the dead `shipping.rates` setting (M7), the post-success `FAILED` mislabel (M8), and unbounded display-quote Shippo calls (M9). The 18 Minors are dead-schema/duplication, magic-value, info-leak, doc/hygiene, and packing-accuracy cleanups. The P7 Major M3 (`pdf-lib` caret range) is fixed; the P7 clean-code drifts (terminal-stages list, sort tiebreaker) are not regressed. Out-of-scope items (package shipping P9, reconciliation P12) are correctly deferred; several Majors (M1, M2, M5, M9) explicitly tee up P12 reconciliation work.
