# Grill inventory — arm-02

Built solely from `arms/arm-02/results/GRILL-TRANSCRIPT.md` (13 turns). Evidence = turn numbers only.

| ID | Name | Transcript turns | Notes |
|---|---|---|---|
| G-001 | Historical data migration | T1 | Exportable legacy data exists (customers, addresses, orders, greeting cards) but is messy; launch includes migration with manual cleanup/normalization to the new schema so repeat-order works in year one. |
| G-002 | Repeat last year's order | T1, T8, T9, T13 | Flagship flow: copies prior-year recipients, items (via replacement links), and greeting messages (default + per-recipient overrides); confirmation middle page shows recipients alongside item replacements for verbal address confirmation in one pass. |
| G-003 | Large-scale operations baseline | T2 | 1,000+ orders, 5,000+ packages, 10+ concurrent staff at crunch; batch tools, stricter concurrency handling, and fast bulk printing required from day one. |
| G-004 | Shipping rate-shop + label printing | T3, T10 | Multi-carrier live rates (FedEx/UPS/USPS), charge customer the higher quote, ship with cheaper carrier; org's existing FedEx/UPS negotiated-rate accounts connected through an aggregator; label void needed for reroute (T10). **OPEN:** final vendor choice — Shippo vs EasyPost vs direct dual-carrier APIs — pending maintenance-cost input. |
| G-005 | Stripe checkout, immediate capture | T4 | Cards are the only website payment method; Stripe (or similar) charges full amount at checkout; staff never handle card data; one-click refunds when orders change; nonprofit discount path acceptable. |
| G-006 | Driver mobile web route link | T5, T12 | No-install mobile page per driver: ordered stop list, tap-to-navigate (Google Maps), tap "Delivered" per stop for live office progress; route start triggers day-of delivery notifications (T12). |
| G-007 | Printed route sheet fallback | T5 | For drivers without smartphones: printed route sheet plus a Google Maps link with stops pre-loaded; office marks orders delivered from paper on the driver's return. |
| G-008 | Nightly print batch (per-group PDFs) | T6 | "Tonight's Batch" gathers all not-yet-printed orders and produces a separate PDF per filing group (delivery area, shipping, single-item, etc.) so 10+ staff print/file in parallel; "printed" flag independent of "shipped"; reprint per group or order. |
| G-009 | Roles + per-person permissions | T7 | Manager / Staff / Driver base roles with individual logins (drivers via no-login route link); managers can toggle specific permissions per person (e.g. pack but not record payments); every payment and change stamped with who did it. |
| G-010 | Greeting cards | T8 | One default greeting per order applied to all recipients, optional per-recipient override; cards print as their own separate PDF per filing group (card stock); repeat-order copies default + overrides. |
| G-011 | Season lifecycle + per-year catalogs | T9 | Seasons are first-class; manager builds each year's catalog with "replaces last year's X" links per item; manual Open/Closed switch; closed = browse-only site (current + past catalogs, prices hidden or "last season", no cart/checkout); past seasons read-only forever; optional scheduled auto open/close dates as secondary add-on. |
| G-012 | Map reroute: shipping → delivery | T10 | Route map shows delivery stops in one color and nearby unshipped shipping orders in another; one-click "Add to this route" switches method, updates print batch grouping, logs order history; printed-but-unshipped labels auto-voided as part of the switch; no customer refund — org keeps shipping savings. |
| G-013 | Pickup workflow | T11 | Per-order pickup eligibility begins as soon as that order's inventory is available (not a fixed window start); staff mark "Ready for pickup" → automatic email/text; door-side searchable pickup list with "Picked up" who/when stamp; unclaimed-orders report for pre-Purim call-downs; season may cap latest pickup hours. |
| G-014 | Per-package delivery promise | T12 | Premium option, zip-code restricted; checkout shows manager-set allowed delivery day(s) before Purim with no customer slot choice; managers assign routes freely; "out for delivery today" notification when the driver's route starts. |
| G-015 | Customer address book | T13 | Single customer-owned address book shared by website and POS; staff can fully view/edit from POS (add, fix, delete) with who-edited audit stamps; repeat-order review page confirms addresses together with item replacements — no separate address-review step. |
| G-016 | POS phone orders with check/cash | T7 | Staff take phone orders and record check/cash payments (website remains card-only per T4); recorded payments traceable to the individual staff member via per-user logins. |

## OPEN items

| ID | Item | Turn | Detail |
|---|---|---|---|
| OPEN-1 | Shipping aggregator vendor | T3 | Shippo vs EasyPost vs direct FedEx+UPS APIs — user leans aggregator with org's negotiated-rate accounts attached; final call deferred pending orchestrator/builder input on build and maintenance cost. |
