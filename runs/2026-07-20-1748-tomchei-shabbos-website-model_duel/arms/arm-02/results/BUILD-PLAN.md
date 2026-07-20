# BUILD-PLAN — arm-02 (Test 2, greenfield)

Target: `shared/USER-RESOLVED-INVENTORY.md` (UR-001..UR-016, G-001..G-030, 8 user resolutions) as the frozen spec, plus the full 192-row carry-forward from `shared/RECONCILED-INVENTORY.md` (R-001..R-192) except where explicitly overridden (pass-through rates → UR-003; order/group-only fulfillment → UR-001; logged-in driver → UR-015; label void on save-failure only → UR-004).

Scale baseline (binding on every phase): 1,000+ orders / 5,000+ packages / 10+ concurrent staff at Purim crunch. Batch tools, pagination, and concurrency-safe writes from day one — not retrofitted.

---

## 1. Goals / non-goals

### Goals

- Rebuild the nonprofit Purim mishloach manos platform greenfield: storefront, cart-first ordering, hosted Stripe checkout, POS, admin operations, fulfillment, shipping, volunteer delivery routes, pickup, inventory, email, reports, migration.
- Introduce the **physical package (box)** as a first-class entity (UR-001): default grouping, staff split, per-package status/printing/rerouting, print ≠ shipped.
- Money rules exactly as resolved: charge preserved on method switch (UR-002), carrier rate-margin capture (UR-003), hosted Stripe immediate capture on web + check/cash POS with audit (UR-011).
- Driver access via expiring magic-link + optional PIN with delivery audit log (UR-004/UR-015); Mapbox for admin maps, Google Maps deep links for drivers (G-030).
- Roles: Manager / Staff / Driver with per-person permission toggles; customers are accounts, never staff rows (UR-012, resolution 8a).
- Seasons with per-year catalog, replacement mappings, off-season archive browse, repeat-order with review page (UR-007/UR-008).
- Finished-package inventory at launch; BOM/ingredient schema present but UI hidden behind a manager toggle (UR-016, G-009).
- Retain every carry-forward capability: marketing pages, newsletter, account self-serve, admin catalog/media, imports, exports, reconciliation, email hub, cron jobs, test-mode console, help center, security patterns.

### Non-goals (out of scope per inventory)

- Embedded Stripe Elements on-site checkout — hosted redirect only at launch (resolution 8b; R-166 client packages treated as unused).
- Ingredient/BOM **UI** at launch — schema only, manager enables later.
- Customer-chosen delivery appointment slots (bulk or per-package) — rejected in grill.
- Manager override for out-of-area per-package delivery — zip block is hard (G-014).
- Automatic map reroute without manager confirmation — rejected; confirm always (G-023).
- Anything absent from the inventory (no invented features).

---

## 2. Stack proposal

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | Inventory shape is a single app with storefront/admin/driver route groups, server actions, and API routes; carry-forward rows assume this architecture (route groups, server features, cron endpoints). Effectively **forced by inventory**. |
| DB / ORM | PostgreSQL + Prisma, ordered migrations + CI schema guard | R-137..R-141 carry forward normalized Postgres/Prisma with migration discipline. Forced. |
| Auth | Clerk (staff + customer identities, separate role tables) | R-107/R-108 carry forward Clerk; UR-012 role model layered on top. Driver magic links are app-issued tokens, not Clerk sessions. |
| Payments | Stripe hosted Checkout + webhooks; offline check/cash payments table | UR-011 / G-007 forced hosted-redirect. |
| Shipping | Shippo with org FedEx + UPS accounts connected | Resolution 6 forced. Rate-shop both, charge higher, ship cheaper (UR-003). |
| Maps | Mapbox (admin map + geocoding with cache) + Google Maps deep links for drivers | Resolutions 4/5 forced. No embedded Google API. |
| Email | Resend + transactional outbox + retrying sweeper | R-171, R-088 carry forward. |
| SMS | Twilio (or equivalent single provider) | G-021 default: email + SMS for bulk-delivery scheduling and driver PINs. Only SMS need in inventory; one thin integration module. |
| Storage | Vercel Blob for media | R-180 carry forward. |
| UI | shadcn-style kit + design tokens + Tailwind | R-188..R-190 carry forward. |
| PDFs | Server-rendered print routes (`@media print`) for slips/labels/cards + batch PDF generation for nightly print batches | UR-005 needs one PDF per filing group; print routes carry forward (R-056, R-076). |
| Hosting/cron | Vercel + Vercel Cron with bearer-secret auth | R-124, R-185 carry forward. |

