# P8 Clean-code review — arm-06

**Phase:** P8 — Shipping: Shippo, rate margin, labels (per `shared/phases/PHASE-P8-EXPECTED.md` and `shared/MERGED-BUILD-PLAN.md` § P8)
**Rule source:** `arms/arm-06/.cursor/rules/clean-code.mdc`
**Scope:** new and modified files under `arms/arm-06/workspace/` for P8 — `lib/shipping/*`, `lib/checkout/shipping-quotes.ts`, `app/api/admin/packages/[packageId]/label*/route.ts`, `app/api/dev/shippo-fixture/*`, `app/(admin)/admin/packages/[packageId]/label-actions.tsx`, `lib/packages/grouping.ts`, `lib/packages/materialize.ts`, `lib/env-spec.ts`, `lib/settings.ts`, `prisma/schema.prisma` (Shipment/ShippingQuote/ShipmentBox), `scripts/test-p8.mts`.
**Mode:** findings only, no fixes. Blind to model name.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 3 |
| Minor | 7 |

## Major

### M1 — `line2` dropped on the Shippo quote path (type/schema drift + functional consequence)
`ShippoAddress` (`lib/shipping/shippo.ts:51`) carries `line2?: string | null`, and the label-purchase path uses it — `destinationFor` in `lib/shipping/labels.ts:87-95` builds `{ name, line1, line2, city, region, postalCode, country }`. But the checkout quote path goes through `RecipientQuoteTarget` (`lib/checkout/shipping-quotes.ts:13-21`), which has no `line2` field, and `quoteRecipientShipping` builds the destination without it:

```62:71:arms/arm-06/workspace/lib/checkout/shipping-quotes.ts
    destination: {
      name: input.recipient.name,
      line1: input.recipient.line1,
      city: input.recipient.city,
      region: input.recipient.region,
      postalCode: input.recipient.postalCode,
      country: input.recipient.country,
    },
```

`CheckoutRecipientProps` (`lib/checkout/recipient-props.ts:6-20`) also omits `line2` as a standalone field (it only appears folded into `addressLine`). So both the display quote (`quoteCheckoutShipping`) and the submit re-quote (`submit.ts:124`) send Shippo an address with no apartment/suite. The customer is charged on a quote for an incomplete address, then the label is bought against the full address — address validation at label time can fail where the quote succeeded, and the rate can differ for carrier services that zone on full address. `RecipientQuoteTarget` should match `ShippoAddress` (or be `ShippoAddress` plus `id`), and `buildCheckoutRecipients` should expose `line2` so the quote path and the label path see the same destination. Violates: type/schema drift, one-pattern-per-concern.

### M2 — `shipping.rates` setting is editable but unread by any business logic (dead config + schema drift)
P8 replaced the P5 placeholder rate path with live Shippo quotes for `SHIPPED` and `delivery.fees` for the two delivery channels. `lib/settings.ts:14` still declares `"shipping.rates": z.array(z.object({ name, feeCents }))`, and the settings hub (`app/(admin)/admin/settings/settings-tabs.tsx:103-106, 364-369`) still lets managers add/edit rows with a `feeCents` value — but no checkout or label path reads `shipping.rates`:

- `resolveDeliveryFeeCents` (`lib/checkout/fulfillment.ts:83`) reads `delivery.fees`.
- `quoteRecipientShipping` / `quoteShipping` read live Shippo.
- A repo-wide search for `shipping.rates` returns only `settings.ts`, the admin settings route, and the settings UI.

A manager can configure a rate table that the system silently ignores — the exact "looks configured but does nothing" trap the clean-code rule calls out as dead code. Either wire it (if it still means something for a non-carrier channel) or drop the schema key, the settings-tab editor, and the route allow-list entry. `shipping.rules` (name + description, no `feeCents`) is informational and fine to keep; `shipping.rates` is not. Violates: dead code, schema drift.

