# P8 Rules Review — arm-05 (blind)

**Phase:** P8 — Shipping: Shippo, rate margin, labels
**Ruleset:** `.cursor/rules/` (workflow, vocabulary, codegraph, ponytail, clean-code — all `alwaysApply: true`)
**Scope:** P8 code only. Findings only — no fixes.

## Summary counts

| Severity | Count |
|---|---|
| High | 2 |
| Medium | 6 |
| Low | 6 |
| **Total** | **14** |

## Findings

### HIGH-1 — Label purchase race; no concurrency guard on the "existing label" check
- **Location:** `lib/shipping.ts` `createPackageLabel` (lines 150–209)
- **Claim:** The active-label guard (`existingLabel = shipmentBoxes.find(...)`) runs outside the transaction, then the external `buyLabel` runs before the transaction opens. Two concurrent `create_label` calls for the same package both pass the guard, both buy external labels, and both transactions commit `ShipmentBox` rows. `externalLabelId` is `@unique` but the two Shippo transactions return different IDs, so neither insert is rejected.
- **Rule:** `workflow.mdc` Execution Discipline ("Never silently choose business logic"); `clean-code.mdc` Error Handling. The plan flags "Package ↔ inventory ↔ payment coupling" and "Payment and fulfillment races" as known P5/P7/P8 risks requiring "idempotency keys, transactions, immutable paid snapshots, conflict responses." No version check or row lock guards the purchase.
- **Evidence:** `lib/shipping.ts:154` `const existingLabel = quoted.packageRecord.shipmentBoxes.find((box) => box.externalLabelId && !box.labelVoidedAt);` runs on a stale read; `lib/shipping.ts:156` `const label = await quoted.client.buyLabel(...)` precedes `prisma.$transaction` at line 158.

### HIGH-2 — Silent business-logic choices with no DECISION-LOG entry
- **Location:** `lib/shippo.ts` `isGroundEquivalent` (94–96), `selectMarginRate` (98–109), fixture/live expiry (86, 143)
- **Claim:** Three domain rules are hardcoded with no DECISION-LOG entry or flag: (a) which service levels count as "ground-equivalent" (regex `/ground|home delivery|standard/i`), (b) 30-minute rate expiry applied to both fixture and live quotes, (c) "charge highest eligible, buy cheapest eligible" without defining what makes a rate "eligible" beyond carrier + ground + non-negative + not-expired.
- **Rule:** `workflow.mdc` Execution Discipline — "Never silently choose business logic (calculations, domain rules) — log in DECISION-LOG.md and flag." `MERGED-BUILD-PLAN.md` § P8 open question #4 explicitly defers "Shippo service levels eligible for high-quote/low-purchase comparison" as an open question. No `DECISION-LOG.md` exists in `workspace/`.
- **Evidence:** `lib/shippo.ts:94` `function isGroundEquivalent(rate) { return /ground|home delivery|standard/i.test(rate.service); }`; `lib/shippo.ts:86` `const expiresAt = new Date(Date.now() + 30 * 60 * 1000);` reused at line 143 for live rates.

### MEDIUM-1 — Swallowed error in label-purchase compensation
- **Location:** `lib/shipping.ts:204–208`
- **Claim:** The compensation path voids the just-purchased label with `.catch(() => undefined)`, discarding any void failure. The user is told persistence failed but the external label may remain active (orphaned), with no audit trail of the failed void.
- **Rule:** `clean-code.mdc` Error Handling — "No swallowed errors (empty catch blocks)"; "Error messages say what went wrong AND what the expected state was."
- **Evidence:** `lib/shipping.ts:205` `await quoted.client.voidLabel(label.id).catch(() => undefined);` followed by a generic throw at line 207.

### MEDIUM-2 — External void before local update; no compensation on transaction failure
- **Location:** `lib/shipping.ts` `voidPackageLabel` (211–221)
- **Claim:** `voidLabel` is called against Shippo before the local `ShipmentBox.labelVoidedAt` update runs in a transaction. If the transaction fails, the label is voided externally but still marked active locally — the inverse of HIGH-1's orphan, with no compensating retry or audit.
- **Rule:** `workflow.mdc` Execution Discipline; `clean-code.mdc` Error Handling. Plan risk "Package regrouping after downstream work" calls for "compensating label voids, artifact supersession, audit records."
- **Evidence:** `lib/shipping.ts:216` `await createShippoClient().voidLabel(shipmentBox.externalLabelId);` precedes `prisma.$transaction([...])` at line 217.

