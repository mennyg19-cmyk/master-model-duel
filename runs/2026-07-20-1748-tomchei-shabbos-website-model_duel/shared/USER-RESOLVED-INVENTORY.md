# User-resolved inventory — Test 1b gate

Run: `2026-07-20-1748-tomchei-shabbos-website-model_duel`  
Resolved: 2026-07-20 (orchestrator, from grill + user confirmation)  
Sources: `shared/RECONCILED-INVENTORY.md` (192 codebase rows), arm-01/arm-02 grill inventories, `shared/INVENTORY-COMPARISON.md`

This is the **frozen build target** for Test 2. Contestants plan and build against this document, not raw codebase reconcile alone.

---

## User resolutions (8 comparison items)

| # | Topic | Decision |
|---|---|---|
| 1 | Fulfillment-method switch + charge | **Confirmed.** When staff switch shipping ↔ volunteer delivery, the customer’s paid delivery/shipping charge does **not** change. Org keeps savings. |
| 2 | Shipping rate margin | **Margin capture.** Quote FedEx/UPS (and USPS where applicable); charge customer the **higher** rate; ship on the **cheaper** carrier; org keeps the spread. |
| 3 | Package-level entity | **Confirmed.** Rebuild tracks **physical packages (boxes)** — grouping, splitting, per-package status, printing, and rerouting — linked to the customer order. |
| 4 | Driver access | **Magic-link middle path** (not full login, not bare public URL): unguessable per-route link; shows **only that route’s stops**; **expires** when route is marked complete (optional short grace); **optional 4-digit PIN** manager texts driver; audit log on every “Delivered” tap (time + route link id). |
| 5 | Maps | **Mapbox** for admin route map / geocoding (reuse existing pattern). Drivers get **free “Open in Google Maps” deep links** per stop for turn-by-turn — no embedded Google Maps API. |
| 6 | Shipping vendor | **Shippo** with org’s existing **FedEx + UPS business accounts** connected for negotiated rates. Labels void/cancel via Shippo when rerouting printed-but-not-shipped packages. |
| 7 | Ingredient / BOM inventory | **Hidden at launch** (finished-package counts only). Data model supports BOM + assembly batches; **managers enable** ingredient tracking when the team is ready — not forced on volunteers day one. |
| 8a | R-109 role model | **Customers are not staff.** Website customers have accounts/address books; staff are Manager / Staff / Driver with permissions. Do not store customers in the staff roles table. |
| 8b | R-166 Stripe checkout | **Hosted Stripe Checkout** (redirect). Do not embed card forms on-site at launch; treat `@stripe/stripe-js` / react-stripe packages as unused unless a later phase adds embedded checkout. Minimal PCI surface. |

### Minor OPEN items closed by orchestrator (user silent → sensible default)

| Item | Default |
|---|---|
| Bulk-delivery notification channel (G-021) | Email + SMS when staff assign bulk delivery date/window |
| Map “nearby” shipping packages (G-027) | Show unshipped shipping packages within **~0.5 mile** of a route stop (or same street cluster); manager **always confirms** before switch (never auto) |
| Scale baseline | 1,000+ orders / 5,000+ packages / 10+ concurrent staff at crunch — batch tools and concurrency from day one |

---

## Rebuild scope summary

### Greenfield / major behavior changes (grill wins over codebase)

| ID | Requirement |
|---|---|
| UR-001 | **Package entity** — default combine by recipient/address/method/greeting; staff can split; track/print by package; optional stages New → Printed → Packed → Sent/Picked Up; print ≠ shipped |
| UR-002 | **Method switch with charge preservation** — staff reroute shipping ↔ delivery; no customer refund/collect; audit who/when |
| UR-003 | **Rate margin** — charge higher quoted carrier rate; ship cheaper; reconcile margin internally |
| UR-004 | **Map reroute** — Mapbox map shows delivery stops + nearby unshipped shipping; manager confirms; void Shippo label if printed-not-shipped; add to route; update print batch |
| UR-005 | **Nightly print batch** — separate PDF per filing group; parallel print/file; reprint per group/order |
| UR-006 | **Cart-first order entry** — catalog + cart + qty; assign each line to on-order / address-book / new recipient; new recipients save to address book; same UX on web + POS |
| UR-007 | **Repeat order** — copy prior year to draft; middle page confirms replacements **and** recipients; price-smart defaults; admin replacement mappings per catalog item |
| UR-008 | **Seasons** — per-year catalog + replacement links; manager Open/Closed; off-season browse archive (all years, no checkout); optional scheduled auto flip |
| UR-009 | **Delivery rules** — bulk: one fee per destination, staff-scheduled; per-package: fee per recipient, zip hard-block, manager-set Purim-week days at checkout, day-of notification on route start |
| UR-010 | **Pickup** — eligible when order inventory available; ready notify; door list + picked-up stamp; unclaimed report |
| UR-011 | **Payments** — web: Stripe hosted, immediate capture; POS: check/cash with staff audit |
| UR-012 | **Roles** — Manager / Staff / Driver; individual logins; managers toggle per-person permissions |
| UR-013 | **Greeting cards** — order default + per-recipient override; remember last greeting per recipient; separate card-stock PDF per filing group |
| UR-014 | **Address book** — one book per customer (web + POS); staff edit with audit; migration of messy legacy data before year-one repeat-order |
| UR-015 | **Driver UX** — mobile web route link (UR-004 auth model) + printed fallback; Mapbox office map + Google Maps deep links |
| UR-016 | **Production** — finished-package inventory v1; BOM/ingredients in schema, UI hidden until manager enables |

