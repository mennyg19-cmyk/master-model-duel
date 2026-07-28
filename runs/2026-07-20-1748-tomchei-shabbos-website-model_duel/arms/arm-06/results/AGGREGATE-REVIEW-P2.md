# P2 Aggregate Review — arm-06 (blind)

Aggregator: external aggregate reviewer
Scope: `arms/arm-06/workspace/` — Test 4 P2 (Domain core: seasons, catalog, customers, orders, packages, payments, shipping, inventory)
Inputs: P2 specialist reviews (security, quality, rules, clean-code). No new findings.
Dedup: by location + claim; security blockers always survive (none reported). Conflict resolution: where specialists disagree on severity for the same location+claim, the higher severity wins; where a claim is a contingent consequence of another finding, both are retained but cross-linked.

## Counts

| Band | Before dedupe (sum across specialists) | After dedupe |
|---|---|---|
| Blocker | 0 | 0 |
| Major | 13 | 11 |
| Minor | 31 | 26 |

Source specialist counts (as submitted): security 0/4/10, quality 0/1/7, rules 0/3/4, clean-code 0/5/10.

---

## Blockers

None. No security blocker was reported by any specialist; none invented. The P2 code adds no new HTTP surface (engines live in `lib/`, exercised by `prisma/seed.ts` and `scripts/test-*.mts`), so there is no IDOR/CSRF/injection finding on new endpoints. The P1 authN/authZ layer (HMAC session, server-side `AuthSession` with expiry/revocation, role + override + impersonation-rank checks, audit trail with impersonator attribution) carries over unchanged and remains sound.

---

## Majors (11)

### A-M1. Customer phone dedupe is broken under concurrency
**Sources:** security M1; clean-code m9 (comment overclaims the safety the phone arm lacks).
**Files:** `prisma/schema.prisma` (`Customer.normalizedPhone` has `@@index` but no `@unique`); `lib/customers/dedupe.ts` (`findFirst` then `create`, no transaction/lock); `lib/customers/dedupe.ts:6-8` (comment claims race-safety from the unique email index only).
EXPECTED #2 mandates normalized phone/email dedupe. Email arm is backed by `Customer.email @unique` (second concurrent signup fails on `P2002`). Phone arm has only a non-unique index, so two concurrent signups with different emails but the same normalized phone both pass `findFirst` and both `create` — producing two `Customer` rows sharing `normalizedPhone`. Dedupe is silently defeated for the phone path under concurrent signups/checkout.

### A-M2. `discardOrder` has a TOCTOU race that can clobber a finalized order
**Sources:** security M2.
**File:** `lib/orders/state-machine.ts` (`discardOrder`, lines 55-65).
`finalizeOrder` is safe (claims order number, then `updateMany({ where: { id, status: "DRAFT" } })` so a second finalizer is a no-op → rollback). `discardOrder` is inconsistent: `findUnique` → `assertTransition(DRAFT, DISCARDED)` → `tx.order.update({ where: { id } })` with no status/version predicate. A concurrent T2 discard that read DRAFT before T1 finalized can overwrite `FINALIZED → DISCARDED`, `version++`, while order number N was already consumed from `seasons.lastOrderSeq` (permanent gap in the per-season sequence). Violates EXPECTED #8; same class of bug `finalizeOrder`'s guard exists to prevent. Use the identical `updateMany WHERE status=DRAFT` (or `version = expectedVersion`) pattern.

