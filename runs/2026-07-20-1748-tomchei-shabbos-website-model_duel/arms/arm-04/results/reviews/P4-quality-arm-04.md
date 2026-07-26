# P4 quality review — arm-04 (blind)

Reviewer: quality specialist. Scope: P4 delta + regressions vs `shared/phases/PHASE-P4-EXPECTED.md` and `shared/MERGED-BUILD-PLAN.md` § P4. Findings only — no fixes.

## Summary

- Blocker: 0
- Major: 1
- Minor: 3

The phase is broadly complete: all 8 EXPECTED items are delivered, the cart-first flow, three-way picker, address-book dedupe, staff audit attribution, draft ownership anti-enumeration, and the account area all match the spec, and 25/25 smoke checks pass. One major gap in the guest assignment path slipped past the smoke run, plus three minor notes.

## Major

1. **Guest + "self" assignment target is broken.** `AssignmentPanel` renders no `recipientName` input field, but `fromAccountHolder` for a guest (`owner.kind === 'guest'`) requires a non-empty `recipientName` and fails with "Tell us your name so we know who to send it to." when it is absent. The "self" radio is `defaultChecked`, so a guest's first attempt to assign a line fails with an error that points at a field the form does not show. A guest can only recover by switching to "Add a new recipient". Smoke S1e exercises "self" only with a signed-in customer, and S2b builds a guest cart but never assigns it, so the gap is both real and untested.
   - `src/components/builder/assignment-panel.tsx:51-135` (AssignmentPanel form, no recipientName field)
   - `src/lib/orders/assignment.ts:253-265` (fromAccountHolder, guest branch)

## Minor

1. **Address autocomplete is browser autofill + a `<datalist>` of saved recipients only.** EXPECTED item 2 reads "address autocomplete + server validation". The implementation relies on `autoComplete` attributes and a `<datalist>` of the customer's own saved recipients (`src/components/addresses/address-fields.tsx:35-56`). Server validation is present and works; the autocomplete side is a defensible reading of R-025 but does not include any street-level suggestion lookup. The status file flags this as a deliberate "no paid lookup service" choice. Noting as a possible interpretation gap, not a defect.

2. **No DB uniqueness on (customerId, seasonId, DRAFT).** `getOrCreateDraft` reuses an existing draft via `findOwnedDraft`, but nothing stops two concurrent first-adds from creating two drafts for the same customer+season. The same pattern exists for guests on `guestTokenHash` (which IS unique) but not for accounts. Low-impact in practice (the builder always reads the oldest draft), but a second draft would make the account "Continue" link on `/account/orders/[orderId]` ambiguous — it always goes to `/order`, which shows the oldest draft, not necessarily the one on the detail page. `src/lib/orders/cart-service.ts:43-50`; `src/app/(storefront)/account/orders/[orderId]/page.tsx:133`.

3. **`FulfillmentFields` pickup-location select is always rendered when any pickup location exists, regardless of the selected method.** The select defaults to "Not picking up" and the server ignores it unless `method.requiresPickupLocation`, so no bad data is written, but the UI implies pickup is choosable for delivery methods. `src/components/builder/assignment-panel.tsx:249-261`.

## What was verified and looks correct

- Cart-first flow: items enter with `recipientName`/`fulfillmentMethodId` null; CHECK constraint `OrderLine_assignment_complete` keeps them in step; finalize refuses unassigned lines (`src/lib/orders/order-service.ts:65-74`).
- Three-way picker: `self` reads the account holder's name from the DB for signed-in customers (cannot be tampered via the form); `saved` is gated by ownership; `new` auto-saves to the book via `saveCustomerAddress` on the way through.
- Address book: normalized dedupe via `normalizeAddressKey`, draft lines follow saved-address edits but placed orders keep snapshots (`refreshDraftLines`), geocode comes only from the cache, archive refuses addresses still on a draft.
- Staff edits share `saveCustomerAddress` with the customer path; only the `actor` differs, and the audit row names the staff member (`customers.manage` permission, 403 for DRIVER).
- Draft ownership: `ownerFilter` on every read/write; guest token is 32 random bytes, stored as SHA-256; `findOwnedOrder` returns null for both "not yours" and "missing", so id probing gets 404 either way.
- Guest claim clears the cookie only on success; a failed claim (account already has a draft) leaves the guest cart intact.
- Shared builder shell: `CartPanel` and `BuilderProductPanel` take actions/links as props, so P5 POS can reuse them.
- Migration `20260726190000_p4_cart_first_builder` adds the nullable columns and both CHECK constraints; `scripts/migration-guard.ts` asserts both survive a replay.
- No stubs/TODOs in P4 code; no P3 regressions observed in `/collection`, `/archive`, newsletter, or the storefront shell.