Ladder note (ponytail): no packages beyond the forced integrations above; queues, Redis, and job frameworks are skipped — Postgres row-locking + cron sweepers cover the 5k-package scale.

---

## 3. Phases

Every phase ends with a gate: expectation checklist verified in the running app with seeded data, `.scratch/run-state.md` updated. Phase IDs are mergeable (P1, P2, …). "IDs covered" lists where a requirement is **delivered**; schema for later phases may land earlier (noted).

### P1 — Foundation: scaffold, tooling, design system

- **IDs:** R-131, R-133, R-137, R-138, R-140, R-141, R-142 (seed skeleton), R-161, R-164, R-187, R-188, R-189, R-190, R-191, R-192; groundwork for G-024.
- **Deliverables:** Next.js + TS + Prisma + Postgres scaffold with route groups `(storefront)` `(admin)` `(driver)`; env schema validation + `.env.example` generator; typed key-value settings store; helper libs (money-in-cents, normalize, phone, ids, season, dates, result-with-error-masking); shadcn kit + tokens + brand constants; global error page + bounded redacted client-error endpoint; health check (DB + env); CI with lint, typecheck, migration guard, disposable migration harness, security guardrails workflow; baseline seed script.
- **Smoke:** app boots; `/api/health` green; CI passes; a page renders with the design system; intentionally missing env var fails startup with a clear message.

### P2 — Identity, roles, permissions, staff tooling

- **IDs:** UR-012, G-016, R-010, R-098, R-099, R-100, R-104, R-107..R-120, R-130, R-135, R-136; customers-not-staff resolution 8a settles the R-109 conflict (customer is an account model, never a StaffRole).
- **Deliverables:** Clerk integration + middleware; StaffUser (Manager/Staff/Driver) with per-user grant/deny overrides and `requirePermission` server gate; separate Customer identity linking; staff confirmation/revocation + invitation linking; first-run setup page with empty-database bootstrap lockout; staff management UI (add, roles, permission-override editor, self-target blocks); impersonation with banner; security audit trail + session login stamps; admin shell with permission-gated sidebar + mobile nav; permission unit tests; production error masking.
- **Smoke:** bootstrap first manager on empty DB then endpoint locks; Staff without a permission gets 403 on a gated admin page while Manager passes; audit log records role change + impersonation; driver-role user sees no admin.

### P3 — Domain core: seasons, catalog, customers, orders, packages (schema + engine)

- **IDs:** UR-001 (schema + grouping engine), UR-008 (season model), UR-016 (BOM schema, hidden), R-044, R-045, R-046, R-047, R-137-extensions: R-144..R-160, R-162, R-163; groundwork for G-003, G-009, G-024.
- **Deliverables:** Prisma schema for Season (open/closed + optional scheduled auto-flip), Product (dims, kinds, inventory flags), options with price adjustments, restricted add-ons, replacement links; Customer (normalized phone/email, dedupe) + saved addresses with geocode fields; Order → OrderLine → add-ons tree with price snapshots, sequential per-season order numbers, draft reference numbers + wire format, cached payment status; **Package entity**: recipient/address/method/greeting grouping key, optional stages New → Printed → Packed → Sent/Picked-Up, package-level audit; fulfillment methods data-driven; payments (stripe/cash/check/comp, posted/voided); Stripe PaymentIntent model; shipping quotes with expiring options; pickup locations; package types + shipment boxes; geocode cache with TTLs; cron run log; BOM/ingredient + assembly-batch tables (no UI); order state machine + finalize + discard; concurrency: row-level locking / optimistic versioning on inventory and package mutations (10+ staff).
- **Smoke:** migration harness passes; seed creates a season + catalog + customer + order; unit tests: grouping key combines same recipient/address/method/greeting and splits differing greeting; state machine rejects illegal transitions; two concurrent finalizations don't double-claim an order number.