### MEDIUM-3 — Hidden write inside a function named like a query
- **Location:** `lib/shipping.ts` `parcelForPackage` (61–96)
- **Claim:** `parcelForPackage` reads as a getter but performs a `prisma.package.update` to persist a re-selected `packageTypeId` (lines 83–85). A function whose name promises "parcel for package" silently mutates the package record.
- **Rule:** `clean-code.mdc` Naming Conventions — "Function names describe what they DO"; `ponytail.mdc` "smallest complete change. No drive-by rewrites. No silent scope creep."
- **Evidence:** `lib/shipping.ts:83` `if (packageRecord.packageTypeId !== selectedBox.id) { await prisma.package.update({ where: { id: packageId }, data: { packageTypeId: selectedBox.id } }); }` inside `parcelForPackage`.

### MEDIUM-4 — Inconsistent transaction patterns in one file
- **Location:** `lib/shipping.ts` (`createPackageLabel` vs `voidPackageLabel`/`refreshPackageTracking`)
- **Claim:** `createPackageLabel` uses the interactive form `prisma.$transaction(async (transaction) => …)`; `voidPackageLabel` (217) and `refreshPackageTracking` (228) use the array form `prisma.$transaction([...])`. Two transaction styles for the same concern (shipping mutations) in one module.
- **Rule:** `clean-code.mdc` Consistency — "One pattern per concern… pick one, apply everywhere"; `ponytail.mdc` "inconsistent patterns — pick one, apply everywhere."
- **Evidence:** `lib/shipping.ts:158` interactive form; `lib/shipping.ts:217` and `:228` array form.

### MEDIUM-5 — Least-privilege inverted on read-only shipping actions
- **Location:** `app/api/admin/packages/[packageId]/shipping/route.ts` (19–37)
- **Claim:** All four shipping actions gate on `orders.write`, including `validate_address` and `refresh_tracking` which are read-only against Shippo. A staff member with only `orders.read` (the permission used by the order detail GET) cannot validate an address or refresh tracking even though those operations mutate no local state.
- **Rule:** `workflow.mdc` Security Basics — "Least privilege by default."
- **Evidence:** `app/api/admin/packages/[packageId]/shipping/route.ts:20` `const authorization = await authorize(request, "orders.write");` runs for every action including `validate_address` (line 37) and `refresh_tracking` (line 34).

### MEDIUM-6 — No rate-expiry enforcement between quote and payment
- **Location:** `lib/checkout.ts` `saveCheckoutDetails` (127–153); `lib/shippo.ts` rate `expiresAt` (86, 143)
- **Claim:** Live Shippo quotes carry a 30-minute `expiresAt`, but `saveCheckoutDetails` stores `shippingQuotes` in the wire format and computes `fulfillmentCents` without re-checking expiry when the Stripe session is created or when the webhook finalizes. A customer who sits on the hosted checkout past the rate window pays a stale quote.
- **Rule:** Plan R-155 "shipping quotes with expiring options"; `workflow.mdc` "Never silently choose business logic."
- **Evidence:** `lib/checkout.ts:132` `const shippingQuotes = await quoteCheckoutShipping(shippingAddresses);` then `lib/checkout.ts:135` `checkout = { ..., shippingQuotes }` stored verbatim; no `expiresAt` check in `completeCheckout` (238–314).

### LOW-1 — Boolean name does not read as a yes/no question
- **Location:** `lib/shippo.ts:82`
- **Claim:** `reversesCarriers` is a verb-phrase boolean. The rule wants booleans to read as yes/no questions (`isActive`, `hasPermission`).
- **Rule:** `clean-code.mdc` Naming Conventions — "Boolean names read as yes/no questions."
- **Evidence:** `const reversesCarriers = Number.parseInt(postalCode.at(-1) ?? "0", 10) % 2 === 0;`

