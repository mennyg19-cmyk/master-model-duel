# P4 review fix pass — arm-04

**Source:** `results/AGGREGATE-REVIEW-P4.md` (0 blockers, 3 majors, 17 minors)
**Scope:** one pass. All 3 majors, 11 minors, 1 already correct, 5 deferred. No new features, no P5.
**Ports:** web 3104 · db 4104

## Fixed

### Majors

**#1 — Guest "self" assignment had no name field.** `AssignmentPanel` now renders a *Your name*
input whenever there is no account to read the name from (`options.selfName === null`), which is
exactly the case `fromAccountHolder` rejects with "Tell us your name…". The hint under the radio
also changes for a visitor with no address book: pickup is what "keep it on my order" can do for
them, and the way to a street address is the add-recipient dialog, so the copy says so instead of
sending them to a field that is not there.
`src/components/builder/assignment-panel.tsx`

**#2 — Three copies of the `text()` FormData helper.** One `trimmedField(formData, field)` in
`src/lib/forms/form-data.ts`, used by all three action modules. The name change is minor #16 in the
same edit: the helper reads a field and trims it, and now says that.
`src/lib/forms/form-data.ts` · `(storefront)/order/actions.ts` · `(storefront)/account/actions.ts` ·
`(admin)/admin/customers/actions.ts`

**#3 — Address fields read off the form in four places.** `addressFieldsFromForm(formData)` returns
the eight fields `AddressFields` renders, so a new address column is one edit. All four call sites
use it.
`src/lib/addresses/address-form.ts` · `assignLineAction` · `saveBuilderAddressAction` ·
`saveAddressAction` · `saveCustomerAddressAction`

### Minors