### P4 — Storefront: marketing, catalog, archive, newsletter, admin catalog & media

- **IDs:** G-022 (archive half), UR-008 (browse archive, closure gate), R-001..R-009, R-011..R-013, R-015..R-018, R-065, R-066, R-067, R-128, R-180.
- **Deliverables:** homepage (mission, impact bar, how-it-works, testimonials, CTAs) store-open-aware; current-season catalog with category filters, price sort, sold-out handling, quick view, detail + option pricing; past-collections archive (all years, browse only, no checkout); storewide closed banner + closure enforcement on order/checkout routes; newsletter subscribe + preferences + HMAC tokenized unsubscribe; storefront shell (header/nav/mobile menu/user menu/footer signup); admin product catalog CRUD with season select + replacement-link editor shell; add-on management; media library on Vercel Blob with restricted validated uploads + needs-photos panel; marketing imagery.
- **Smoke:** closed season hides checkout CTAs and blocks `/order`; archive shows prior seasons without buy buttons; subscribe → unsubscribe token round-trip; upload rejects a non-image; product created in admin appears in storefront grid.

### P5 — Cart-first order builder, address book, customer account

- **IDs:** UR-006, UR-014 (book + staff edit w/ audit; migration in P16), G-018, G-019, R-019..R-031, R-038, R-039, R-040, R-042, R-043, R-114.
- **Deliverables:** cart-first flow — catalog + cart + quantities first, then assign each line to **on-order / address-book / new recipient** (three-way picker); new recipients auto-save to the customer's single address book; address autocomplete + server validation; edit saved address mid-order; inventory-aware live stock in builder; autosave drafts + guest draft clear; desktop sidebar + mobile cart FAB; same builder shell reused by POS (P11); account area: dashboard, order history + detail, continue/pay/cancel draft, profile (ownership-enforced), address view; staff address edits audited.
- **Smoke:** add 3 items → assign to self, a saved recipient, and a new recipient → new recipient appears in address book; refresh mid-order restores draft; guest draft cleared after success; second browser can't open another customer's draft.

### P6 — Checkout: delivery rules, fees, Stripe hosted, guards

- **IDs:** UR-009 (checkout half), UR-011 (web half), UR-013 (order default + per-recipient greeting capture, memory), G-007, G-014, G-015, G-020, R-023, R-032 (rule engine, rates in P8), R-033..R-037, R-121..R-127, R-132 (wired P1), R-166..R-170.
- **Deliverables:** checkout with per-recipient fulfillment method; delivery rules — bulk: one fee per destination, staff-scheduled later; per-package: fee per recipient, **hard zip block**, manager-set Purim-week day choices; greeting: order default + per-recipient override, remembered per recipient for next season; stock + price validation; hosted Stripe Checkout session with immediate capture, webhook authenticity + idempotency, charged-amount safety checks with auto-refund of stale/failed, refund sync; payment recalculation on order edits; guest checkout tokens + draft ownership anti-enumeration; public endpoint guards (same-origin, IP rate limit, Zod); server-enforced offline-payment policy (staff only); success page; lazy Stripe singleton. **No client Stripe packages** (resolution 8b).
- **Smoke:** out-of-zone zip cannot select per-package delivery (no override); bulk order to 2 destinations bills 2 destination fees; per-package to 3 recipients bills 3 fees; Stripe test payment completes and webhook flips order to paid exactly once on replay; tampered price fails validation.

### P7 — Package engine live: grouping UI, statuses, print batches, cards

