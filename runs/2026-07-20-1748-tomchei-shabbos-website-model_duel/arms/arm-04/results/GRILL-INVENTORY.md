# Grill inventory — arm-04

Source: `results/GRILL-TRANSCRIPT.md` only. No codebase knowledge used; every row cites transcript location.

**Cite convention:** `T1`–`T10` = grill turns (agent question + user answer + "I heard"). `Close` = the "Grill closed" block (locked-decision table, open items, not-covered list) that follows T10. Rows carrying `Close` alone are things the transcript explicitly records as *not settled*; they appear here as OPEN, not as invented defaults.

**Status key:** blank = decided by the human in-turn; `OPEN` = unresolved human decision, flagged and not defaulted.

---

## A. Catalog & storefront

| ID | Name | Transcript turns | Notes |
|---|---|---|---|
| G-001 | Yearly catalog (one item list per year) | T1, T2, T9 | Seasonal; each year has its own catalog. |
| G-002 | Public storefront | T1, T7 | Donor-facing ordering site. |
| G-003 | Previous-year catalog browsing | T1, T2, T9 | Must work day one off the T2 import; readable while store is closed. |
| G-004 | Off-season shutdown → browse-only mode | T1, T9 | Store close date flips site to browse-only, past catalogs still readable. |
| G-005 | "Replaces item X from last year" pointer on new items | T1, T2 | Maps retired items to replacements; points at imported prior-catalog records. |
| G-006 | Sold-out state on storefront | T5 | Shown when buildable quantity hits zero. |

## B. Order entry

| ID | Name | Transcript turns | Notes |
|---|---|---|---|
| G-007 | Front-end cart and checkout | T1, T4, T7 | Credit card only (G-023). |
| G-008 | Back-office POS order entry (phone / in person) | T1, T5, T7 | Staff take orders; warn-not-block enforcement (G-022). |
| G-009 | Per-item recipient and address | T1, T10 | Each item in an order can go to its own recipient/address; built in from the start, both front end and POS. Multi-recipient order is a rehearsal scenario (T10). |
| G-010 | Per-customer address book | T1, T2, T7 | Populated by import; exists whether or not the donor ever signs in (G-069). |
| G-011 | Recipient records | T2, T7 | Imported from last year; reachable from repeat-order. |
| G-012 | Greeting cards | T1, T2, T3 | Card text stored per order/recipient; imported from last year; printed in the nightly pack. |
| G-013 | Repeat-last-year order flow | T1, T2, T7, T10 | On critical path for season one (T2); available front end and via order taker. |
| G-014 | Replacement-confirmation page before cart is loaded | T1, T7, T10 | Whoever enters the order confirms replacement items before anything reaches the cart. |
| G-015 | Order lines carry their own fulfillment target | T1, T4 | Needed because staff move individual packages between fulfillment types (G-021). |

## C. Fulfillment types and eligibility rules

| ID | Name | Transcript turns | Notes |
|---|---|---|---|
| G-016 | Shipping fulfillment | T1, T9 | Rate-shopped (G-032); has its own cutoff date. |
| G-017 | Pickup fulfillment | T1, T3, T9 | Own window; own print bucket. |
| G-018 | Bulk delivery (any time before Purim) | T1, T3, T9 | Own cutoff; print bucket grouped by area. |
| G-019 | Per-package delivery (last day or two) | T1, T4, T9 | Own pricing scale; allowed zip codes only; own window. |
| G-020 | Zip-code eligibility rule for per-package delivery | T4 | Storefront blocks; staff get a warning they can click past. |
| G-021 | Staff switch of an order's fulfillment type after payment | T1, T4, T10 | E.g. shippable box rides a route already going next door. Never moves money (G-026). Rehearsal scenario (T10). |
| G-022 | One rules engine, two enforcement levels | T4, T5, T9 | Hard-stop on storefront, warn-and-log for staff. Applies to zip eligibility (T4), buildable stock (T5) and season dates (T9); explicitly not two copies of the rules. |

## D. Money and accounting

