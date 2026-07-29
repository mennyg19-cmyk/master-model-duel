# Legacy → new entity map (R-165)

The year-one migration from the old ordering system. Three CSV kinds run through the
staged, atomic import engine (`lib/imports/engine.ts`) with per-kind handlers under
`lib/imports/legacy/`. Every batch stages first, shows per-row verdicts, and commits
whole or not at all. A **dry-run** batch (checkbox on the imports page) produces the
same ledger but can never commit — proof against a disposable database (G-029).

## Seasons

| Legacy | New |
|---|---|
| Row's `order_date` year / products CSV `year` column | `Season` named `Legacy <year>`, status `CLOSED`, upserted on demand (same convention as `lib/repeat/import-hook.ts`) |

Historical rows never land in the open season. Per-season counters
(`lastOrderSeq`) still drive clean sequential numbers — see order-number repair below.

## Customers (`LEGACY_CUSTOMERS`)

| Legacy column | New field | Normalization |
|---|---|---|
| `customer_name` | `Customer.name` | whitespace + title case |
| `email` | `Customer.email` | lowercase/trim; malformed → row invalid |
| `phone` | `Customer.phone` + `Customer.normalizedPhone` | E.164 via `lib/phone.ts`; unfixable → treated as absent |
| address columns | `Address` rows on the customer | ZIP normalized to 5 / 5+4; unfixable ZIP → address lands with `needsReview` + reason (review queue, UR-014) |

One CSV row = one address; rows sharing email/phone are **one customer with a book**.
Matching an existing customer (email or normalized phone) is a **merge**, not a
duplicate — the address attaches to the existing book, and a merge never renames.
Email and phone pointing at *different* existing customers is ambiguous → row invalid
with "merge those customers first" (a human decision, never a guess).

## Products (`LEGACY_PRODUCTS`)

| Legacy column | New field |
|---|---|
| `year` | `Season` `Legacy <year>` (upsert CLOSED) |
| `product_name` | `Product.name`; slug `legacy-<year>-<slug>` (unique, dedupe key) |
| `price` | `Product.basePriceCents` |
| `product_type` | `Product.category` |
| `size_text` | `Product.description` |

Existing slug → duplicate, left alone (never auto-updated).

## Orders (`LEGACY_ORDERS`)

One CSV row per line item; rows sharing `legacy_order_no` commit as one
`FINALIZED` order in `Legacy <order_date year>`.

| Legacy column | New field | Notes |
|---|---|---|
| `legacy_order_no` | `Order.legacyRef` | verbatim; re-import dedupes on it |
| — | `Order.orderNumber` + `Order.wireFormat` | **order-number repair (G-029):** always a fresh per-season sequential number via `claimOrderNumber` — broken/duplicated legacy numbers are never trusted |
| `order_date` | `Order.createdAt` (+ season year) | |
| `email` / `phone` | `Customer` resolution | same ambiguity law as customers import |
| `item_name` (+qty, unit price) | `OrderLine` snapshots | unknown products become **inactive $0 stubs** (`legacy-<year>-<slug>`) — a repeat lands on the P10 review page with price-smart suggestions; that page is the correction UI |
| `shipping_cents` | `Order.deliveryFeesCents` + `DraftRecipient.deliveryFeeCents` | |
| `total_cents` | `Order.totalCents` | authoritative when present (may embed old-system discounts); otherwise Σ lines + shipping |
| recipient columns | `DraftRecipient` (snapshot) | missing → customer's first clean book address; none → row invalid "map one first" |
| `payment_method` + `payment_status` | `Payment` via `postPaymentTx` | paid → posted payment, `externalRef = legacy:<order_no>`; unpaid → none |

**Refunded legacy orders:** imported `FINALIZED` with `paymentStatus PAID` and no
payment rows. The money was collected *and* returned inside the old system (net
zero); a POSTED+VOIDED pair here would recompute the order into this year's
collection queues, which is false. Terminal state, set once, documented here.

## Address-book cleanup (UR-014)

`lib/imports/legacy/cleanup.ts` powers the review queue on the customer page:

- **Duplicate groups** — loose group key (punctuation-insensitive) surfaces
  near-dupes; staff picks a keeper, the rest merge away in one audited transaction.
  An address referenced by shipped packages (`Package.recipientAddress` is RESTRICT)
  can never be merged away — the UI error says to edit instead.
- **Flagged rows** — import sets `needsReview` + `reviewReason`; a human confirms or
  edits (normal address PATCH) then clears the flag. Both actions audit
  (`address_merge` / `address_review`).

## Repeat-order path

Imported orders carry real `DraftRecipient` + `OrderLine` rows, so the P10 repeat
flow (`/orders/[id]/repeat`) works on them directly: known products map to the legacy
catalog row, stubs route to the review page. That closes the year-one story — P12
migration feeds P10 repeat, which feeds the live catalog via replacement links.