- **IDs:** UR-001 (staff UI), UR-005, UR-013 (card PDFs), G-001, G-002, G-003, G-004, G-021 (card side), R-056, R-072, R-073.
- **Deliverables:** finalized orders explode into packages via P3 grouping; staff package board — split a package, regroup, per-package status advance (optional stages; printing never implies shipped); fulfillment channel dashboard with bulk status actions + production/savings summaries; **nightly print batch**: separate PDF per filing group (slips, labels) with parallel print/file workflow, reprint per group or per order; greeting-card PDFs per filing group on card stock; per-order packing slip.
- **Smoke:** order with 2 recipients × 2 methods yields correctly split packages; split one package into two and both print; run nightly batch → one PDF per filing group; reprint a single order's slips; printed package still shows unshipped.

### P8 — Shipping: Shippo, rate margin, labels

- **IDs:** UR-003, G-006, R-055, R-081, R-173..R-177, R-183, R-184 (declaration-only carry: UPS creds env slot).
- **Deliverables:** Shippo wrapper (rate/buy/void/track/validate) with org FedEx + UPS accounts; **margin engine**: quote both carriers (+USPS where applicable), charge customer the higher quoted rate, buy label on the cheaper carrier, record spread for internal reconciliation (P15 report); bin packing + shipment planning against package types/boxes; label create/void from order detail and package board; label-failure compensation; tracking refresh; Shippo address validation; typed optional-provider env handling.
- **Smoke:** quote returns both carriers; customer charged the higher, label purchased on the cheaper, margin row recorded; void a label and buy again; rate-resolution rules honored at checkout (live rates replace P6 placeholder).

### P9 — Delivery routes, driver magic links, reroute map

- **IDs:** UR-002, UR-004, UR-015, G-005, G-023, G-025, G-027, G-030, R-074, R-075, R-076 (route card print), R-077, R-078, R-116 replaced by magic-link scoping, R-162 (cache live), R-179.
- **Deliverables:** Mapbox route builder from delivery packages (geocode + cache); route admin (list/detail/reassign/print, per-route greeting-card print); **driver magic link** — unguessable per-route URL scoped to that route's stops, expires on route completion (optional short grace), optional 4-digit PIN the manager texts, audit log on every Delivered tap (time + link id); driver mobile web: stop cards, start route, mark delivered, **Google Maps deep link per stop**, printed route fallback; **method switch** shipping ↔ delivery with charge preserved + who/when audit, both directions; **map reroute**: route map shows unshipped shipping packages within ~0.5 mile of a stop (or same street cluster), manager always confirms, voids printed-not-shipped Shippo label, adds to route, updates print batch; day-of delivery notification on route start (per-package delivery, G-027).
- **Smoke:** open magic link on a phone → only that route's stops; wrong PIN blocked; mark all delivered → link expires; deep link opens Google Maps at the stop; switch a shipping package to delivery → customer balance unchanged, label voided, audit row written; nearby suggestion requires explicit confirm.

### P10 — Pickup & bulk delivery scheduling

- **IDs:** UR-009 (bulk scheduling half), UR-010, G-017, G-026, R-079, R-080, R-182 (cron auth from P1).
- **Deliverables:** pickup eligibility when order inventory is available; ready-notification; door list with picked-up stamp; unclaimed-pickup report; pickup-expiry cron; staff scheduling of bulk delivery date/window with **email + SMS notification** (G-021 default channel); follow-up call center with filters; payment-reminder cron.
- **Smoke:** order flips to ready → customer notified → shows on door list → stamp picked-up; unclaimed report lists stragglers; schedule bulk delivery → email + SMS both fire (test capture); crons reject requests without the bearer secret.

### P11 — Admin operations hub & POS

- **IDs:** UR-006 (POS parity), UR-011 (POS half), G-028, R-049, R-050, R-052, R-053, R-054, R-057 (shell; plan logic P13), R-059, R-060, R-061, R-062, R-063, R-064, R-092 groundwork, R-094, R-095, R-096, R-105, R-106, R-143.
- **Deliverables:** permission-aware dashboard (KPIs, recent orders); "Today" work queue; searchable/filterable order list with shared list controls (search/pagination/sort/badges — built for 1k+ orders); full order detail with money actions; refunds incl. Stripe path; POS using the same cart-first builder + customer lookup/find-or-create + POS checkout taking **check/cash with staff audit**; customer directory + detail + history; staged atomic CSV import (customers/products) with audit; settings hub — Orders tab (store status, package types, pickup locations, follow-up), Shipping tab (rates, rules, delivery ZIPs), Email + Developer tabs; admin chrome (visit-store link, alert banner, back link).
- **Smoke:** POS order for a walk-in with cash payment writes an audited payment row; order list filters + paginates over seeded 1k orders fast; refund posts to Stripe test mode; CSV import stages, validates, commits atomically; delivery-ZIP edit immediately affects checkout blocking.

