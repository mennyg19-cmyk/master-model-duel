# P4 Quality Review — arm-02

**Reviewer specialist:** Quality
**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Arm:** arm-02
**Phase:** P4 (Cart-first order builder, address book, customer account)
**EXPECTED ref:** `shared/phases/PHASE-P4-EXPECTED.md`
**Scope:** correctness, broken flows, stubs, missing smoke, regressions vs EXPECTED. Blind to model name. Findings only, no fixes.

Smoke S1–S3 (`.scratch/PHASE-P4-SMOKE.md`, raw `.scratch/p4-smoke-output.log`) report 29/29 PASS; `npm run ci` green (lint, typecheck, migration guard, 32/32 unit tests); page renders logged in `.scratch/p4-pages-output.log`. Findings below are quality defects surfaced by reading the implementation, not by smoke failure. The smoke script drives the API directly, so it does not exercise several UI paths flagged here.

## Findings

### F1 — Migration backfill `normalizedKey` diverges from `normalizedAddressKey` (dedupe breaks for pre-existing rows)
`prisma/migrations/20260720231000_p4_builder_accounts/migration.sql:10-14` vs `lib/addresses/normalize.ts:38-46`
The backfill computes the dedupe key as `lower(regexp_replace(concat_fields, '[^a-zA-Z0-9|]+', ' ', 'g'))` — lowercased, punctuation→space, but **no suffix-alias collapsing** (`street`→`st`, `avenue`→`ave`, …) and `|` separators are preserved verbatim. The app's `normalizedAddressKey` collapses suffix aliases and joins tokens with single spaces, then joins fields with `|`. The two functions therefore produce different keys for the same address (e.g. "12 Main Street" → app `…main st…`, SQL `…main street…`). For any `CustomerAddress` row that existed before this migration, re-saving the same address through the app will not match the backfilled key → the unique constraint does not fire → a **duplicate address-book entry** is created, breaking UR-014 dedupe. The fresh-seed smoke never trips this because the seed (`prisma/seed.ts:52-61`) writes `normalizedKey` via the app function on an empty table. A real upgrade with existing addresses would misbehave silently.

### F2 — `OrderDraft.guestTokenHash` is globally unique, not season-scoped → cross-season 500
`prisma/schema.prisma:610`, `lib/order-builder/draft-store.ts:54-69`
`guestTokenHash String? @unique` is a global unique index, but a draft is also scoped by `seasonId`. A guest cookie (`tomchei_guest_draft`, 14-day TTL) whose ACTIVE draft still exists in season A will, when the same browser opens the builder in season B, cause `findActiveDraft(seasonB, guest)` to return null and `saveDraft` to attempt `db.orderDraft.create({ data: { seasonId: seasonB, guestTokenHash: sameHash, cart } })`. The create collides on the global unique index → Prisma `P2002` is **not caught** in `saveDraft`/`PUT /api/draft` → unhandled throw → 500. The same collision arises whenever a second row for the same token is attempted while any prior row (any status) holds the hash. `discardDraft`/`completeDraft` rely on deleting the cookie to mint a fresh token next time, which papers over the issue in the happy path, but a stale cookie across a season boundary (or any path that keeps the cookie) breaks the builder with a server error.

### F3 — "On this order" recipient is a single per-draft field but the UI presents it per-line
`lib/order-builder/cart.ts:30`, `components/builder/order-builder.tsx:157-168`, `components/builder/assignment-dialog.tsx:99-106`
`cart.onOrderRecipient` is one address stored on the draft (DECISION-P4-4), and `assignLine` writes `onOrderRecipient: newOnOrderRecipient ?? current.onOrderRecipient` for every on-order assignment. Assigning a second on-order line with a different address therefore **silently overwrites the recipient of every previously-assigned on-order line**. The cart panel reads `cart.onOrderRecipient` live (`cart-panel.tsx:14-18`), so all on-order lines flip to the newest address with no warning. A customer who sends two baskets "on this order" to different people (e.g. themselves and a spouse in the same household) will not be alerted that the first line was rerouted. Smoke S1 only uses one on-order line, so the collision is unexercised.

### F4 — Add-on stock is checked per-line, not aggregated across the cart
`lib/order-builder/cart.ts:135-140` vs `145-151`
Product stock is correctly aggregated across the whole cart (`requestedPerProduct`), and the code comment calls out that two lines of the same tracked product must not each pass individually. The add-on stock check does **not** get the same treatment: it tests `entry.quantity * line.quantity > available` per line only. Two lines ordering the same tracked add-on each pass while their combined demand exceeds stock. Inconsistent with the product logic and with the "issues block checkout" gate (P5) — checkout would accept an over-sold add-on.

### F5 — Autosave error state never recovers; UI says "retrying" but nothing retries
`components/builder/order-builder.tsx:78-81`, `components/builder/cart-panel.tsx:139-141`
On a non-OK PUT, `persistCart` sets `saveState="error"` and the panel renders "Autosave failed — retrying". Nothing schedules a retry and there is no manual retry button. The next local edit will schedule another save (which may also fail), but if the failure is structural — store closed (409), auth lost (401), or network down — the user is stuck with a misleading "retrying" message and no recovery path short of a hard reload. A store-closed mid-build response is a real scenario (R-002 season gate on `/api/draft`).

### F6 — Address update logic duplicated in three places (drift risk)
`lib/addresses/book.ts:8-38` (`saveToAddressBook`), `lib/addresses/book.ts:45-66` (`updateAddressBookEntry`), `app/api/admin/customers/[id]/addresses/[addressId]/route.ts:29-47`
The staff admin PATCH inlines the normalizedKey/geocode/update steps a third time instead of calling `updateAddressBookEntry`, with the only real difference being the audit row. The geocode call is duplicated, the field-by-field update is duplicated, and the P2002→409 mapping is duplicated. Any future change to dedupe/geocode handling must be made in three places or they drift.

### F7 — `completeDraft` is defined and exported but unused in P4
`lib/order-builder/draft-store.ts:101-107`
Reserved for P5 checkout success (the only guest-clear-on-success path, R-022). Not a stub regression — explicitly out of scope this phase per EXPECTED "Out of scope: Payment capture, Stripe checkout (P5)". Noted for completeness; no action this phase.

### F8 — Smoke coverage gaps (not a smoke failure, but unexercised paths)
`.scratch/p4-smoke.ps1` / `.scratch/PHASE-P4-SMOKE.md`
The smoke script drives `/api/draft` and the admin address API directly. It does not exercise: the on-order-shared-recipient collision (F3), cross-season guest draft creation (F2), add-on stock aggregation across two lines (F4), the autosave error/recovery UI (F5), or the assignment-dialog mid-order saved-address edit flow (`AssignmentDialog` Edit → PATCH `/api/account/addresses/[id]`). The mid-order edit path is asserted only by the page-render log, not by an interaction. EXPECTED S1–S3 are satisfied as written, but the above defects have no smoke guardrail.

## Severity counts

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 3 (F1, F2, F3) |
| Low | 3 (F4, F5, F6) |
| Info | 2 (F7, F8) |
| **Total** | **8** |

No Critical/High. No regressions vs P3. EXPECTED checklist items 1–8 are all implemented and smoke-verified; the defects above are quality issues in the implementation, not missing scope.