| # | Fix | Where |
|---|---|---|
| 5 | `safeDestination` canonicalizes before it matches. The candidate is resolved against a host we never use, so `..` collapses the way a browser collapses it and any host it named is dropped; only a path of our own can come back. `/account/../admin` now lands on `/account`. | `(storefront)/account/sign-in/actions.ts` |
| 6 | `saveBuilderAddressAction` gates on `requireOpenStore()` like every other action on the builder. | `(storefront)/order/actions.ts` |
| 7 | `transitionOrder` takes an optional `DraftOwner` and folds `ownerFilter` into its `where`; `discardDraft` requires one, because every caller has one. The account cancel action passes the owner it resolved from the session, so the pre-check now explains the refusal rather than being the only thing preventing it. | `src/lib/orders/order-service.ts` · `(storefront)/account/actions.ts` |
| 11 | One `FormState` and one `EMPTY_FORM_STATE` in `src/lib/forms/form-state.ts`. The account-local copy and the admin `CustomerFormState` / `EMPTY` are gone. | `src/lib/forms/form-state.ts` + 6 importers |
| 12 | The staff editor calls `addressSummary` instead of inlining a second format. `addressSummary` moved to `src/lib/addresses/address-summary.ts` — a client component cannot import the `server-only` address book, which is why the copy existed. | `src/lib/addresses/address-summary.ts` · `[customerId]/address-book-editor.tsx` |
| 14 | `BuilderSearchParams` deleted; the page reads `BuilderParams`, the same type the actions write. | `(storefront)/order/page.tsx` |
| 16 | Vague name `text` → `trimmedField` (with major #2). | as above |
| 17 | Banned standalone `item` gone: the panel destructures at the map boundary and the card takes `product`, `unitsLeft`, `addOns`. | `src/components/builder/product-panel.tsx` |
| 18 | `DEFAULT_COUNTRY = 'US'` named in the address module, used by both sites in `assignment.ts`. | `src/lib/addresses/address-book.ts` · `src/lib/orders/assignment.ts` |
| 19 | Dead export `findCustomerDraft` deleted. | `src/lib/orders/customer-orders.ts` |
| 20 | `scripts/smoke-p4.ts` is 470 lines: the HTML readers moved to `scripts/smoke-p4-helpers.ts`, leaving the customer journey in one file and the string handling in another. | `scripts/smoke-p4-helpers.ts` |

### Already correct

**#13** — `destinationOf` already calls `addressSummary` for the address half and wraps it with the
pickup branch (`src/lib/orders/customer-orders.ts`). Verified in the current source; no edit needed.

### Found while re-smoking (not on the list)

**The smoke run truncated the development database on its way out.** Importing `@prisma/client`
puts the development `DATABASE_URL` into the environment, and `--env-file` does not override a
variable that is already set, so the `npm run ci` step at the end of the P4 and P3 smokes ran the
unit suite — which truncates every table — against the database the run had just been checking.
The first re-smoke attempt failed on `GET /order -> 403` because the seeded `store.open` setting
had been wiped by the previous run's own last step. `runTests` already guarded against this; the
`ci` step did not. Both smokes now pass `envWithoutDatabaseUrl()` to that child, and the dev
database survives a run.
`scripts/smoke-harness.ts` · `scripts/smoke-p4.ts` · `scripts/smoke-p3.ts`

## Deferred

| # | Why |
|---|---|
| 4 | `claimGuestDraft` TOCTOU. The real fix is a partial unique index on `(customerId, seasonId)` where `status = 'DRAFT'`, which Prisma's schema cannot express — it needs a hand-written migration plus a new entry in `scripts/migration-guard.ts`, and the "Continue" link then has to choose between drafts that can no longer both exist. That is a schema decision, not a fix-pass edit. Still guest-only and still needs two concurrent requests from the same browser. |
| 8 | `claimGuestDraft` audited as `system`. The reviewers agree it matches the audit convention and is not a bug; it is flagged for P5/P12 when audit retention is settled. No change is the correct answer today. |
| 9 | Pickup-location select shown for every method. Reacting to the method the customer just picked needs either client JavaScript or a radio-plus-`:has()` rewrite of the fulfillment fieldset — the panel is deliberately a no-JS URL panel. The server already ignores the value unless the method requires it, and the label says "only for pickup". Worth doing properly in P5, where the method choice grows fees and scheduling anyway. |
| 10 | Address autocomplete reading. The reviewers themselves record this as an interpretation gap, not a defect: browser autofill plus a `<datalist>` of saved recipients, with no paid lookup service, and server validation on everything that arrives. |
| 15 | URL-notice rendering drift. The orders page can use a code allowlist because it has three fixed outcomes. The builder and the address pages carry generated text — `Going to Tzvi Newman.`, `Only 3 more classic boxes are available.` — so an allowlist means giving every `Result` failure a code the page can re-render, across three pages and a dozen actions. That is a pattern change, not a fix, and it belongs with P5's checkout messages rather than half-done here. React still escapes the output; the risk is a crafted URL showing chosen text, not script. |

## Verification

- `npm run ci` — lint, typecheck, migration guard, full suite: **exit 0**, **120/120 tests pass**
  (119 before, plus `a draft is only discarded by the owner who built it`, which covers minor #7 at
  the service level: another customer's `discardDraft` returns `ORDER_NOT_FOUND` and the cart is
  still there).
- `npm run smoke:p4` — **26/26 checks pass** (`.scratch/PHASE-P4-SMOKE.md`, run
  2026-07-26T17:19:57Z). New check **S2g**: a signed-out visitor's picker renders
  `data-testid="self-recipient-name"`, and posting that form assigns the line to *Yosef Guest* for
  pickup — the major #1 path, exercised end to end over HTTP rather than asserted from the code.
- After the fixes, all four phases were re-run in order against one freshly seeded database and one
  dev server: **P1 28/28**, **P2 21/21**, **P3 39/39**, **P4 26/26**. Nothing earlier regressed, and
  the database was still seeded when the last run finished — which is the point of the isolation fix
  above.
- No git. No other arm touched. P5 not started: no payment, no checkout submission, no fulfillment
  commitment.