### P12 — Inventory & production (finished packages v1, BOM hidden)

- **IDs:** UR-016, G-008, G-009, G-010, R-020 (live stock already wired — verify), R-068, R-069, R-070, R-071, R-139.
- **Deliverables:** unified versioned inventory (products + add-ons) with reserve/allocate/release engine (XOR target integrity constraints); inventory overview dashboard; production batch planning + history — assembly batches consume supplies → finished stock (works day one with finished counts only); adjustments, write-offs, shortfall; **manager toggle** in settings that reveals ingredient/BOM UI; while hidden, everything runs on finished-package counts.
- **Smoke:** checkout reserves stock, cancel releases it; oversell blocked under two concurrent checkouts on last unit; assembly batch increments finished stock; ingredient UI absent until toggle, then visible without migration.

### P13 — Seasons, repeat orders, replacement mappings

- **IDs:** UR-007, UR-008 (management + auto-flip), G-011, G-012, G-013, R-041, R-048, R-057, R-058, R-097.
- **Deliverables:** admin replacement mappings per catalog item with cross-season chain resolution; customer repeat: copy prior year to draft, **middle review page confirming replacements AND recipients**, price-smart defaults, unmapped items must be picked or removed; staff single-order repeat; bulk repeat of customer history; new-season setup wizard; manager Open/Closed switch + optional scheduled auto-flip; archive stays browsable off-season.
- **Smoke:** repeat an order containing a discontinued item → review page forces a replacement pick; price-smart default suggests the closest-priced mapped item; bulk repeat drafts N customers; auto-flip opens the season at the scheduled time.

### P14 — Email & notification platform

- **IDs:** G-021 (channel wiring), R-082..R-090, R-163 (log live), R-171, R-172, R-178, R-181, R-087.
- **Deliverables:** Resend integration (SDK isolated); email hub (campaigns, subscribers, lists, templates + branding, triggered); campaign builder + send; triggered/transactional emails with per-key overrides + idempotency + test capture; order lifecycle emails (confirmation, payment link, refund); transactional outbox + retrying sweeper cron; email-log purge cron; email test sender in settings; SMS dispatch module reused by P9/P10 notifications.
- **Smoke:** order confirmation lands via outbox exactly once after a forced first-send failure; campaign to a test list delivers; triggered-email override renders; purge cron trims logs.

### P15 — Reporting, exports, reconciliation

- **IDs:** UR-003 (margin report), R-091, R-092, R-093.
- **Deliverables:** multi-season performance reports + drill-downs; **shipping-margin reconciliation view** (charged vs paid per package, season totals); CSV export center + audit history (deliveries, year-end, year metrics, item sales, lapsed customers); Stripe payment reconciliation (run button + cron + matcher).
- **Smoke:** margin report totals match seeded shipments; each export downloads and its audit row appears; reconciliation flags an orphaned test PaymentIntent.

### P16 — Legacy data migration

- **IDs:** UR-014 (legacy cleanup before year-one repeat), G-029, R-063 (reuse), R-165, R-186.
- **Deliverables:** documented entity map (legacy → new); import pipeline for messy legacy export (customers, products, historical orders) with normalization (phone/email dedupe), order-number repair, staged atomic commits + audit; address-book cleanup pass (dedupe, validation flags, staff review queue) so repeat-order works year one; dry-run mode against a disposable DB.
- **Smoke:** dry-run reports counts + rejects without writing; committed import makes a migrated customer's history repeatable through the P13 review page; duplicate customers merged per dedupe rules.

### P17 — Scale hardening, test ops, help, launch readiness