### A-M3. `createDraftOrder` trusts caller-supplied prices and product/option/add-on identities
**Sources:** security M3; security m4 (no non-negative validation on `qty`/`unitPriceCents`); quality m7 (no `parentLineId` validation on add-on lines); security m7 (no schema integrity constraint between `productId`/`addOnId`/`parentLineId`).
**File:** `lib/orders/create-draft.ts` (lines 20-60, esp. 31-34, 43-54, 53); `prisma/schema.prisma` (`OrderLine` model lines 319-338).
EXPECTED #3 requires "OrderLine tree with price snapshots." The engine accepts `unitPriceCents`, `optionPriceDeltaCents`, `productName`, `optionLabel`, `addOnId`, `parentLineId` directly from its caller and writes them to the snapshot with no cross-check against `Product.basePriceCents`, `ProductOptionValue.priceDeltaCents`, `AddOn.priceCents`, the product's `allowedAddOns`, or even that `productId`/`optionValueId`/`addOnId` exist. `OrderLine.productId`/`optionValueId`/`addOnId` are plain `String?` with no FK relation, so the DB cannot catch a fabricated id. `qty` and `unitPriceCents` are not validated non-negative, so a caller-supplied `qty: -1` or `unitPriceCents: -5000` produces a negative line/order total. Add-on lines can be written without a `parentLineId` and still be summed into `Order.totalCents`. The engine is the natural trust boundary for "snapshot the catalog's price, not the caller's"; any future checkout route forwarding client input to `createDraftOrder` is a price-injection and product-spoofing vulnerability. The schema-level XOR/integrity gap (m7) means the DB won't catch a bad writer later.

### A-M4. `postPayment` does not validate the target order's status
**Sources:** security M4.
**File:** `lib/payments/post.ts` (`postPayment` lines 7-26; `recomputePaymentStatus` lines 43-58); `voidPayment` (only checks payment row `status === POSTED`, not order status).
`postPayment` creates a `Payment` row and recomputes `Order.paymentStatus` unconditionally — never checks that the order is `FINALIZED`. A caller can post a payment against a `DRAFT` order (inflating a not-yet-submitted cart) or, worse, against a `DISCARDED` order, which then flips the discarded order's `paymentStatus` to `PARTIAL`/`PAID`/`OVERPAID`. No money movement in P2 (no HTTP surface), but the engine permits a payment/state-machine combination EXPECTED #4-5 implicitly forbid, and that later phases will expose.

### A-M5. `OrderLine.parentLineId` FK uses `ON DELETE SET NULL`, orphaning add-on lines on parent delete
**Sources:** quality M1.
**Files:** `prisma/migrations/20260728164419_domain_core/migration.sql:462`; `prisma/schema.prisma:323` (self-relation declared without explicit delete rule; Prisma defaulted to `SET NULL`).
Deleting a parent product line nulls every child add-on line's `parentLineId` instead of removing them, leaving orphaned add-on rows that still contribute to `Order.totalCents` and `paymentStatus` recomputation. No P2 flow deletes a single line yet, but the schema choice is locked in once the migration is applied; admin line-editing in a later phase will inherit the bug. EXPECTED #3 ("add-ons tree with price snapshots") implies the tree should stay consistent. Recommend `ON DELETE CASCADE` for this FK when the fix lands.

### A-M6. Dead domain functions with zero callers, against the README's own commitment
**Sources:** rules Major 1; clean-code M4 (getOpenSeason subset).
**Files:** `lib/seasons.ts` — `getOpenSeason` (zero callers); `lib/payments/post.ts` — `postPayment` (zero callers), `voidPayment` (zero callers); `lib/packages/stages.ts` — `advancePackageStage` (zero callers).
`README.md:48` states: "`lib/` holds only modules with live callers. Money/id/phone/date helpers land with the phase that first uses them (P2+), not before." P2 is the phase that introduces these concerns, yet the payment and stage-advance entry points have no consumer — not even a test. Unit scripts cover grouping, state-machine, order-numbers, inventory-race, permissions — none cover payments, stage advance, or `getOpenSeason`. `ponytail.mdc` Rule of 2 + "no boilerplate for later"; `clean-code.mdc` "no just-in-case code" + Anti-Hallucination. `PHASE-P2-STATUS.md` rows 5 and 8 mark payments and stage advance as DONE with the only evidence being the lib file itself — no runtime evidence exists. (Engine-phase defense holds for functions exercised by tests/seed — `createDraftOrder`, `finalizeOrder`, `reserveStock`, `groupPackageInputs` all have at least one test or seed caller. The four listed above have neither.)