### LOW-2 — Unsafe `as Carrier` cast before the eligibility filter
- **Location:** `lib/shippo.ts:145`
- **Claim:** `rawRate.provider?.toUpperCase() as Carrier | undefined` asserts any provider string is a member of the `Carrier` union before `eligibleCarriers.has(carrier)` filters it. The cast is not redundant (compiler wouldn't narrow string → union), but it is unsound — an unknown provider becomes `"DHL"` typed as `Carrier`, then the `has` check catches it. The cast hides the "unknown provider" state from the type system.
- **Rule:** `clean-code.mdc` Anti-AI-Tics — "No redundant type assertions the compiler already guarantees"; Anti-Hallucination — "Do not invent library APIs… from memory."
- **Evidence:** `lib/shippo.ts:145` `const carrier = rawRate.provider?.toUpperCase() as Carrier | undefined;`

### LOW-3 — Magic value `"SHIP"` and `30 * 60 * 1000` repeated
- **Location:** `lib/shipping.ts:44`; `lib/shippo.ts:86, 143`
- **Claim:** The fulfillment method code `"SHIP"` is a literal in `shippablePackage` while `lib/checkout.ts` defines a `deliveryModes` const tuple. Rate expiry `30 * 60 * 1000` is duplicated in fixture and live paths with no named constant.
- **Rule:** `clean-code.mdc` Refactor categories — "Magic values — named constants / enums"; Consistency — "one pattern per concern."
- **Evidence:** `lib/shipping.ts:44` `fulfillmentMethod: { code: "SHIP" }`; `lib/shippo.ts:86` and `:143` both compute `new Date(Date.now() + 30 * 60 * 1000)`.

### LOW-4 — Fixture tracking number inconsistent with purchased label
- **Location:** `lib/shippo.ts:169`
- **Claim:** Fixture `refreshTracking` returns `TRACK-${labelId.slice(-12)}` while fixture `buyLabel` returns `TRACK-${rateId.slice(-12)}`. After a void/rebuy the second label's tracking number differs from the first, but a `refreshTracking` call on the first label would produce a tracking number derived from a different ID than `buyLabel` returned. Fixture data is internally inconsistent.
- **Rule:** `clean-code.mdc` Consistency; `workflow.mdc` "Verify in the running app."
- **Evidence:** `lib/shippo.ts:165` `trackingNumber: \`TRACK-${rateId.slice(-12).toUpperCase()}\``; `lib/shippo.ts:169` `trackingNumber: \`TRACK-${labelId.slice(-12).toUpperCase()}\``.

### LOW-5 — `numberValue` helper name is vague
- **Location:** `lib/shipping.ts:38–40`
- **Claim:** `numberValue` describes its return type, not what it does. It converts a Prisma `Decimal | null` to `number | null`. A reader has to look at the body to know it handles `null` and calls `Number()`.
- **Rule:** `clean-code.mdc` Naming Conventions — "Function names describe what they DO"; banned standalone names include `val`.
- **Evidence:** `function numberValue(value) { return value === null ? null : Number(value.toString()); }`

### LOW-6 — Redundant `apiToken` override at live-client construction
- **Location:** `lib/shippo.ts:243`
- **Claim:** `createLiveClient({ ...environment, apiToken: environment.apiToken })` spreads `environment` then overrides `apiToken` with the same field. The override is a no-op; the spread already carries `apiToken`.
- **Rule:** `ponytail.mdc` "Subtract, don't add"; `clean-code.mdc` Anti-AI-Tics — "No 'just in case' code — every line must have a reason."
- **Evidence:** `lib/shippo.ts:243` `return environment.apiToken ? createLiveClient({ ...environment, apiToken: environment.apiToken }) : createFixtureClient();`

## Notes

- `codegraph.mdc` (always-on) requires CodeGraph for structural lookups when the index is healthy. This review used Read/Glob/Grep because the workspace has no `.codegraph/` index (MCP catalog reports `user-codegraph` inactive for this workspace). Per `codegraph.mdc` "No index yet / MCP and CLI both unavailable after that attempt → Read/grep fallback for this run only," the fallback is permitted.
- No `DECISION-LOG.md`, `HANDOFF.md`, or `.scratch/phase-plan.md` exists in `workspace/` for P8, so expectation-file and gate-discipline artifacts required by `workflow.mdc` could not be inspected; their absence is noted but not scored as a P8 code finding.