### Carry forward from codebase (192-row reconcile)

Unless contradicted above, **retain** existing capabilities from `shared/RECONCILED-INVENTORY.md`: storefront/marketing pages, account self-serve, admin catalog/media, reports/exports, email subscribe, order builder shell foundations, checkout validation, customer profiles, admin operations hub, security patterns (adapted to UR-012 role model), integrations scaffolding (Stripe hosted, Resend, etc.).

**Explicit overrides** (codebase behavior replaced):

- Pass-through shipping rates → UR-003 margin capture  
- Order/fulfillment-group-only fulfillment → UR-001 package entity  
- Logged-in messenger driver model → UR-015 magic-link + optional PIN  
- Label void only on save failure → UR-004 void on reroute via Shippo  

---

## Feature checklist (merged grill union)

All items below are **in scope** for the rebuild plan unless marked *phase 2*.

| ID | Feature | Grill source |
|---|---|---|
| G-001 | Hybrid fulfillment (print-first + optional digital stages) | arm-01 T1 |
| G-002 | Print slips/labels/cards without marking shipped | arm-01 T1, arm-02 T6 |
| G-003 | Default package grouping + staff split | arm-01 T2 |
| G-004 | Package-level status and printing | arm-01 T2, arm-02 T8 |
| G-005 | Staff method switch; preserve paid charge | arm-01 T3, arm-02 T10/T12 |
| G-006 | Shipping rate-shop + margin + Shippo labels | arm-02 T3 → **Shippo** |
| G-007 | Stripe hosted checkout, immediate capture | arm-02 T4 |
| G-008 | Finished-package inventory (v1 primary) | arm-01 T4 |
| G-009 | BOM/ingredients — schema yes, UI hidden; manager enables later | arm-01 T4 |
| G-010 | Assembly batches consume supplies → finished stock | arm-01 T4 |
| G-011 | Repeat-order draft + review page | arm-01 T5, arm-02 T1/T8/T13 |
| G-012 | Unmapped items: must pick or remove; price-smart suggestions | arm-01 T5 |
| G-013 | Admin replacement mappings per catalog item | arm-01 T5, arm-02 T9 |
| G-014 | Per-package delivery zip hard-block | arm-01 T6 |
| G-015 | Bulk fee per destination; per-package fee per recipient | arm-01 T7 |
| G-016 | Staff/Manager roles + per-person permission toggles | arm-01 T8, arm-02 T7 |
| G-017 | Staff-scheduled bulk delivery + notify customer | arm-01 T9 |
| G-018 | Cart-first order entry + three-way recipient picker | arm-01 T10 |
| G-019 | Auto-save new recipients to address book; staff edit with audit | arm-01 T10, arm-02 T13 |
| G-020 | Per-recipient greeting memory | arm-01 T11 |
| G-021 | Greeting cards: order default + overrides; separate card PDF | arm-02 T8 |
| G-022 | Off-season + full catalog archive | arm-01 T12, arm-02 T9 |
| G-023 | Map suggest + confirm reroute; void label | arm-01 T13, arm-02 T10 |
| G-024 | Large-scale ops (1k orders / 5k packages / 10+ staff) | arm-02 T2 |
| G-025 | Driver mobile web + print fallback; magic-link auth | arm-02 T5, user #4 |
| G-026 | Pickup when inventory available; ready notify; door list | arm-02 T11 |
| G-027 | Per-package delivery: staff-routed days; day-of notification | arm-02 T12 |
| G-028 | POS check/cash payments | arm-02 T7/T16 |
| G-029 | Historical data migration (messy export + cleanup) | arm-02 T1 |
| G-030 | Mapbox admin map; Google Maps deep links for drivers | user #5 |

---

## Out of scope / deferred

- Embedded Stripe Elements on-site checkout (R-166) — deferred; hosted only at launch  
- Ingredient inventory UI — phase 2 when managers enable  
- Customer-chosen bulk or per-package delivery appointment slots — rejected in grill  
- Manager override for out-of-area per-package delivery — rejected (hard block)  
- Automatic map reroute without confirmation — rejected  

---

## Sign-off

User confirmed resolutions 1–8 via orchestrator chat (2026-07-20). Test 2 may proceed.