### A-M7. Inconsistent error-handling in the `lib/` engine (typed classes vs plain `Error`)
**Sources:** rules Major 2; clean-code M2.
**Files:** typed — `InsufficientStockError` (`lib/inventory/reserve.ts`), `IllegalTransitionError` (`lib/orders/state-machine.ts`), `IllegalStageTransitionError` + `PackageConcurrencyError` (`lib/packages/stages.ts`); plain `Error` — `lib/orders/create-draft.ts:27,28`, `lib/orders/state-machine.ts:34,58`, `lib/inventory/reserve.ts:18,34`, `lib/packages/stages.ts:54`, `lib/payments/post.ts:48`.
Within the new P2 domain code, some domain failures raise typed error classes (so callers can `instanceof`-branch) and others raise plain `Error`. `clean-code.mdc` Consistency: "One error-handling approach per project." The README § Patterns table declares an error pattern only for API routes (inline `NextResponse.json({ error }, { status })`); there is no declared pattern for the domain engine, and the engine itself mixes two approaches. A caller that wants to distinguish "not found" from "illegal transition" can `instanceof` the latter but not the former.

### A-M8. Misleading error message in `finalizeOrder` race loser
**Sources:** rules Major 3.
**File:** `lib/orders/state-machine.ts:47-49`.
When the conditional `updateMany` returns `count === 0` (a concurrent finalizer won the race), the code throws `new IllegalTransitionError("FINALIZED", "FINALIZED")`, whose message renders as "Illegal order transition: FINALIZED → FINALIZED". The real condition is "another transaction already moved this order out of DRAFT" — the message names the wrong from-state and the wrong transition, so a caller reading the error is misled. `clean-code.mdc` Error Handling: "Error messages say what went wrong AND what the expected state was." A dedicated `OrderConcurrencyError` (mirroring `PackageConcurrencyError` in `stages.ts`) or a message that names the race would satisfy this.

### A-M9. Pattern drift: typed action union vs free-string `PackageEvent.action`
**Sources:** clean-code M1.
**Files:** `lib/audit.ts:4-14` (typed `AuditAction` union, every audit write funneled through `recordAudit`); `prisma/schema.prisma:384` (`PackageEvent.action` is `String`); `lib/packages/stages.ts:68` (raw `"stage_advance"` literal, no union/helper).
Two different typing disciplines for the same kind of field (event/action discriminator) in the same codebase — violates "one pattern per concern" (`clean-code.mdc` Consistency). Either both should be typed unions, or both free strings; the current split lets `PackageEvent.action` drift untyped as more event kinds land.

### A-M10. Naming collision: `lib/season.ts` vs `lib/seasons.ts`
**Sources:** clean-code M3; rules Minor 1 (rated Minor, contingent on A-M6 resolving).
**Files:** `lib/season.ts` (`getSeasonYear(date)` — Purim year computation, used by `app/(storefront)/page.tsx:3`); `lib/seasons.ts` (`getOpenSeason()` — DB lookup of the single open season, zero callers per A-M6).
Two files differing by a trailing `s` carry unrelated season concerns. The singular/plural split does not signal the concern difference and is easy to import wrong. `clean-code.mdc` Abstraction Discipline: "Split files by concern, not by line count." Consolidate under a `lib/seasons/` folder (`year.ts`, `queries.ts`) or rename to distinct intent-revealing names (`lib/season-year.ts`, `lib/open-season.ts`). Note: if `getOpenSeason` is dropped per A-M6, `lib/seasons.ts` goes away and the collision resolves — but if it is wired up instead, the collision persists, so the naming concern is independent of the dead-code finding.