| ID | Name | Transcript turns | Notes |
|---|---|---|---|
| G-023 | Credit card only on the front end (Stripe) | T1, T6 | Stripe locked in T6. |
| G-024 | Cash and check accepted in the back office | T1, Close | **OPEN** — how cash/check are recorded and reconciled was explicitly not covered (Close). |
| G-025 | Price locked at checkout; captured amount immutable | T4 | Nothing that happens in the warehouse afterwards moves the total. |
| G-026 | No automatic refund or re-charge on fulfillment-type switch | T4 | Savings stay with the organisation as fundraising margin. |
| G-027 | Manager "adjust total" action, reason required | T4, T10 | Only way money moves post-checkout; refunds to card or sends a payment link. Rehearsal charges and refunds one real dollar (T10). |
| G-028 | Captured amount stored separately from actual fulfillment cost | T4 | The two may diverge; the spread is reportable as margin. |
| G-029 | Audit event log with actor and reason | T4, T8, T9 | Covers price adjustments, staff overrides, stock adjustments, driver/staff delivery marks. Append-only, not edit-in-place. |
| G-030 | Payment capture timing | Close | **OPEN** — listed as not covered in this grill. |
| G-031 | Tax receipts / acknowledgement letters | Close | **OPEN** — listed as not covered in this grill. |

## E. Carriers and rate shopping

| ID | Name | Transcript turns | Notes |
|---|---|---|---|
| G-032 | Rate shopping: quote the higher of FedEx/UPS, ship on the cheaper | T1, T4, T6 | Spread is intentional fundraising margin. In scope this season (T1, "nothing deferred"). |
| G-033 | Shipping aggregator integration | T6 | Agent locked aggregator over direct carrier contracts after the human delegated the choice. **OPEN** — EasyPost vs Shippo not chosen. |
| G-034 | Carrier label printing (both carriers) | T3, T6 | Labels also part of the nightly print pack. |
| G-035 | Attach the organisation's own negotiated FedEx/UPS account numbers | T6 | Supported by the aggregator. **OPEN** — whether such accounts exist. |
| G-036 | Manual shipping fallback | T6 | Staffer types a shipping price and tracking number by hand if rates fail. |

## F. Inventory and production

| ID | Name | Transcript turns | Notes |
|---|---|---|---|
| G-037 | Component stock tracking | T1, T5 | Jars, boxes, bows, chocolates. |
| G-038 | Finished-package stock tracking | T1, T5 | Counted separately from components. |
| G-039 | Optional per-item recipe | T5 | Bridge between components and finished packages; no recipe = plain count. |
| G-040 | Production build runs | T1, T5 | "Assemble 50 Deluxe baskets" consumes components, produces finished packages. |
| G-041 | Derived buildable quantity | T5 | Finished stock + minimum buildable from components − committed to unfulfilled orders. Must be computed consistently, not stored and drifted. |
| G-042 | Stock ledger entries | T5 | Received, consumed by build, produced by build, committed to order, fulfilled, adjusted-with-reason. Not an overwritable count. |
| G-043 | Sold-out enforcement: storefront hard-stop, POS warn | T5 | Same one-engine-two-levels pattern as G-022. |

## G. Nightly print run

| ID | Name | Transcript turns | Notes |
|---|---|---|---|
| G-044 | Print-run screen, day-selectable, defaults to today's orders | T3 | The screen the team touches every night in peak weeks. |
| G-045 | Bucket grouping of the day's orders | T3 | Buckets named in-turn: bulk delivery by area, per-package delivery, shipping, pickup, single-item packages. **OPEN** — the exact real folder scheme, in her words, still needed (Close item 7). |
| G-046 | One PDF per bucket, documents kept adjacent and in sequence | T3 | Each order's packing slip + labels + greeting cards together, so the stack comes off the printer in filing order. |
| G-047 | Printing records only "printed on [date] by [staffer]" | T1, T3 | Pure side-effect-free log; never marks packed, shipped or delivered. |
| G-048 | Print history is an event log, not a status | T3 | Print run is re-runnable and idempotent from the system's side. |
| G-049 | Unrestricted reprints, stamped as reprints | T3 | Nothing locked behind "we already printed that." |
| G-050 | Packed / shipped / delivered as separate deliberate human actions | T3 | Separate buttons; this is what makes staying on paper possible. |
| G-051 | Bucket definitions stored as data, not hardcoded | T3 | Folder scheme is theirs and will drift year to year. |

## H. Routing and volunteer drivers