### M3 — `buyLabel` marks the Shipment `FAILED` even when the carrier transaction succeeded
`lib/shipping/labels.ts:167-219` wraps both `buyLabelTransaction` and the `prisma.$transaction` (which persists `PURCHASED` + audit) in one try/catch. If `buyLabelTransaction` returns `SUCCESS` but the follow-up DB transaction throws (connection drop, `P2002` on a concurrent re-buy, `recordAudit` failure), the catch runs:

```215:216:arms/arm-06/workspace/lib/shipping/labels.ts
    await prisma.shipment.update({ where: { id: shipment.id }, data: { status: "FAILED", error: detail } });
    await writeEvent(prisma, pkg.id, "label_failed", actorId, { shipmentId: shipment.id, error: detail });
```

The label was actually purchased at Shippo — the org is paying for it carrier-side — but the local row flips to `FAILED` and the package becomes "label-less" from the staff UI's view. The R-175 comment ("the failed attempt is recorded with the carrier's reason and the package stays label-less; the paid order total is never touched") describes a carrier rejection, not a post-success DB failure. The catch needs to distinguish "transaction never succeeded" (mark FAILED) from "transaction succeeded, DB persist failed" (leave PURCHASING or escalate for reconciliation). Violates: error handling (error messages say what went wrong AND the expected state), anti-AI-tics ("just in case" code that misrepresents state).

## Minor

### m1 — `["PURCHASING", "PURCHASED"]` active-shipment set is an unowned magic value
`lib/shipping/labels.ts:60` queries `shipments: { where: { status: { in: ["PURCHASING", "PURCHASED"] } } }`, then `buyLabel` checks `pkg.shipments.length > 0` and `voidLabel`/`refreshTracking` each do `pkg.shipments.find((shipment) => shipment.status === "PURCHASED")`. The "active shipment" set and the "purchased" singleton are spelled inline three times. The `ShipmentStatus` enum owns the four values; the active subset belongs next to it (or as an exported `ACTIVE_SHIPMENT_STATUSES` const in `lib/shipping/labels.ts`). The `find(... === "PURCHASED")` is also duplicated between `voidLabel` and `refreshTracking`. Violates: magic values, duplicated logic.