### A-M11. Re-fetch + `as` cast pattern repeated three times (Rule of 2 + latent null bug)
**Sources:** clean-code M5; rules Minor 2 (rated Minor — frames the `as` as a redundant assertion, but agrees a null check + throw would be honest).
**Files:** `lib/orders/state-machine.ts:50-51`; `lib/packages/stages.ts:74-75`; `lib/payments/post.ts:37-39`.
All three do the same shape: `updateMany` (or `update`) → `findUnique` → `as Entity` to strip the `null`. `findUnique` genuinely returns `T | null`; the `as` cast hides a real "row vanished mid-transaction" possibility that should either be checked or be impossible by construction. Three near-identical sequences is a Rule-of-2 extraction candidate (e.g. a `reloadOrThrow(tx, id)` helper), and the unchecked cast is a latent bug. Severity: Major (clean-code) over Minor (rules) because the duplication + latent-bug framing is substantive; the rules Minor-2 "redundant assertion" framing is subsumed.

---

## Minors (26)

### Security

### A-m1. `buildGroupingKey` uses an unescaped `|` delimiter
**Sources:** security m1; clean-code m2 (the `"pickup"` sentinel is a related magic-string concern, kept as a separate finding A-m12).
**File:** `lib/packages/grouping.ts:18`.
Key is `recipientName | address | fulfillmentMethodCode | greeting` joined with `|`. `recipientName` and `greeting` are user-controllable and only whitespace/case-normalized — a `|` inside either field is not escaped, so two inputs that split differently across the delimiter produce the same key (e.g. recipientName=`"a|b"` + greeting=`""` vs recipientName=`"a"` + greeting=`"b"`). Result: packages that should split get merged, or vice versa. Use a separator that cannot appear in the normalized fields, or length-prefix each field.

### A-m2. `normalizePhone` accepts any digit length and assumes US for 10 digits
**Sources:** security m2.
**File:** `lib/phone.ts`.
A 1-character input becomes `+1`; a 7-digit local number becomes `+7digits`; any non-US 10-digit number is silently prefixed with `1` (Canada/US country code). No length plausibility check, so garbage strings dedupe to short keys and a malformed phone can collide with a real one. Documented as "US default" but the engine is the dedupe key producer, so the weakness flows into A-M1's index.

### A-m3. `findOrCreateCustomer` silently drops the phone on an email match
**Sources:** security m3.
**File:** `lib/customers/dedupe.ts:17-22`.
When an existing customer matches on `email` but the new input carries a different `phone`, the function returns `{ customer: existing, created: false }` and never updates `existing.phone` / `existing.normalizedPhone`. The caller's phone is silently lost. Not a security hole, but a data-integrity gap on the dedupe path that pairs with A-M1.