| ID | Name | Transcript turns | Notes |
|---|---|---|---|
| G-052 | Delivery map with manager stop-picking and route building | T1, T8 | In scope this season (T1). |
| G-053 | Google optimisation of stop order | T1, T8 | Quickest path. |
| G-054 | Nearby shippable orders visible on the same map | T1 | Enables the "ride along next door" switch (G-021). |
| G-055 | Send route to volunteer driver by text/email link | T1, T8 | No driver login. |
| G-056 | Per-route PIN gate | T8 | Human-added on top of the recommended option. Code delivered separately, entered once then device trusted for that route, rate-limited with lockout, per-route rather than a shared password. |
| G-057 | Route link expiry and manager revoke | T8 | Link dies when the route's date passes; manager can revoke on the spot if a phone goes missing. |
| G-058 | Driver mobile stop list | T8 | Name, address and contents per stop. |
| G-059 | One tap to open Google Maps or Waze | T8 | Per stop. |
| G-060 | One tap to mark delivered, with preset notes | T8 | Nobody home, left with a neighbour, wrong address. |
| G-061 | Live delivery board at the house | T8 | House watches stops tick over in real time. |
| G-062 | Printable route sheet | T8 | Paper alternative for any driver who prefers it. |
| G-063 | Office staff mark stops on a driver's behalf; mark source visible | T8 | Manager can see driver-device marks vs office marks. |
| G-064 | Manual stop ordering fallback | T6, T8 | Manager drags stops into order if Google routing fails. |

## I. Identity, accounts and permissions

| ID | Name | Transcript turns | Notes |
|---|---|---|---|
| G-065 | Email + password donor accounts on the storefront | T7 | Human chose B over the agent's passwordless recommendation. |
| G-066 | Self-serve password reset by email | T7 | Mitigation inside the chosen option. |
| G-067 | Staff-side "send this donor a reset link" | T7 | Order taker rescues a donor by phone without handling a password. |
| G-068 | Long sessions during the season | T7 | Returning donor not challenged every visit. |
| G-069 | Customer record separate from the login credential | T7 | Agent-held structural decision ("plumbing, not a product decision"). Customer with address book, recipients, cards and history exists with no login, so phone orders and Excel imports are never orphans. |
| G-070 | Guest checkout | T7 | **OPEN** — with passwords chosen, whether guest checkout survives was explicitly deferred. |
| G-071 | New donor created by staff on a phone order | T7 | **OPEN** — customer with no login, or invite to set a password? |
| G-072 | Back-office staff roles and permissions | T4, T8, T9, Close | Manager-only actions referenced in-turn (adjust total T4, route send/revoke T8, calendar T9), but the role/permission model itself is **OPEN** (Close). |

## J. Season calendar and cutoffs

| ID | Name | Transcript turns | Notes |
|---|---|---|---|
| G-073 | Season calendar screen, dates only, filled once a year by a manager | T9 | |
| G-074 | Store open date and store close date | T9 | Close date triggers browse-only (G-004). |
| G-075 | Shipping cutoff date | T9 | Early enough for a carrier to arrive before Purim. |
| G-076 | Bulk delivery cutoff date | T9 | |
| G-077 | Per-package delivery window | T9 | Pairs with the zip rule (G-020). |
| G-078 | Pickup window | T9 | |
| G-079 | Storefront availability follows dates automatically | T9 | Expired options are simply not offered; nobody flips a switch at midnight. |
| G-080 | Staff may take orders outside a window, warned and logged | T9 | Logged with who and why. |
| G-081 | Dates stored as per-season data, not code | T9 | Next year is a form fill, not a deploy. |
| G-082 | Timezone and to-the-minute meaning of each cutoff | T9 | **OPEN** — flagged as needed; "the day before Purim" differs at 9am and 11:59pm. |

## K. Prior-year data migration

| ID | Name | Transcript turns | Notes |
|---|---|---|---|
| G-083 | Excel workbook import | T2 | File drop, not a live API. Imports customers, address books/recipients, greeting card text, prior orders, prior catalog. Single dependency that cannot be coded around. |
| G-084 | Re-runnable import | T2 | Load a rough version now, reload a cleaned version later without starting over. |
| G-085 | Import cleanup pass against real columns | T2 | Expect merged cells, one row per order rather than per line item, address blobs, name variants. |
| G-086 | Duplicate recipient and address handling across customers | T2, Close | **OPEN** — hinted at in T2 ("names spelled three ways"), explicitly listed as not covered (Close). |

## L. Integration infrastructure and accounts

| ID | Name | Transcript turns | Notes |
|---|---|---|---|
| G-087 | Swap layer with sandbox mode on every integration | T6 | Build does not wait on credentials. |
| G-088 | Google Maps Platform key with billing attached | T6, T8 | Needed for the route map and optimisation. |
| G-089 | One named person owning aggregator, Stripe and Maps logins | T6 | **OPEN** — the person is not named; agent asked for it this week. Payment processor application is longest pole and should start first. |

