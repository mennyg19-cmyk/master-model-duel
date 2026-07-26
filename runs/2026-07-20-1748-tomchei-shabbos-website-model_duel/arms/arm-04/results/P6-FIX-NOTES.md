# P6 review fix pass — arm-04

**Source:** `results/AGGREGATE-REVIEW-P6.md` (0 blockers, 9 majors, 18 minors)
**Scope:** one pass. All 9 majors, 14 minors. 4 minors deferred. No new features, no P7.
**Ports:** web 3104 · db 4104

## Fixed

### Majors

**M1 (sec-M1) — a sweep could only be reconstructed one join at a time.** A bulk repeat named its
staff member through `Order.posStaffUserId` while a bulk cancel named them through
`order.status_changed`, so "what did that batch touch, and who ran it" was a different query for
each kind of action a batch can do. Every batch now mints a `batchId` and carries it into every
audit row it causes — `order.status_changed`, `order.repeated` and the `orders.bulk_action` summary
— so one indexed lookup returns the whole sweep whatever it did. The summary row keeps its own
`entityId = batchId` so it is findable the same way.
`src/lib/orders/bulk-actions.ts` · `order-service.ts` · `repeat-order.ts` · `src/lib/audit.ts` ·
`(admin)/admin/orders/actions.ts`

**M2 (sec-M2) — `returnTo` was pasted into the redirect as text.** It is a hidden form field, so an
`&` in it could append a parameter of the caller's choosing and a `#` could cut the flash message
off the end. The desk's own filters are now read out of it by name — `q`, `status`, `payment`,
`size`, `page` — and the URL is rebuilt server-side from those five. Anything else the browser sent
back is not a filter and does not survive.
`(admin)/admin/orders/actions.ts`

**M3 (sec-M3) — an import renamed a customer it had only matched by phone.** A spreadsheet with a
name typed beside a number somebody already holds rewrote that person's name with no prior value
recorded anywhere. A phone-only match now updates nothing but the phone: the name on file wins,
because the operator keyed the row on a number, not on the person. Staging says so on the preview
row ("that phone number is already on X's record; the import will leave that name alone") rather
than promising an update it will not make. New test: *an import never renames a record it only
matched by phone number*.
`src/lib/imports/import-service.ts` · `row-readers.ts` · `tests/admin-ops.test.ts`

**M4 (rules-M1) — the dashboard counted every customer who ever existed.** `db.customer.count()`
was unscoped, in a module whose header promises season-scoped figures, and no caller read the
result. Both the field and the query are gone. Scoping it properly means "customers who ordered
this season", which is a different number with a different name, and nothing asked for it.
`src/lib/admin/dashboard.ts` · `(admin)/admin/page.tsx`

**M5 (cc-M1) — a closed season was reported as a typo.** `runBulk` returned `null` both for an
action the list has never heard of and for a repeat with no season open, so "open a season first"
came back as "that is not something this list can do." It returns a `Result` now: the unknown action
keeps that message, and a closed season returns the season service's own failure unchanged.
`(admin)/admin/orders/actions.ts`

**M6 + M7 (cc-M2, cc-M3) — status labels and badge tones drifted across three screens.** The order
desk had four payment tones and title-cased its statuses; the detail page had two tones and printed
the raw enum; the Today queue had two tones and lower-cased. One module now owns all three:
`paymentStatusTone`, `orderStatusTone` and `humanizeStatus`. Three screens, one vocabulary — the
same status cannot read as amber on one and grey on the next.
`src/lib/orders/order-labels.ts` + `orders/page.tsx` · `orders/[orderId]/page.tsx` ·
`today/order-queue.tsx`

**M8 (cc-M4) — redirect-with-flash forked three ways.** Each fork built its own `URLSearchParams`
and each dropped or kept empty values differently. `flashHref(path, params)` and
`redirectWithFlash(path, params)` are the one implementation; empty values are dropped in one place,
so a blank notice can never leave a bare `?notice=` on the URL. Six action files and the builder and
confirmation href helpers now go through it.
`src/lib/forms/flash-redirect.ts` + `orders/actions.ts` · `pos/actions.ts` · `imports/actions.ts` ·
`(storefront)/order/actions.ts` · `checkout/actions.ts` · `confirmation/actions.ts` ·
`src/lib/orders/builder-href.ts`

**M9 (cc-M5) — `pageQuery` was `pageHref` minus the base path.** `pageQueryString(query, page)` is
extracted; `pageHref` and the desk's `returnTo` builder both delegate. The desk's hidden field can
no longer describe a different page than the pagination links do.
`src/lib/admin/list-query.ts` · `orders/page.tsx`

### Minors