### A-m4. `createDraftOrder` does not validate `qty` or `unitPriceCents` are non-negative
**Sources:** security m4. (Folded into A-M3's narrative at Major severity; retained here as the discrete engine-level guard gap.)
**File:** `lib/orders/create-draft.ts:31-34, 53`.
`totalCents` and `lineTotalCents` are `qty * (unitPriceCents + optionPriceDeltaCents)`. A caller-supplied `qty: -1` or `unitPriceCents: -5000` produces a negative line total and a negative order total. `reserveStock` validates `qty > 0`, but the order engine does not, so an order can be created with a negative total and only caught later (or never, if the product is not inventory-tracked).

### A-m5. `finalizeOrder` does not re-check `season.status === "OPEN"`
**Sources:** security m5.
**Files:** `lib/orders/state-machine.ts` (`finalizeOrder` lines 31-53); cf. `lib/orders/create-draft.ts:28`.
`createDraftOrder` rejects a closed season; `finalizeOrder` does not. A draft created while the season was open can be finalized after the season is closed (UR-008's open/closed gate is "all selling" — finalization is arguably selling). Borderline business rule, but the asymmetry is a gap against EXPECTED #1's open/closed gate.

### A-m6. No constraint enforcing a single OPEN season
**Sources:** security m6; quality Notes (acknowledged as convention-enforced, not schema-enforced).
**Files:** `prisma/schema.prisma` (`Season` model lines 175-188); `lib/seasons.ts` (`getOpenSeason`).
Two rows with `status = "OPEN"` can coexist (no partial unique index on `status WHERE status = 'OPEN'`). `getOpenSeason` returns `orderBy: createdAt desc → first`, so the older open season silently stops receiving orders. EXPECTED #1 implies a single open season gates selling; the schema does not enforce it.

### A-m7. `OrderLine` has no integrity constraint between `productId`, `addOnId`, and `parentLineId`
**Sources:** security m7; quality m7 (engine-level: `createDraftOrder` does not validate add-on lines carry a `parentLineId`).
**File:** `prisma/schema.prisma` (`OrderLine` model lines 319-338); `lib/orders/create-draft.ts:43-54`.
A line can have both `productId` and `addOnId` set, or neither, and an add-on line is not required to have a `parentLineId`. The `InventoryItem` XOR is enforced via CHECK; `OrderLine` has no equivalent. Engine-only today (`createDraftOrder` writes every line in `input.lines` as a top-level create; `parentLineId` defaults to `null`), but the schema will not catch a bad writer later. EXPECTED #3's "add-ons tree" implies structure the function doesn't enforce.

### A-m8. `Package.recipientAddressId` uses `ON DELETE SET NULL`, leaving `groupingKey` stale
**Sources:** security m8.
**Files:** `prisma/schema.prisma` (`Package` model lines 342-362; FK on line 468 of the migration).
`groupingKey` is built from `recipientAddressId` (among other fields). If the address is deleted, the FK nulls `recipientAddressId` but `groupingKey` keeps the old address id baked in, so any future regrouping via `buildGroupingKey` would produce a different key for the same package. Stored grouping key and recomputed key diverge silently.

### A-m9. `StripePaymentIntent.clientSecret` and `raw` webhook payload stored in plaintext
**Sources:** security m9.
**File:** `prisma/schema.prisma` (`StripePaymentIntent` model lines 414-428).
`clientSecret` is a sensitive payment credential and `raw` is the full webhook payload (may carry PII/card-brand data). Both stored as plaintext columns. Schema-only this phase (no Stripe integration code ships in P2), but the schema design bakes in plaintext storage that later phases will inherit. Note for the migration, not a live leak.

### A-m10. `FulfillmentMethod.stages` is unvalidated `Json`
**Sources:** security m10; clean-code m7 (unvalidated `Json` → `PackageStage[]` cast).
**Files:** `prisma/schema.prisma` (`FulfillmentMethod.stages` line 370); `lib/packages/stages.ts` (`canAdvanceStage` lines 21-29; cast at line 56).
`stages` is `Json` with no check that it is a non-empty array of valid `PackageStage` values. `canAdvanceStage` uses `indexOf`, so an invalid `to` is rejected, but an empty `stages` array makes every advance throw `IllegalStageTransitionError` for a method that should be usable. `stages.ts:56` casts `pkg.fulfillmentMethod.stages as PackageStage[]` straight from the `Json` column — if a method row ever holds garbage or an unknown stage name, `canAdvanceStage` silently returns `false` and the package appears stuck with no diagnostic. A bad seed/admin write bricks fulfillment for that method with no clear error. A runtime validate-or-throw on read would make the data-driven design safe.

### Quality

### A-m11. Smoke report check counts are wrong
**Sources:** quality m1.
**File:** `.scratch/PHASE-P2-SMOKE.md` S2 says "9 checks" but `scripts/test-grouping.mts` has 10 `check()` calls (lines 23, 27, 32, 37, 42, 47, 52, 57, 62, 70). S3 says "14 checks" but `scripts/test-state-machine.mts` has 15 `check()` calls. Cosmetic, but the smoke doc is the evidence of record — a future re-run that produces the real count will look like a regression.

### A-m12. `test:unit` does not include the concurrent-finalization test; EXPECTED #10 calls it a "unit test"
**Sources:** quality m2.
**File:** `package.json:12` (`test:unit` runs `test-permissions.mts`, `test-grouping.mts`, `test-state-machine.mts` only); `package.json:13` (`test:domain` holds `test-order-numbers.mts` and `test-inventory-race.mts`).
EXPECTED #10 lists "concurrent finalizations don't double-claim an order number" under "Unit tests". Functionally covered by `ci` (which runs both), but the split mislabels the test tier. The concurrent-finalization test is DB-integration (creates a season/customer/orders), so `test:domain` is the right home — the EXPECTED wording is the mismatch, not the script. Worth a note in the status doc.

### A-m13. `npm run ci` green claim is not directly evidenced in the transcript
**Sources:** quality m3.
**Files:** `.scratch/smoke-p2/transcript.log` (captures S1-S5 individually, not a `npm run ci` invocation); `.scratch/PHASE-P2-SMOKE.md:6` (asserts "CI: `npm run ci` green").
Lint/typecheck/migration-guard results are not in the transcript at all. Likely true given the pieces, but the claim is unsubstantiated.

### A-m14. `ShippingQuote` allows orphan rows (both `orderId` and `packageId` nullable, no XOR)
**Sources:** quality m4.
**File:** `prisma/schema.prisma:433-436`.
`orderId String?` and `packageId String?` are both nullable with no CHECK requiring exactly one. A quote could be inserted with neither target. No P2 flow creates quotes yet, so no live bug, but the schema permits a state EXPECTED #5 ("shipping quotes with expiring options") doesn't address. Contrast with `InventoryItem`, which got an explicit XOR CHECK (`migration.sql:504`).

### A-m15. `InventoryItem` XOR constraint lives only in migration SQL, not `schema.prisma`
**Sources:** quality m5.
**Files:** `migration.sql:503-504` (hand-added `CHECK (("productId" IS NULL) <> ("addOnId" IS NULL))`); `scripts/check-xor.mts` (standalone probe, not in `ci`).
Prisma cannot express CHECK in `schema.prisma`, so this is the only option — but a future `prisma migrate dev --create-only` reset or `db push` would drop it silently. `migration-guard` catches schema drift only when a migration is created; it won't flag a missing CHECK that isn't in the datamodel. The `check-xor.mts` probe verifies it today, but there's no regression guard in `ci`. Recommend promoting the XOR probe to a `ci` test.

### A-m16. `migration-guard.mjs` drift branch checks the wrong exit code
**Sources:** quality m6.
**File:** `scripts/migration-guard.mjs:49` checks `error.status === 2` for the drift case, but `prisma migrate diff --exit-code` returns `1` (not 2) when a diff exists. The drift-specific error message ("schema.prisma has drifted") never fires; drift still fails CI via the `else` branch with a misleading "migrate diff failed" message. Pre-existing from P1, not introduced by P2 — flagged because P2 relies on the guard for the hand-added CHECK.

### Clean-code

### A-m17. Duplicated line-total expression
**Sources:** clean-code m1.
**Files:** `lib/orders/create-draft.ts:32-34` (order `totalCents` reduce) and `lib/orders/create-draft.ts:53` (per-line `lineTotalCents`).
Both compute `line.qty * (line.unitPriceCents + (line.optionPriceDeltaCents ?? 0))`. Two call sites now — extract `lineTotalCents(line)`.

### A-m18. Magic string `"pickup"` as a grouping-key sentinel
**Sources:** clean-code m2.
**File:** `lib/packages/grouping.ts:16` uses `input.recipientAddressId ?? "pickup"` as the address component of the grouping key. A bare literal collides with any future `addressId` that happens to equal `"pickup"` and is ungrepable. Named constant (e.g. `PICKUP_ADDRESS_SENTINEL`).

### A-m19. Magic prefixes `"MM-"` and `"D-"` in number formatters
**Sources:** clean-code m3; rules Minor 4.
**File:** `lib/orders/numbers.ts:9,13` hardcode the wire-format and draft-ref prefixes. These are domain constants (referenced by tests at `scripts/test-order-numbers.mts:35,46`) and would be safer as named exports alongside the formatters.

### A-m20. Duplicate import lines from `@prisma/client`
**Sources:** clean-code m4.
**File:** `lib/payments/post.ts:1-2` has two separate `import … from "@prisma/client"` lines. Merge into one.

### A-m21. `seed.ts` mixes upsert and count-then-create idempotency
**Sources:** clean-code m5.
**Files:** `prisma/seed.ts:14-125` (uses `upsert` for every catalog row); `prisma/seed.ts:133-145` (address) and `prisma/seed.ts:148-165` (order) switch to `count === 0` → `create`.
The count-then-create pattern is TOCTOU-prone and inconsistent with the file's own upsert discipline. Address can upsert on `[customerId, label]`; the order case is harder (no natural unique key for a draft) but deserves a comment explaining why it diverges.

### A-m22. Nested ternary chain for payment-status classification
**Sources:** clean-code m6; rules Minor 3.
**File:** `lib/payments/post.ts:54-55` classifies `UNPAID | PARTIAL | PAID | OVERPAID` via a three-deep nested ternary. Borderline against the "more than 3 levels of nesting" anti-AI-tic and harder to read than a small helper (`classifyPaymentStatus(paidCents, totalCents)`), which would also be the natural place for the equality/epsilon policy once real money rounding lands.

### A-m23. Duplicate `qty must be positive` guard
**Sources:** clean-code m8.
**File:** `lib/inventory/reserve.ts:14,30` both open with `if (qty <= 0) throw new Error("qty must be positive")`. Two call sites — an `assertPositiveQty(qty)` helper would dedupe, and the error would then be a named class consistent with A-M7.

### A-m24. `dedupe.ts` comment promises concurrency safety the phone arm lacks
**Sources:** clean-code m9. (Subsumed by A-M1 at Major severity; retained here as the discrete comment-vs-reality hygiene gap.)
**Files:** `lib/customers/dedupe.ts:6-8` (comment claims race-safety from the unique email index); `prisma/schema.prisma:129` (`normalizedPhone` is `@@index`, not `@unique`).
The comment covers the email arm only. The phone arm matches on `normalizedPhone`, which is only a non-unique index — two concurrent signups sharing only a phone number can both pass `findFirst` and both `create`. Either narrow the comment's claim to email, or make `normalizedPhone` `@unique` if phone dedupe is meant to be race-safe.

### A-m25. `normalizePhone` empty-string return silently re-normalized
**Sources:** clean-code m10.
**Files:** `lib/phone.ts:5` (returns `""` for all-non-digit input); `lib/customers/dedupe.ts:29` (`normalizedPhone: normalizedPhone || null` coerces that empty string back to `null`).
The double normalization is correct but obscure — `normalizePhone` returning `null` (or throwing on empty) would remove the `|| null` follow-up at the call site.

### A-m26. Undocumented `"MM-"` magic prefix in `formatWireFormat` (readability)
**Sources:** rules Minor 4 (folded into A-m19's magic-prefix finding; retained here as the discrete readability/comment gap per `ponytail.mdc`).
**File:** `lib/orders/numbers.ts:8-10` builds the wire format as `MM-${seasonName}-${NNNN}`. The "MM-" prefix has no constant and no comment explaining what "MM" denotes (likely "Mishloach Manot" given the Purim domain, but a reader cannot tell from the code). `clean-code.mdc` Abstraction Discipline lists "magic values" as a refactor category; `ponytail.mdc` allows one-line comments for non-obvious intent. A named constant (`WIRE_FORMAT_PREFIX`) or a one-line comment would fix the readability without violating Rule of 2.

---

## Notes / non-findings carried forward

- The P1 auth/session/impersonation/audit layer is unchanged in P2 and was reviewed under P1; the P1 findings (constant-time compare, session expiry, invite TTL, impersonation rank, audit attribution, `x-forwarded-for` sanitization, `AUTH_SECRET` length, `/api/health` disclosure, `/api/client-error` rate limiting) are all resolved in the current tree. Re-scoring them is out of scope.
- No new P2 API routes exist, so there is no IDOR, CSRF, or injection surface on new endpoints to assess. When checkout/admin routes are wired to `createDraftOrder`, `postPayment`, `reserveStock`, and `advancePackageStage` in later phases, each must apply `requireApiPermission` and pass server-validated inputs (see A-M3/A-M4).
- BOM/ingredient/assembly-batch tables are schema-only by design (UR-016 hidden at launch) and carry no security-relevant logic this phase.
- `/api/client-error` rate limiter is per-process in-memory — a single abuser can starve the global 30/min budget and a restart resets the window. Noted in P1, no worse in P2; hygiene note rather than a new finding.
- `Order.version` is incremented on finalize/discard but isn't used as an optimistic-concurrency guard on `Order` itself — the conditional `where: { id, status: "DRAFT" }` in `finalizeOrder` is the actual guard. The `version` column is bookkeeping. Not a finding.
- `concurrency-smoke.mjs` (P1 staff-version race) is wired in `package.json` as `concurrency-smoke` but is not part of `ci`. Pre-existing from P1, not a P2 regression.
- Storefront/admin UI for orders, packages, payments — explicitly out of P2 (merge boundary per `PHASE-P2-STATUS.md`); their absence is correct.
- Geocoder job and cron runner — schema + table only by design (UR-016 / R-163), documented as deferred; not a rule violation.
- Live Clerk integration — already an allowed P1 deviation, carried forward.

## Dropped / merged during dedupe

- rules Major 2 + clean-code M2 → A-M7 (same claim: typed vs plain `Error` in domain engine; same locations).
- rules Major 1 + clean-code M4 → A-M6 (dead domain functions; clean-code M4's `getOpenSeason` is a subset of rules Major 1's four-function list).
- clean-code M3 + rules Minor 1 → A-M10 (season.ts vs seasons.ts naming collision; same locations, same claim). Severity Major (clean-code) over Minor (rules) — the collision causes real import confusion independent of whether `getOpenSeason` is dropped.
- clean-code M5 + rules Minor 2 → A-M11 (re-fetch + `as` cast pattern repeated 3x; same 3 locations). Severity Major (clean-code) over Minor (rules) — the duplication + latent-bug framing is substantive; the rules "redundant assertion" framing is subsumed (rules Minor 2 itself acknowledges the null possibility, just rates it Minor).
- rules Minor 3 + clean-code m6 → A-m22 (nested ternary in `recomputePaymentStatus`).
- rules Minor 4 + clean-code m3 → A-m19 (magic prefixes `"MM-"`/`"D-"` in `numbers.ts`); the readability/comment portion of rules Minor 4 is also retained as A-m26.
- security m10 + clean-code m7 → A-m10 (`FulfillmentMethod.stages` unvalidated `Json` + unvalidated cast).
- security m4 folded into A-M3 narrative (non-negative validation) and retained as A-m4 (discrete engine guard gap).
- security m7 + quality m7 → A-m7 (schema-level integrity gap + engine-level `parentLineId` guard gap on the same `OrderLine` add-on tree concern).
- security m6 + quality Notes (single-OPEN-season convention) → A-m6.
- clean-code m9 (comment overclaims concurrency safety) → A-m24 (retained as discrete hygiene gap) and folded into A-M1 narrative.