## M. Validation and go-live

| ID | Name | Transcript turns | Notes |
|---|---|---|---|
| G-090 | Continuous demos as each piece is finished | T10 | Human chose both A and B. Keeps the build from drifting; does not replace the rehearsal. |
| G-091 | Full dress rehearsal as a hard gate | T10 | On a copy of the live system loaded with last year's real Excel data, roughly three weeks before the store opens. |
| G-092 | Rehearsal scenario set | T10 | Storefront and phone orders; a repeat order with replacements; a multi-recipient order; a delivery-type switch; a real print night on the real printer with real label stock filed into real folders; a manager-built route driven with the PIN link; one real box shipped; one real card charged and refunded. |
| G-093 | Staff sign-off; failure blocks opening and the rehearsal re-runs | T10 | Signed off by the people who will run the season, not by the builder. |
| G-094 | Rehearsal date on the calendar | T10 | **OPEN** — date not set, and which staff sign off is not named. |

## N. Scope, deadline and unaddressed non-functionals

| ID | Name | Transcript turns | Notes |
|---|---|---|---|
| G-095 | Fixed Purim deadline, everything in one build, nothing deferred | T1 | No scope relief; flex comes from sequencing and early external dependencies. **OPEN** — the actual Purim date was never given (Close item 2). |
| G-096 | Manual path preserved everywhere | T1, T3, T6, T8 | Cross-cutting: printing never advances an order, every integration has hand-entry fallback, routes can be paper, staff can act for a driver. |
| G-097 | Greeting card format and length limits | T1, T3, Close | **OPEN** — cards are in scope, their format constraints are not covered. |
| G-098 | Expected order volume and peak-day load | Close | **OPEN** — listed as not covered in this grill. |
| G-099 | Hosting and who administers it after the season | Close | **OPEN** — listed as not covered in this grill. |

---

## Open decisions — human input still needed

| ID | Open decision | Transcript turns | Blocks |
|---|---|---|---|
| O-001 | The actual Excel workbooks (files, or header rows + sample lines) | T2, Close | G-083, G-084, G-085 |
| O-002 | The Purim date and every season calendar value (open, cutoffs, windows, close) | T1, T9, Close | G-073–G-081, G-095 |
| O-003 | Timezone and to-the-minute definition of each cutoff | T9, Close | G-082 |
| O-004 | Named owner of the aggregator, Stripe and Google Maps logins; confirmation the payment application is started first | T6, Close | G-089, G-023, G-033, G-088 |
| O-005 | EasyPost vs Shippo | T6, Close | G-033 |
| O-006 | Whether the organisation already holds negotiated FedEx/UPS accounts worth attaching | T6, Close | G-035 |
| O-007 | Guest checkout: may someone check out without registering, now that passwords are chosen? | T7, Close | G-070, G-007 |
| O-008 | Staff taking a phone order for a brand-new donor: customer with no login, or invite to set a password? | T7, Close | G-071, G-008 |
| O-009 | Dress rehearsal date, and which staff members sign it off | T10, Close | G-094, G-091, G-093 |
| O-010 | The exact folder scheme the print buckets must match, in her words | T3, Close | G-045, G-051 |
| O-011 | Payment capture timing | Close | G-030 |
| O-012 | How cash and check payments are recorded and reconciled | T1, Close | G-024 |
| O-013 | Tax receipts / acknowledgement letters | Close | G-031 |
| O-014 | Back-office staff roles and permissions | Close | G-072 |
| O-015 | Greeting card format and length limits | Close | G-097 |
| O-016 | Duplicate recipient and address handling across customers | T2, Close | G-086 |
| O-017 | Expected order volume and peak-day load | Close | G-098 |
| O-018 | Hosting and post-season administration | Close | G-099 |

---

## Agent-taken decisions (human delegated or explicitly ceded)

Recorded separately because these are not human answers and should be re-confirmable.

| ID | Decision | Transcript turns |
|---|---|---|
| G-033 | Aggregator over direct carrier contracts — human said "A or B, whichever is better"; agent locked A | T6 |
| G-069 | Customer record separate from login — agent kept this despite the human choosing password accounts, calling it plumbing rather than a product decision | T7 |

## Counts

- Features / capabilities: **99** (G-001 … G-099)
- Open decisions: **18** (O-001 … O-018); 17 feature rows carry an OPEN flag
- Turns covered: T1 … T10, plus the Close block