- **IDs:** G-024, R-014, R-101, R-102, R-103, R-129, R-185; final sweep of R-133/R-140 gates.
- **Deliverables:** load pass at scale baseline (seed 1k orders / 5k packages; verify order list, package board, nightly print batch, route builder, 10 concurrent staff mutations without deadlock — indexes/query fixes as found); test-environment console (seed/reset/wipe, test-only destructive routes) + test-mode banner + test/live env switch; staff help center + guided tours; all 5 Vercel crons registered with secret auth; full end-to-end dress rehearsal: web order → pay → package → print batch → ship one/deliver one/pickup one → reroute one → reports reconcile.
- **Smoke:** dress rehearsal completes with zero manual DB edits; nightly batch over 5k packages finishes acceptably; wipe + reseed restores a clean test season; every inventory ID is checked off in the phase-plan coverage ledger.

---

## Coverage map

| Phase | UR | G | R |
|---|---|---|---|
| P1 | — | (G-024 base) | 131, 133, 137, 138, 140–142, 161, 164, 187–192 |
| P2 | 012 | 016 | 010, 098–100, 104, 107–120, 130, 135, 136 |
| P3 | 001/008/016 schema | 003/009 base | 044–047, 144–160, 162, 163 |
| P4 | 008 (browse/gate) | 022 | 001–009, 011–013, 015–018, 065–067, 128, 180 |
| P5 | 006, 014 | 018, 019 | 019–031, 038–040, 042, 043, 114 |
| P6 | 009, 011, 013 (capture) | 007, 014, 015, 020 | 023, 032–037, 121–127, 132, 166–170 |
| P7 | 001, 005, 013 (PDF) | 001–004, 021 | 056, 072, 073 |
| P8 | 003 | 006 | 055, 081, 173–177, 183, 184 |
| P9 | 002, 004, 015 | 005, 023, 025, 027, 030 | 074–078, 116, 179 |
| P10 | 009 (bulk), 010 | 017, 026 | 079, 080, 182 |
| P11 | 006/011 (POS) | 028 | 049–054, 059–064, 094–096, 105, 106, 143 |
| P12 | 016 | 008–010 | 068–071, 139 |
| P13 | 007, 008 | 011–013 | 041, 048, 057, 058, 097 |
| P14 | — | 021 | 082–090, 171, 172, 178, 181 |
| P15 | 003 (report) | — | 091–093 |
| P16 | 014 (cleanup) | 029 | 165, 186 |
| P17 | — | 024 | 014, 101–103, 129, 185 |

All 16 UR, 30 G, and 192 R rows are assigned; overridden R behaviors (pass-through rates, group-only fulfillment, logged-in driver, save-failure-only void) are delivered in their UR replacement form (P8, P7, P9, P9).

---

## 4. Risks / open questions

1. **Package ↔ inventory ↔ payment coupling** (P3) is the keystone; a wrong grouping key ripples through printing, shipping, and reroute. Mitigation: grouping engine unit-tested before any UI (P3 gate).
2. **Margin capture legality/rounding** (UR-003): quoting two carriers with different service levels — which services count as comparable? Open question for the org; plan assumes cheapest ground-equivalent on each carrier.
3. **Shippo test accounts**: negotiated FedEx/UPS rates aren't reproducible in test mode; margin math validated with mocked rate tables plus one live smoke.
4. **SMS provider** is the only stack item the inventory doesn't force; assumed Twilio-class single provider. Confirm before P10.
5. **Magic-link grace period** (resolution 4 "optional short grace"): default proposed 2 hours after route completion; manager-configurable. Needs user confirmation.
6. **Nightly print batch at 5k packages**: PDF generation time is the main scale risk; P17 load pass includes it explicitly, chunked generation as fallback.
7. **Legacy export quality** (G-029): "messy" is unquantified; P16 includes a staff review queue rather than promising fully automatic cleanup.
8. **Repeat-order year one depends on P16** finishing before season open — migration is deliberately late (needs stable schema) but must precede launch; watch this dependency.
9. **Seasonal auto-flip** (UR-008 "optional scheduled") — timezone for the flip assumed org-local; confirm.
