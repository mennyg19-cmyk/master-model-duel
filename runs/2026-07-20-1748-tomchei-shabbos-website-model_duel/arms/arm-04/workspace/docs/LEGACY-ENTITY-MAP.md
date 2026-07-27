# Legacy entity map (R-165)

What the old system's export contains, where each column lands in this database, and what happens to
the parts that do not land anywhere. This is the document the office reads before an import and the
one to argue with if a column turns out to mean something else.

The export is **one line per item sent**: who gave it, who received it, what it was, what it cost.
There is no order table in the file — orders are reassembled from the order number, which is why
repairing that number is the first thing that happens and an unrepairable one is fatal to the line.

The reader is `src/lib/migration/legacy-rows.ts` (pure, unit-tested) and the writer is
`src/lib/migration/legacy-import.ts`. The per-order write itself is `writePriorYearOrder`, shared
with P10's single-order hook, so a bulk import and a one-off cannot drift apart on what a historic
order looks like.

## Expected header

```
orderNo,orderDate,donor,donorEmail,donorPhone,recipient,street,street2,city,state,zip,itemCode,item,qty,price,greeting
```

Column names are matched case-insensitively and the order of the columns does not matter. An extra
column is ignored; a missing one is treated as blank, and the row is judged on what that leaves.

## Column by column

| Legacy column | Lands in | Reading rule | If it cannot be read |
|---|---|---|---|
| `orderNo` | `Order.importedOrderReference`, unique per season | `#`, commas, spaces and leading zeros come off; letters and a `-A` suffix stay, because in the old system that was a genuinely separate order | **Row is INVALID.** Without a reference there is no order to hang the line on |
| `orderDate` | `Order.placedAt` | Anything the platform can parse as a date | **Row is INVALID** |
| `donor` | `Customer.fullName` | Trimmed. Used to find the household only when email and phone have failed | **Row is INVALID** — a gift with no giver is not history worth writing |
| `donorEmail` | `Customer.email`, `normalizedEmail` | Normalised and used as the primary match. Anything not shaped like an address is treated as absent and the reason travels with the row | Falls through to phone, then name (see "Which household" below) |
| `donorPhone` | `Customer.phone`, `normalizedPhone` | Normalised to digits; second match key | Ignored |
| `recipient` | `OrderLine.recipientName`, `CustomerAddress.recipientName` | Trimmed | **Row is INVALID** |
| `street`, `street2`, `city`, `state`, `zip` | `OrderLine.address*` and one `CustomerAddress` per distinct door | `state` upper-cased; the address is keyed by `normalizeAddressKey`, so spelling variants of one door do not become two book entries | **Row is kept.** The address is written carrying `needsReview` and the reason, which is what puts it in the cleanup queue (UR-014) |
| `itemCode` | `Product.slug` lookup | Lower-cased and slugified. Falls back to a slug of `item` when the code is blank, and to `legacy-item` when both are unusable | A slug with no product in the prior season becomes a retired-product line: the name and price are kept as text, and P10's repeat page asks what it is this year |
| `item` | `OrderLine.productNameSnapshot` | Trimmed. This is what the customer sees on the repeat page, even years after the product was retired | **Row is INVALID** |
| `qty` | `OrderLine.quantity` | Whole number. **Blank means one** — the old export only filled this in when it was more than one box, and refusing the row would throw away a real order over a habit | **Row is INVALID** if it is present and not a whole number ≥ 1 |
| `price` | `OrderLine.unitPriceCents`, and the order totals | `$36.00`, `36`, `1,250.50` all read as money | **Row is INVALID** — an order whose value is unknown would silently change the season totals |
| `greeting` | `OrderLine.greetingMessage` | Trimmed; blank becomes nothing | Ignored |

## Which household a line belongs to

In this order, first match wins:

1. **Email.** Normalised, matched against `Customer.normalizedEmail`. A new household is created when
   there is no match, which is the ordinary case for a first import.
2. **Phone.** Normalised, matched against `Customer.normalizedPhone`. Used only when there is no
   usable email on the line.
3. **Name.** Case-insensitive exact match on `Customer.fullName`.
   - Exactly one match → that household.
   - **More than one** → the row is `NEEDS_MAPPING`. The run lists the candidates and the commit
     refuses while any question is open. Guessing between two families called Klein is the one
     mistake in this pipeline that cannot be found later by reading the data.
   - **None** → the row is INVALID, and says so: no email address and nobody on file by that name.

## What the import creates, and what it never touches

**Creates or reuses:** `Customer`, `CustomerAddress`, `Order` (status `COMPLETED`, marked with
`importedOrderReference`), `OrderLine`.

**Never creates:** payments, packages, print batches, routes, shipments, notifications. A historic
order is a record that a box was sent, not a fulfillment job — writing packages for a decade of
history would put ten years of boxes on tonight's board.

**Never modifies:** the current season's catalogue, prices, settings, staff or permissions. Prices
come from the file, not from today's product.

## Rows that do not become orders

| Verdict | Meaning | What happens |
|---|---|---|
| `VALID` | Read cleanly and placed on a household | Written on commit |
| `DUPLICATE` | Its order number is already imported into that season | Grouped with the order it belongs to and **not written twice**; the unique index on `(seasonId, importedOrderReference)` is the backstop |
| `NEEDS_MAPPING` | A person has to say which household it means | Blocks the commit until answered, one click each |
| `INVALID` | Cannot be read for one of the reasons above | Skipped, listed with its reason and its line number, and left out of the source total. It never stops the rest of the file |

## Commit shape

- Orders are grouped whole and cut into chunks of **five orders**; each chunk is one transaction, so
  nothing can ever land half an order.
- One press of Commit gets through **three chunks** and then offers Continue, because a deployment
  kills a request that runs too long and a killed commit must leave a resumable run rather than a
  half-imported decade.
- Each chunk claims itself with a guarded update on `committedChunkCount`, so two people pressing
  Commit at the same time cannot write the same five orders twice.
- On finish, the run reconciles: what the file said those orders were worth against what the database
  now holds for them, recomputed from the orders themselves rather than from a counter — a chunk
  written twice shows up as a difference instead of hiding in an increment.

## The dry run

The dry run writes only the run and its per-line verdicts. No customer, address or order moves until
somebody presses Commit, and a run can be discarded instead. This is what makes it safe to point at
the real database rather than needing a disposable copy — though pointing it at a copy first is still
the sensible way to read the verdicts for a file nobody has seen before.

## Audit trail

`migration.dry_run`, `migration.row_mapped`, `migration.committed` (naming the chunk it resumed from)
and `migration.discarded`, all against the run id. Address-book decisions are `cleanup.scanned` and
`cleanup.resolved`. `migration.manage` is required for all of it, and is manager-only.