| # | Fix | Where |
|---|---|---|
| m10 (q-m1) | The dashboard's "Latest security events" panel is behind `audit.view`, not `dashboard.view`. Staff who get a 403 on `/admin/audit` no longer read five audit rows on the way past. | `(admin)/admin/page.tsx` |
| m11 (q-m3) | `droppedCount` is on the `orders.bulk_action` audit row. Ids past the 100-row cap left no trace but a redirect notice nobody keeps. | `orders/actions.ts` · `src/lib/audit.ts` |
| m12 (rules-m3) | Not a transaction — a comment saying why. Each order moves in its own transaction, so the summary has nothing to be atomic *with*; if the summary write fails the sweep is still reconstructible from the per-order rows M1 gave a shared `batchId`. | `orders/actions.ts` |
| m13 (q-m2 / rules-m6) | Bulk cancel re-reads the money inside the transition's own transaction. `cancelUnpaidOrder(orderId, staff, batchId)` passes a guard into `transitionOrder`, so a colleague taking a payment mid-sweep is caught by the guard rather than by a balance read before the loop. Failure code `ORDER_HOLDS_MONEY`, so the batch report can call it *skipped* rather than *conflicted*. | `src/lib/orders/order-service.ts` · `bulk-actions.ts` |
| m14 (sec-m2 / rules-m5) | `writeCustomers` and `writeProducts` read the whole batch first — one `findMany` on the email set, one on the phone set, one on the slug set — instead of two or three `findUnique` calls per row inside the commit transaction. A 5,000-row product file goes from ~5,000 round trips to one. | `src/lib/imports/import-service.ts` |
| m15 (rules-m2) | A counter sale whose payment throws records `pos.sale_unpaid` before it returns. The order is placed and unpaid either way; now there is a row saying cash was attempted and did not post. | `src/lib/pos/counter.ts` · `src/lib/audit.ts` |
| m16 (rules-m4) | `repeatOrderAtCounter`'s open-cart check moved inside the transaction, so a double-click cannot pass it twice and leave two tills open for one customer. | `src/lib/orders/repeat-order.ts` |
| m17 (sec-m1) | `lookupCustomersForCounter` needs two characters before it runs its three substring scans, and still takes a bounded page. A single keystroke no longer scans the directory. | `src/lib/customers.ts` |
| m19 (sec-m4) | `ponytail:` note on the CSV reader: values leading with `= + - @` are stored verbatim on purpose, because P6 has no sink for them and quoting them here would corrupt the data the office reads back. The escape belongs at the P12 export. | `src/lib/imports/csv.ts` |
| m20 (cc-m1) | `readActiveSeason()` exported once; the dashboard and Today read it instead of each writing the same `findFirst`. The POS variant stays separate — it refuses a closed season, which is a different question. | `src/lib/admin/dashboard.ts` · `admin/page.tsx` · `today/page.tsx` |
| m21 (cc-m2) | `phoneIfFree` is gone with the N+1 rewrite; the remaining helper of that shape was already `phoneFieldsIfFree`. | `src/lib/imports/import-service.ts` |
| m23 (cc-m4) | The two `input.seasonId!` assertions are gone. Staging and committing both branch on the kind and pass a narrowed `string`, so the compiler enforces what the guard was asserting. | `src/lib/imports/import-service.ts` |
| m24 (cc-m5) | `labelOf` / `shortId` → `labelOfOrder` / `labelOfMissing`. Two helpers for the same column, now named as a pair. | `src/lib/orders/bulk-actions.ts` |
| m26 (cc-m7) | `IMPORT_COLUMNS` is exported from the reader and rendered by the upload form, so the hint cannot drift from the contract. The product hint says *price (in dollars)*, and the `pricecents` fallback that read `3650` as $3,650 is deleted. | `src/lib/imports/row-readers.ts` · `admin/imports/page.tsx` |

### Found while re-smoking (not on the list)

**The alert banner showed a Settings link to staff who get a 403 on Settings.** The banner is on
every admin page from P6 and links to `/admin/settings` unconditionally, so with the store shut —
which is every admin page on an unseeded database — a restricted staff member was offered a link to
a page that refuses them. That is the rule P1's S3d exists to hold, and it was the one P1 check
failing on a fresh database. The banner now takes `canOpenSettings` and tells everyone the reason
while offering the link only to whoever can throw the switch.
`src/components/admin/alert-banner.tsx` · `(admin)/admin/layout.tsx`

**The P6 smoke's own `freePhone` helper looked up an unnormalized number.** It searched
`normalizedPhone` for `732XXXXXXX` where storage form is E.164 (`+1732XXXXXXX`), so it never found a
collision and could hand the staging check a number already on file — which, correctly, reads as an
existing household and changes what S3a is measuring. Same class of fixture bug as P5's deviation 2.
`scripts/smoke-p6.ts`

## Deferred

| # | Why |
|---|---|
| m18 (sec-m3) | `readStaffOrderMoney` / `readStaffOrderBoxes` not scoped by ownership. The review files it as "no fix required unless the threat model includes shared logs": the reads are permission-gated and the ids are CUIDs. Scoping staff to orders they touched is an access model this project has not decided on, not a fix. |
| m22 (cc-m3) | Product price round-tripping through a string. `StagedRow.parsed` is `Record<string, string>` because it is persisted as JSON and re-read at commit; widening it to `string \| number` ripples through the reader, the preview table and the commit for one `String()`/`Number()` pair on a value the schema has already validated. |
| m25 (cc-m6) | Three conventions for admin route constants. The review calls it soft drift and says a paths module per feature is not worth it; agreed. `DESK_PATH` and `orderPath` were tidied inside the orders actions as part of M8, which is as far as it goes without inventing a module. |
| m27 (cc-m8) | Defensive `flatMap` narrowing in `pos/page.tsx` over a branch the CHECK constraint makes unreachable. The review calls it acceptable. Deleting the narrowing means a non-null assertion, which is worse: the constraint is a database fact the type system cannot see. |

## Verification

- `npm run ci` — lint, typecheck, migration guard, full suite: **exit 0**, **156/156 tests**. One
  test added (*an import never renames a record it only matched by phone number*, M3) and one
  assertion added to the existing overlapping-sweep test, checking that both orders' audit rows
  carry the sweep's `batchId` (M1).
- `npm run smoke:p6` — **23/23 checks pass** (`.scratch/PHASE-P6-SMOKE.md`).
- All six phases re-run in order against one freshly created database, seeded once between P1 and
  P2: **P1 28/28**, **P2 21/21**, **P3 39/39**, **P4 26/26**, **P5 29/29**, **P6 23/23**. The alert
  banner fix above is why P1 is green.
- `.env.example` is generated from `src/lib/env-spec.ts` and carries empty values for every secret —
  no `sk_test_` or `whsec_` shapes.
- No git. No other arm touched. P7 not started.