### m2 — `find(... === "PURCHASED")` duplicated, plus a `find` for `FAILED` that picks "first" not "last"
`voidLabel` (`labels.ts:229`) and `refreshTracking` (`labels.ts:282`) both run `pkg.shipments.find((shipment) => shipment.status === "PURCHASED")`. `label-actions.tsx:43` does `shipments.find((shipment) => shipment.status === "FAILED")` to show "last attempt failed" — but `find` returns the first match in array order, and the query orders shipments `{ createdAt: "desc" }` only on the detail page (`page.tsx:46`), not in `loadShippedPackage` (`labels.ts:60` orders by nothing, so Prisma returns default order). "Last failed" can show an earlier failure if multiple exist. Extract a `pickActiveShipment(pkg)` helper for the PURCHASED find, and either sort or use `findLast` for the failed one. Violates: duplicated logic, naming ("last" that isn't).

### m3 — `AuditAction` lags `PackageEventAction` for P8 events (type drift)
`lib/packages/stages.ts:27-38` extends `PackageEventAction` with `label_buy`, `label_failed`, `label_void`, `tracking_refresh`, `address_validate`. `lib/audit.ts:4-43` extends `AuditAction` with only `label_buy` and `label_void`. Today `recordAudit` is only called for those two, so the compiler is happy — but `tracking_refresh` and `address_validate` already produce `PackageEvent` rows and are plausible audit candidates (P9 reroute audit, P12 reconciliation). The two unions will drift further the next time someone adds an `recordAudit` call for a P8 event and forgets to extend `AuditAction`; the type system won't catch it until compile. Keep the two lists in lockstep or derive `AuditAction` from `PackageEventAction` with an explicit allow-list. Violates: type/schema drift, one-typing-discipline-per-concern.

### m4 — Banned standalone name `result` in `label-actions.tsx`
`app/(admin)/admin/packages/[packageId]/label-actions.tsx:49` declares `const result = await apiFetch<...>(path, ...)` — `result` is on the clean-code banned list as a standalone name. Rename to `response` or `apiResponse` (the fetch result is a response object). The same file's `validation` and `note` are fine.

### m5 — `carrierOf` is a normalizer named like a getter
`lib/shipping/margin.ts:27-29` exports `carrierOf(provider)` that returns `provider.trim().toLowerCase()`. The name reads as "give me the carrier of this provider" (a lookup), not "normalize this provider string to the carrier key." Rename to `normalizeCarrier` so it matches the `normalizeRates` / `normalizePostalCode` / `normalizeWhitespace` family already in the codebase. Violates: naming (function names describe what they DO), consistency.

### m6 — `GROUND_SERVICE_TOKENS` is a hardcoded carrier-service map with no setting seam
`lib/shipping/margin.ts:21-25` hardcodes the ground-comparable service tokens per carrier (`fedex_ground`, `fedex_home_delivery`, `ups_ground`, `usps_priority`, `usps_ground_advantage`). The merged plan flags this exact set as open risk #2 ("which services count as comparable?"). It's pure and unit-tested, but it's a magic map the org cannot tune without a code change — and the moment Shippo renames a token (or the org adds a negotiated service level), eligibility silently drops that carrier from the margin contest with no signal. Either move it to a typed setting (`shipping.groundServiceTokens`) or document in `README` § Rule Preferences that this is intentionally code-owned. Violates: magic values, dependency discipline (config the org can't reach).

### m7 — `voidActiveShipmentForReroute` is a 1-line passthrough wrapper
`lib/shipping/labels.ts:272-278` defines `voidActiveShipmentForReroute(input) { return voidLabel(input); }` — a one-line forwarder with no logic. The clean-code "no wrapper under 5 lines with no logic" rule is written for JSX components, but the same anti-fluff spirit applies to functions. The P9 hook would read just as clearly as `voidLabel({ ..., reason })` at the call site, or `voidLabel` could be aliased on export. Left as Minor because the distinct name documents the P9 reroute contract; if kept, a one-line comment pointing at the P9 caller is enough.

## Notes (not findings)

- `lib/shipping/margin.ts` is correctly pure (no HTTP, no DB) and unit-tested in `scripts/test-p8.mts` — the UR-003 law (charge = highest eligible, buy = cheapest eligible, margin = spread) is exercisable without a live Shippo account. Good separation.
- `lib/shipping/fixture-double.ts` is a documented dev double gated by `DEV_AUTH_BYPASS` and disabled on any Vercel env (`lib/env.ts:34`); the zip-zoned pricing that flips which carrier is expensive is a clean way to prove selection follows the math rather than a hardcoded carrier.
- `ShippoNotConfiguredError` → 503, `ShippoApiError` / `LabelPurchaseError` / `LabelVoidError` → 502, `DomainRuleError` → 422, `NotFoundError` → 404: the four label routes use the shared `mapDomainError` ladder consistently — no route invents its own status mapping.
- `lib/packages/grouping.ts` extending `PackageGroupInput` with an optional `addressKey` (and `materialize.ts` passing it only for `SHIPPED`) is a minimal, documented way to make guest SHIPPED packages group by inline address instead of the null book id — no schema change, no drift.
- `Shipment.parcels` is stored as the bin-packing snapshot at label-buy time (`labels.ts:154`), so a re-quote after a box-config change is comparable to the original — good reconciliation hygiene for P12.
- `lib/env-spec.ts` keeps the R-184 UPS direct credentials as declaration-only (`UPS_CLIENT_ID` / `UPS_CLIENT_SECRET` are `optional()` and never read by code), matching the plan's "declared-but-unused" contract exactly.
