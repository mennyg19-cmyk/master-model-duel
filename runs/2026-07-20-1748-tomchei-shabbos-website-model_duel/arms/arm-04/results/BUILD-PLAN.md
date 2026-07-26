# Build plan — arm-04 (Test 2, late join)

**Arm:** `arm-04` · **Ports:** web `3104`, db `4104`
**Single source of truth:** `shared/USER-RESOLVED-INVENTORY.md` (frozen), with carry-forward rows read from `shared/RECONCILED-INVENTORY.md` (192 rows) because the user-resolved brief points at it.
**Greenfield.** No reference app, no source codebase read, no other arm's plan read. `shared/MERGED-BUILD-PLAN.md` exists and is frozen for Tests 3–4; this plan is not merged into it (late join).

Every requirement below traces to an inventory ID: `UR-001..UR-016` (rebuild scope), `G-001..G-030` (grill union), `R-001..R-192` (codebase carry-forward). Nothing outside those lists is planned. Coverage table is in the appendix.

---

## 1. Goals / non-goals

### Goals

1. **Physical packages are the unit of work.** Orders are what customers buy; packages (boxes) are what staff group, split, print, route, ship, and hand over (UR-001, G-003, G-004).
2. **Staff can reroute without touching money.** Shipping ↔ volunteer delivery switches keep the customer's paid charge; the org keeps any savings (UR-002, G-005).
3. **Shipping margin is captured on purpose.** Quote FedEx/UPS (USPS where applicable), charge the higher rate, ship the cheaper carrier, reconcile the spread internally (UR-003, G-006).
4. **Crunch-week print run works on paper.** A nightly batch produces one PDF per filing group so several people print and file in parallel, and printing never implies shipped (UR-005, G-001, G-002).
5. **Ordering is cart-first and identical on web and POS**, with each line assigned to an existing on-order recipient, an address-book recipient, or a new one (UR-006, G-018, G-019).
6. **Repeat last year in three clicks.** Prior-year order copies to a draft; one review page confirms both item replacements and recipients (UR-007, G-011, G-012, G-013).
7. **Seasons gate everything.** Per-year catalog, manager-controlled open/closed, off-season archive browsing of all years with no checkout (UR-008, G-022).
8. **Delivery rules match how the org charges.** Bulk = one fee per destination, staff-scheduled; per-package = fee per recipient, hard ZIP block, manager-set Purim-week days at checkout, day-of notification (UR-009, G-014, G-015, G-017, G-027).
9. **Pickup is inventory-gated** with ready notification, door list, picked-up stamp, and an unclaimed report (UR-010, G-026).
10. **Payments stay boring.** Web = hosted Stripe Checkout with immediate capture; POS = check/cash with staff audit (UR-011, G-007, G-028).
11. **Three staff roles, individual logins, per-person permission toggles.** Customers are not staff (UR-012, G-016, resolution 8a).
12. **Greeting cards** default per order with per-recipient overrides, remembered per recipient, printed as their own card-stock PDF per filing group (UR-013, G-020, G-021).
13. **One address book per customer**, editable by staff with an audit trail, seeded by a cleaned migration of messy legacy data (UR-014, G-019, G-029).
14. **Drivers work from a phone with no account:** unguessable per-route link, only that route's stops, expires at route completion, optional 4-digit PIN, audit on every Delivered tap; Mapbox for the office map, Google Maps deep links for turn-by-turn; printed sheet as fallback (UR-015, G-025, G-030, resolutions 4 and 5).
15. **Production counts finished packages at launch**, with BOM and assembly-batch tables in the schema and the ingredient UI hidden until a manager enables it (UR-016, G-008, G-009, G-010, resolution 7).
16. **Carry forward the existing product surface** — storefront and marketing, account self-serve, admin catalog/media, reports and exports, email subscribe and campaigns, checkout validation, ops hub, security patterns, integration scaffolding — adapted to the overrides above (R-001..R-192).
17. **Built for crunch scale from day one:** 1,000+ orders, 5,000+ packages, 10+ concurrent staff, batch tools, no single-user assumptions (G-024).

### Non-goals (explicit, from the inventory's out-of-scope list)

- Embedded Stripe Elements / on-site card forms. Hosted redirect only; `@stripe/stripe-js` and `@stripe/react-stripe-js` are not installed (resolution 8b, R-166 conflict closed).
- Ingredient/BOM **UI** at launch. Schema only, behind a manager toggle (resolution 7).
- Customer-chosen delivery appointment slots, bulk or per-package. Rejected in grill.
- Manager override for out-of-area per-package delivery. The ZIP block is hard.
- Automatic map reroute without manager confirmation.
- Embedded Google Maps API (cost). Deep links only.
- Native mobile apps. Driver UX is mobile web plus printed fallback.
- Customers stored in the staff roles table (resolution 8a closes the R-109 conflict).
- Pass-through shipping rates (replaced by UR-003), order/fulfillment-group-only fulfillment (replaced by UR-001), logged-in messenger driver model (replaced by UR-015), label void only on save failure (replaced by UR-004).

---

## 2. Stack proposal

The inventory forces most of this. "Forced" means an inventory row names the vendor or technology; "chosen" means the inventory is silent and I picked the option that adds nothing new.

| Concern | Choice | Why |
|---|---|---|
| App framework | Next.js App Router + TypeScript, server actions | **Inventory-implied.** Carry-forward rows are App Router route groups, server actions, `middleware`, and `vercel.json` cron (R-104, R-107, R-185). Rebuilding on the same shape keeps 192 rows portable. |
| Database | PostgreSQL 16 on port `4104` | **Forced** — R-137 normalized relational Postgres schema, R-138 DB enums, R-139 CHECK constraints. |
| ORM / migrations | Prisma, ordered migrations, CI schema-change guard, disposable migration harness | **Forced** — R-137, R-140, R-141. |
| Identity | Clerk + middleware; sign-in / sign-up pages | **Forced** — R-107, R-108. Staff and customers are separate concepts on top of it (resolution 8a). |
| Payments | Stripe hosted Checkout, webhooks, refunds, reconciliation | **Forced** — resolution 8b, R-166..R-170, R-093, R-125. |
| Shipping | Shippo, org's FedEx + UPS business accounts connected for negotiated rates | **Forced** — resolution 6, R-173..R-177. |
| Maps | Mapbox geocoding + admin route map; `https://maps.google.com/?daddr=` deep links for drivers | **Forced** — resolution 5, R-179. |
| Email | Resend behind a transactional outbox with a retrying sweeper and idempotency keys | **Forced** — R-171, R-088, R-178. |
| SMS | Provider-agnostic `NotificationChannel` interface; email path live, SMS adapter config-gated | **Open.** The inventory requires SMS (bulk-delivery notify, day-of notify) but names no vendor. I will not invent one — see Risk 3. |
| File storage | Vercel Blob for media | **Forced** — R-180, R-067. |
| UI | shadcn-style kit + the custom primitives list + design tokens + brand constants | **Forced** — R-188, R-189, R-190. One styling approach, one component source. |
| Print / PDF | Server-rendered print routes + print CSS, driven by the browser's print-to-PDF; one route per filing group | **Chosen.** The inventory's only print evidence is HTML print pages plus a print button (R-056, R-076). No PDF library is named, so no PDF dependency is added. See Risk 5. |
| Validation | Zod at every trust boundary; startup env schema validation | **Forced** — R-131, R-122. |
| Tests | Vitest for unit/permission tests | **Inventory-implied** — R-135 ships permission unit tests. One test framework only. |
| Background jobs | Vercel Cron with bearer-secret auth + a job run log | **Forced** — R-185, R-124, R-163. |
| Money | Integer minor units through a single money helper; never floats | **Forced** — R-164 money helper; margin capture (UR-003) makes rounding errors visible on a ledger. |

One pattern per concern, fixed in Phase 0 and never forked: one error shape (`Result` with production masking, R-136), one data-fetching pattern (server components + server actions), one styling approach, one date library, one HTTP surface for public JSON (`withPublicGuard`, R-122).

---

## 3. Phases

Each phase ends at a gate: every deliverable built, every smoke check executed against the running app on port `3104` with seeded data, before the next phase starts. Phases are ordered so that each one is independently smokeable.

### P0 — Foundation and platform skeleton

**IDs covered:** R-122, R-124, R-131, R-132, R-133, R-136, R-137, R-138, R-139, R-140, R-141, R-142, R-163, R-164, R-185, R-187, R-188, R-189, R-190, R-191

**Deliverables**

- Next.js + TypeScript app on port `3104`; Postgres on `4104`; `.env.example` generated from the env schema, every secret a placeholder.
- Startup env/secret validation that fails loudly with the missing key name (R-131).
- Prisma baseline migration + repeatable seed + disposable migration verification script + CI guard that a schema change ships a migration (R-137..R-142).
- Helper libraries: money, phone/email normalize, ids, season, dates, `Result` with production error masking (R-164, R-136).
- Design tokens, global styles, brand constants, shadcn-style kit, the custom primitives (confirm dialog, empty state, FAB, info hint, page header, pill input, price tag, smart select, callout), global error page (R-188..R-191).
- Public JSON guard: same-origin check, IP rate limit, Zod body parse; bounded and redacted client-error ingestion (R-122, R-132).
- Cron scaffolding: bearer-secret verification, job run log table, `vercel.json` schedule stubs, `/api/health` returning DB + env status (R-124, R-163, R-185, R-187).
- CI security guardrails workflow (R-133).

**Smoke checks**

1. `/api/health` returns 200 with `db: ok`; with one env var removed, boot fails naming that var.
2. Migration harness creates and drops a throwaway DB and exits 0; CI guard fails a schema edit with no migration.
3. A UI kit gallery page renders every primitive; the global error page shows a redacted message in production mode.
4. Unauthenticated cross-origin POST to a guarded endpoint returns 403; 100 rapid requests get rate-limited.

### P1 — Identity, roles, permissions, audit

**IDs covered:** UR-012, G-016, R-010, R-051, R-098, R-099, R-100, R-104, R-105, R-106, R-107, R-108, R-109, R-110, R-111, R-112, R-113, R-115, R-117, R-118, R-119, R-120, R-129, R-130, R-134, R-135

**Deliverables**

- Clerk integration + middleware + sign-in/sign-up (R-107, R-108).
- Staff model with three roles — Manager, Staff, Driver — individual logins, per-person permission grants and denies, plus a `canDrive` carve-out for driver-route access (UR-012, R-109, R-110, R-118). Customers live in their own table with no staff role (resolution 8a).
- Server-side `requirePermission` gate as the only authorization path; admin and driver application gates; "must be staff" hard guard (R-111, R-115, R-117).
- Staff invitation identity linking, confirmation and revocation gate, self-target mutation blocks (R-112, R-113, R-119).
- Staff account management UI with the permission-override editor (R-098).
- Impersonation with a persistent banner (R-099); administrative activity log with a filterable table and session login stamp (R-100, R-120).
- First-run setup page + API that only works while the staff table is empty, then locks out (R-010, R-130).
- Admin shell: permission-gated sidebar, mobile nav, shared list controls (search, pagination, page size, sort, remembered list URL, status badges), chrome links (R-104, R-105, R-106).
- Staff-only API route guards; permission unit tests (R-134, R-135).
- Test-only destructive endpoints (reset/wipe/seed) blocked outside test mode (R-129).

**Smoke checks**

1. Empty DB: `/setup` creates the first Manager; a second call returns 403.
2. A Staff user cannot see Settings in the sidebar and gets 403 hitting the route directly; a Manager grant flips both immediately.
3. A Driver user cannot open any `/admin` page but passes the driver gate.
4. Revoking a staff member mid-session ends their next admin request.
5. Impersonation shows the banner and writes an audit row; every permission change appears in the activity log with actor and timestamp.
6. Permission unit tests pass.

### P2 — Seasons, catalog, media, settings, stock ledger

**IDs covered:** UR-008, G-008, G-013, R-048, R-065, R-066, R-067, R-068, R-070, R-071, R-094, R-095, R-096, R-097, R-128, R-146, R-147, R-148, R-156, R-157, R-158, R-161, R-180

**Deliverables**

- Season model gating catalog per year; manager Open/Closed switch; optional scheduled auto-flip with the schedule stored as a setting (UR-008, R-146, R-094).
- Product catalog CRUD with dimensions, inventory flags, kinds, options with price adjustments, season assignment (R-065, R-147, R-148); add-on catalog with restricted add-ons (R-066).
- Cross-season replacement mappings per catalog item, admin editor + chain resolution — authored here, consumed by repeat orders in P13 (G-013, R-048).
- Media library on Vercel Blob with photo assignment, needs-photos panel, MIME/size-validated uploads (R-067, R-128, R-180).
- Unified versioned inventory table covering products and add-ons; finished-package stock ledger with reserve / allocate / release; adjustments, write-offs, shortfall view; inventory overview dashboard (G-008, R-068, R-070, R-071, R-158).
- Settings hub: Orders tab (store status, package types, pickup locations, follow-up), Shipping tab (rates, rules, delivery ZIPs), Email tab, Developer tab; typed key-value settings registry seeded with defaults; new-season setup wizard (R-094..R-097, R-156, R-157, R-161).

**Smoke checks**

1. Create season 2027, add a product with two priced options, publish; the 2026 product no longer appears in the current catalog.
2. Toggle store Closed; the setting reads Closed from a second browser session.
3. Upload a 12 MB `.exe` to media → rejected with a reason; a 1 MB JPEG uploads and attaches to a product.
4. Map product A (2026) → product B (2027); the chain resolves A → B in a direct query.
5. Adjust stock +50, reserve 10, release 5 → ledger shows 50 / 5 reserved / 45 available and every movement has an actor.
6. Write off 3 with a reason; the shortfall view lists an oversold item.

### P3 — Storefront, marketing pages, email foundation

**IDs covered:** G-022, R-001, R-002, R-003, R-004, R-005, R-006, R-007, R-008, R-009, R-011, R-012, R-013, R-015, R-016, R-017, R-018, R-088, R-123, R-171, R-172, R-178, R-181, R-192

**Deliverables**

- Mission-led homepage: impact-stats bar, How It Works, mission, testimonials, final CTA, store-open-aware CTAs (R-001, R-002, R-007, R-008).
- Storefront shell: sticky header, desktop nav, mobile menu, user menu, footer with email signup, storewide closed banner (R-011, R-012, R-013).
- Current-season package grid with category filters, price sort, sold-out handling, loading state; package detail with option pricing; quick-view dialog (R-003, R-004, R-006, R-015, R-016, R-017).
- Off-season archive: browse every past season's catalog with no add-to-cart anywhere (G-022, R-005).
- Newsletter subscribe + preference management + HMAC-signed, timing-safe tokenized unsubscribe with three preference states (R-009, R-018, R-123).
- Email foundation: Resend client isolated behind one dispatcher, transactional outbox table + retrying sweeper cron with secret auth, idempotency keys, test-mode capture instead of send, email log purge cron (R-088, R-171, R-172, R-178, R-181).
- Marketing imagery assets (R-192).

**Smoke checks**

1. Homepage renders on `3104`; with the store Closed the CTA changes and the banner appears on every storefront route.
2. Filter to one category, sort by price ascending, confirm a sold-out card is visibly disabled.
3. Archive shows 2025 and 2026 catalogs with no checkout affordance; a direct order URL for an archived season is refused.
4. Subscribe with an email → row created; unsubscribe link with a tampered token is rejected, the valid one applies the preference.
5. Kill the mail provider (bad key): outbox retains the message, the sweeper retries, the send is not duplicated when it succeeds.

### P4 — Customers, address book, geocoding

**IDs covered:** UR-014, G-019, R-024, R-025, R-029, R-038, R-039, R-040, R-042, R-043, R-062, R-064, R-114, R-144, R-145, R-162, R-179

**Deliverables**

- Customer records with normalized phone/email and dedupe on both; customer identity linking to the auth user; ownership-enforced profile updates (R-042, R-114, R-144).
- **One address book per customer**, shared by web and POS, with geocoding fields on every entry (UR-014, R-043, R-145).
- Staff editing of address-book entries with an audit entry per change (G-019, R-064).
- Account area: dashboard with auth-gated nav, order history + detail, continue/pay/cancel a draft, profile form, saved addresses view (R-038, R-039, R-040, R-042, R-043).
- Address autocomplete + server-side validation; saved-address reuse and edit-while-ordering dialogs (R-024, R-025, R-029).
- Admin customer directory: search, add, find-or-create, detail with history (R-062, R-064).
- Mapbox geocoding behind a cache with separate success/failure TTLs (R-162, R-179).

**Smoke checks**

1. Create a customer with `(555) 123-4567`; a second attempt with `555-123-4567` is flagged as a duplicate.
2. Add three addresses; all three appear in both the account view and the POS picker for that customer.
3. Staff edits an address → the audit log names the staff member, the field, and both values.
4. A customer cannot load another customer's order detail (403, not 404-leak).
5. Geocode an address twice → second call is a cache hit; a bad address caches the failure with the short TTL.

### P5 — Cart-first order entry (web + POS)

**IDs covered:** UR-006, G-018, R-019, R-020, R-021, R-022, R-023, R-026, R-027, R-028, R-030, R-031, R-044, R-045, R-046, R-047, R-059, R-060, R-121, R-149, R-150, R-151

**Deliverables**

- One builder shell used by the storefront and POS: product panel with cards and in-builder quick view, desktop order sidebar, mobile cart FAB (UR-006, R-019, R-026, R-030, R-031).
- Cart with quantities; each line assigned to a recipient by the three-way picker — someone already on this order, someone from the address book, or a brand-new recipient that saves back to the address book (UR-006, G-018, R-027, R-028).
- Live-stock-aware selection reading the P2 ledger; product options and restricted add-ons (R-020, R-021).
- Draft save/resume: autosave, guest draft clearing on success, draft reference numbers and wire format, discard (R-022, R-046, R-047).
- Guest checkout access tokens with draft-ownership and anti-enumeration gates (R-023, R-121).
- Order tree — Order → OrderLine → add-ons — with price snapshots per line and sequential per-season order numbers; order status state machine with explicit transitions and finalization draft → placed (R-044, R-045, R-149, R-150, R-151).
- Staff POS builder with customer lookup, preselection, and find-or-create (R-059, R-060).

**Smoke checks**

1. Add three products, quantity 2 each, split across two address-book recipients and one new recipient; the new recipient is in the address book afterwards.
2. Reload mid-build → the draft restores with identical lines and assignments.
3. Change a product price in admin, then reopen the draft: the snapshot holds and the checkout conflict surfaces later (P7).
4. Guess another draft's ID as a guest → refused; the emailed token opens only its own draft.
5. POS: look up a customer by phone, build the same order shape with the same component, finalize to a placed order with the next sequential number.
6. An invalid state transition (placed → draft) is rejected by the state machine.

### P6 — Fulfillment methods, delivery rules, shipping rate margin

**IDs covered:** UR-003, UR-009, G-006, G-014, G-015, G-027 (day selection), R-032, R-081, R-154, R-155, R-173, R-174, R-177, R-183, R-184

**Deliverables**

- Data-driven fulfillment methods: ship, volunteer delivery (bulk and per-package), pickup (R-154).
- Rate resolution + rule engine: per-method availability, ZIP eligibility, weight/box rules (R-032).
- Shippo wrapper — rate, buy, void, track, validate address — with the org's FedEx + UPS accounts for negotiated rates, USPS where applicable; typed optional-provider handling so a missing key degrades to a manual quote instead of crashing; UPS direct credentials declared but unused (G-006, R-173, R-174, R-177, R-183, R-184).
- **Margin capture (UR-003):** store every quote; charge the customer the higher carrier rate; keep the cheaper carrier as the ship-on choice; write a per-package margin row (`charged`, `expected_cost`, `spread`) for internal reconciliation. Quotes expire and are selectable (R-155).
- Shipment planning + bin packing into configured package types to produce box counts and billable weight (R-081).
- **Delivery rules (UR-009):** bulk = one fee per destination, no customer date choice, staff-scheduled later; per-package = fee per recipient, hard ZIP block with no manager override, and manager-configured Purim-week delivery days offered at checkout (G-014, G-015, G-027).

**Smoke checks**

1. Quote a 5 lb box to an out-of-state ZIP: two carrier rates returned, the customer-facing price equals the higher, the ship-on carrier is the cheaper, and the margin row shows the spread.
2. Same address with the Shippo key removed: manual quote path, no crash, warning surfaced to staff.
3. Per-package delivery to a ZIP outside the list is blocked at selection with no override control anywhere in the UI.
4. Bulk delivery to one destination with four recipients charges exactly one destination fee; per-package charges four recipient fees.
5. Manager sets delivery days Tue/Wed; checkout offers only those two.
6. Twelve small items pack into the expected box count.

### P7 — Checkout, payments, admin order desk

**IDs covered:** UR-011, G-007, G-028, R-033, R-034, R-035, R-036, R-037, R-052, R-053, R-054, R-061, R-087, R-093, R-125, R-126, R-127, R-152, R-159, R-160, R-166, R-167, R-168, R-169, R-170

**Deliverables**

- Checkout: recipient and donation summary, per-recipient delivery selection, bulk option, live shipping rates from P6, guest email capture, price/stock conflict UI, stock + price re-validation server-side before payment (R-034, R-037).
- **Hosted Stripe Checkout redirect with immediate capture** — no card fields on-site, no Stripe client packages (UR-011, G-007, R-166, R-170); PaymentIntent modeling, webhook authenticity + idempotency, charged-amount and fulfillment safety checks with automatic refunds for stale or failed sessions (R-125, R-126, R-159, R-167, R-169).
- Payments table covering stripe / cash / check / comp with posted and voided states; cached derived payment status on the order; payment recalculation when an order changes (R-036, R-152, R-160).
- **POS check/cash with staff audit** and a server-enforced offline payment policy (G-028, R-033, R-061, R-127).
- Refunds including the Stripe refund path and refund sync from webhooks (R-054, R-168).
- Checkout success page (R-035); order confirmation, payment-link, and refund emails through the P3 outbox (R-087).
- Admin order desk: searchable, filterable order list and full order detail with money actions (R-052, R-053).
- Stripe reconciliation page + cron matching Stripe charges to local payments (R-093).

**Smoke checks**

1. Web order → Stripe test redirect → success page, order placed, funds captured immediately, confirmation email in the outbox; `@stripe/stripe-js` is absent from `package.json`.
2. Replay the same webhook 3 times → one payment row.
3. Tamper the amount in the session and pay → mismatch detected and auto-refunded, order not fulfilled.
4. POS: record a $50 check → payment posted with the staff member's name; attempting an offline payment without the permission returns 403.
5. Refund $20 in admin → Stripe refund created, local balance and payment status updated.
6. Reconciliation run flags one deliberately orphaned Stripe charge.

### P8 — Packages and the nightly print pipeline

**IDs covered:** UR-001, UR-005, UR-013, G-001, G-002, G-003, G-004, G-020, G-021, R-055, R-056, R-076, R-153, R-175, R-176

**Deliverables**

- **Package entity (UR-001):** physical boxes linked to the customer order, created by default grouping on recipient + address + fulfillment method + greeting; staff split one package into several and re-merge; optional per-package stage New → Printed → Packed → Sent/Picked Up. Fulfillment groups carry destination snapshots (R-153).
- **Print ≠ shipped (G-001, G-002):** printing sets Printed and never advances shipping state; a Printed package is still fully reroutable in P9.
- Per-package printing and status actions; printable packing slips per package and per order (G-004, R-056).
- **Nightly print batch (UR-005):** a batch job groups packages into filing groups and produces a separate print route/PDF per group so several people print and file in parallel; reprint by group or by single order; batch records what was printed, when, and by whom.
- **Greeting cards (UR-013, G-020, G-021):** order-level default greeting with per-recipient override, last greeting remembered per recipient and pre-filled next time, and a separate card-stock print set per filing group.
- Carrier label creation and voiding per package, label failure compensation, tracking refresh (R-055, R-175, R-176).

**Smoke checks**

1. An order with two items to the same address and one to another address auto-creates two packages; a different greeting on one item creates a third.
2. Split a 2-item package into two → both keep the order link, statuses are independent, ledger counts unchanged.
3. Print a package → status Printed, no shipping state change, tracking still empty; the package is still eligible for a reroute.
4. Run the nightly batch on 200 seeded packages → one PDF-able route per filing group, each group printable independently; reprint one group without touching the others.
5. Card set for group 3 contains only group 3's recipients with the correct override text; a recipient's greeting from last run is pre-filled on the next order.
6. Buy a label, then void it → Shippo shows voided and the package returns to pre-label state; simulate a buy failure and confirm no orphaned label row.

### P9 — Routes, drivers, map reroute, method switch

**IDs covered:** UR-002, UR-004, UR-015, G-005, G-017, G-023, G-025, G-027 (day-of notify), G-030, R-072, R-073, R-074, R-075, R-077, R-078, R-116

**Deliverables**

- Fulfillment channel dashboard with bulk status actions plus production and savings summaries (R-072, R-073).
- Mapbox route builder over geocoded stops with coordinate refresh; route administration: list, detail, driver reassignment, printed route sheet (R-074, R-075).
- **Map reroute (UR-004, G-023):** the map shows delivery stops plus unshipped **shipping** packages within about 0.5 mile or the same street cluster; the manager always confirms — never automatic; on confirm, void the Shippo label if the package was printed-but-not-shipped, add the stop to the route, and update the affected print batch.
- **Method switch with charge preservation (UR-002, G-005):** switching shipping ↔ volunteer delivery in either direction leaves the customer's paid delivery/shipping charge untouched, records who and when, and posts the retained amount to the margin ledger. No refund and no additional collection, ever.
- **Driver access (UR-015, G-025):** unguessable per-route magic link; the page shows only that route's stops; the link expires when the route is marked complete with a short configurable grace; optional 4-digit PIN a manager can text; every Delivered tap writes an audit row with timestamp and route-link id. Route ownership scoping is enforced server-side, and the printed sheet from R-075 is the fallback (R-078, R-116).
- Driver stop cards with route start / delivery completion and a **Google Maps deep link per stop**; Mapbox stays office-side only (G-030, R-077, R-078).
- **Staff-scheduled bulk delivery (G-017):** staff set the date/window, the customer is notified by email and SMS; **day-of notification on route start** for per-package delivery (G-027).

**Smoke checks**

1. Build a route from 12 stops on the map, save, print the sheet, reassign the driver — the printed sheet matches the saved stop order.
2. A printed shipping package 0.3 mile from a stop appears as a suggestion; a 3-mile one does not; nothing moves until the manager clicks Confirm.
3. Confirm the reroute → Shippo label voided, stop added, print batch updated, and the customer's paid shipping charge is byte-identical before and after with an audit row naming the actor.
4. Open the magic link on a phone in a private window: only that route's stops; another route's link shows nothing of this one; tapping the Google Maps link opens turn-by-turn with the right address.
5. Mark the route complete → the link 410s afterwards (past grace); with a PIN set, a wrong PIN blocks access and a right one allows it; each Delivered tap has an audit row.
6. Schedule a bulk delivery window → email queued and the SMS channel invoked; start a per-package route → day-of notifications queued for those recipients only.

### P10 — Production batches, BOM (hidden), pickup

**IDs covered:** UR-010, UR-016, G-009, G-010, G-026, R-069, R-182

**Deliverables**

- **Finished-package production (UR-016, G-010):** assembly batches consume supplies and increase finished-package stock; batch planning UI, daily batch dialog, production history (R-069).
- **BOM in schema, UI hidden (G-009, resolution 7):** recipe/ingredient and ingredient-stock tables exist and are exercised by tests; every ingredient screen is behind a manager-flipped setting that is Off at launch. Volunteers never see it on day one.
- **Pickup (UR-010, G-026):** pickup is offered only when that order's inventory is actually available; ready-for-pickup notification; door list for the pickup location; picked-up stamp with who and when; unclaimed report; pickup-expiry cron (R-182).

**Smoke checks**

1. Run an assembly batch of 40 → finished stock +40, supplies decremented, history row with the actor.
2. With the ingredient setting Off, no ingredient nav item exists and the direct URL 404/403s; flip it On as a Manager and the screens appear with data already in the tables.
3. An order whose items are short cannot select pickup; after a batch covers it, pickup becomes selectable and the ready notification queues.
4. Door list shows today's pickups; stamping one records staff and time and removes it from the list.
5. Age a pickup past the window → it appears on the unclaimed report and the expiry cron logs one run.

### P11 — Email hub, notifications, follow-up center

**IDs covered:** R-079, R-080, R-082, R-083, R-084, R-085, R-086, R-089, R-090

**Deliverables**

- Email hub with five tabs over the P3 foundation (R-082, R-089).
- Campaign builder with content blocks, draft/sent lifecycle, and send (R-083).
- Subscriber and mailing-list management (R-084); templates + branding with a render helper (R-085); triggered/transactional email registry with per-key overrides and idempotency (R-086); test sender from Settings (R-090).
- Follow-up call center: list + filters for unpaid orders, undelivered packages, unclaimed pickups (R-079).
- Automated payment-reminder and pickup follow-up crons (R-080).

**Smoke checks**

1. Build a 3-block campaign, send to a 5-subscriber list in test mode → 5 captured messages, zero real sends, campaign marked sent.
2. Override the order-confirmation template text → the next order's email uses the override; re-fire the same trigger → no duplicate.
3. Follow-up list shows a seeded unpaid order; filters narrow to it; the payment-reminder cron queues exactly one reminder per unpaid order.
4. Test sender delivers to a staff address with the current branding.

### P12 — Legacy data migration

**IDs covered:** G-029, UR-014 (migration clause), R-063, R-143, R-165, R-186

**Deliverables**

- Documented legacy → new entity map maintained as the migration contract (R-165).
- Staged, auditable import pipeline: parse → stage → validate → report → atomic commit, with a rejected-rows report and rollback (R-143).
- CSV import for customers and products from the admin UI (R-063).
- Legacy export importers for the messy historical data: customers, products, historical orders, and order-number repair, all idempotent and re-runnable (G-029, R-186).
- **Address-book cleanup before year-one repeat orders (UR-014):** dedupe by normalized phone/email, split combined name/address fields, geocode-verify, and produce a manual-review queue for what cannot be resolved automatically.

**Smoke checks**

1. Import a deliberately messy 500-row customer export: exact counts of created / merged / rejected, with reasons, and nothing partially written on failure.
2. Re-run the same import → zero new rows.
3. Historical orders import with duplicate order numbers → the repair step produces unique numbers and logs each change.
4. A row with an unparseable address lands in the review queue instead of creating a bad address-book entry.
5. Cleanup pass on the migrated book: duplicates merged, addresses geocoded, review queue non-empty and workable.

### P13 — Repeat orders

**IDs covered:** UR-007, G-011, G-012, R-041, R-057, R-058

**Deliverables**

- **Repeat order (UR-007, G-011):** copy a prior-year order into a draft, then one middle review page that confirms **both** item replacements **and** recipients before the draft is finalized.
- Replacement resolution using the P2 mappings with price-smart defaults; **unmapped items must be explicitly picked or removed** — never silently dropped (G-012, R-041).
- Recipient confirmation on the same page: keep, edit, or drop each recipient, sourced from the cleaned address book.
- Staff single-order repeat and bulk repeat of a customer's history (R-057, R-058).

**Smoke checks**

1. Repeat a 2026 order with 4 lines where 3 map and 1 does not: the review page shows the 3 mapped with prices and blocks continue until the 4th is chosen or removed.
2. Price-smart default picks the nearest-priced current item, and the difference is visible before confirming.
3. Drop one recipient and edit another's address on the review page → the resulting draft reflects both.
4. Bulk repeat over 20 historical orders creates 20 drafts, each with its own review state, and never auto-places an order.

### P14 — Reports, exports, staff tooling, test mode

**IDs covered:** R-014, R-049, R-050, R-091, R-092, R-101, R-102, R-103

**Deliverables**

- Permission-aware admin dashboard with KPIs and recent orders (R-049); daily "Today" work queue (R-050).
- Multi-season performance reports with drill-downs (R-091).
- CSV export center with audit history: deliveries, year-end, year metrics, item sales, lapsed customers (R-092).
- Staff help center with articles and guided tours (R-102).
- Test-environment operations console — seed, reset, wipe, clear emails — with the storefront test-mode banner and the test/live environment switch (R-014, R-101, R-103).

**Smoke checks**

1. Dashboard KPIs match hand-counted seeded totals; a Staff user sees only their permitted tiles.
2. "Today" lists exactly today's routes, pickups, and print batches.
3. Each of the five exports downloads with correct headers and row counts, and each writes an export-audit row.
4. Seed a test season, reset it, confirm live data untouched; the test banner shows in test mode only and the env switch flips context.
5. A guided tour completes on the admin shell.

### P15 — Scale hardening, security pass, launch readiness

**IDs covered:** G-024 (plus load re-verification of R-071, R-105, R-122, R-131, R-133, R-136, and the P8/P9 batch tools)

**Deliverables**

- Load seed: 1,000+ orders, 5,000+ packages, 10 staff sessions (G-024).
- Concurrency safety on the paths where staff collide during crunch: stock reserve/allocate, package split/merge, route assignment, print-batch generation, and the method switch — row-level locking or optimistic version checks with a clear "someone else just changed this" message rather than a silent overwrite.
- Indexes and pagination review on every admin list; batch tools (bulk status, bulk print, bulk reroute confirm) sized for thousands of rows.
- Full permission matrix re-test, secret hygiene check, rate-limit and error-masking verification under load.
- Runbook: nightly print batch, crunch-week route flow, driver link handling, migration re-run, rollback.

**Smoke checks**

1. Nightly batch over 5,000 packages completes inside the operational window; the timing is recorded.
2. Two staff sessions split the same package at once → one wins, the other gets a conflict message; stock totals stay correct.
3. Ten concurrent sessions reserving the last 5 units oversell nothing.
4. Admin order list with 1,000 orders paginates and searches without a full scan.
5. Full permission matrix test suite green; no secret in the repo or in logs.

---

## 4. Risks and open questions

1. **Margin capture needs an accounting owner (UR-003, resolution 2).** Charging the higher carrier rate and shipping the cheaper one is a deliberate revenue decision. The plan stores the spread on a per-package ledger so it is auditable, but the inventory does not say how it is reported, whether the customer-facing wording must change, or how a donation-receipt figure treats it. Needs a decision before P6 ships; the ledger is designed so the answer can be applied retroactively.
2. **"Filing group" is not defined anywhere in the inventory (UR-005).** Everything else about the nightly batch is specified — separate PDF per group, parallel printing, reprint per group — but not the grouping key (route? ZIP? alphabetical? volunteer team?). P8 will make the grouping key a manager-configurable setting rather than guess, and the smoke check uses the configured value.
3. **SMS has a requirement but no vendor.** The user-resolved brief requires email + SMS for bulk-delivery notification and day-of notification, and the manager texting a driver PIN. No carry-forward row names an SMS provider (R-171 is email-only). I will not invent one: P9/P11 build one notification interface with the email path live and an SMS adapter that fails loudly if unconfigured. Vendor choice needs an answer before launch.
4. **G-021 is used for two different things in the frozen brief.** The minor-items table calls G-021 "bulk-delivery notification channel," while the feature checklist calls G-021 "greeting cards: order default + overrides; separate card PDF." I covered both (cards in P8, bulk notification in P9 with G-017) rather than pick, but the ID collision should be corrected in the inventory before grading.
5. **PDF generation approach (UR-005, UR-013).** The inventory's only print evidence is HTML print views plus a print button, so P8 uses print routes and print CSS with no new dependency. If "separate PDF per filing group" must mean a real downloadable, archivable PDF file per group rather than a browser print, that needs a server-side renderer and a dependency decision. Flagging rather than adding a package.
6. **Magic-link driver access is the widest new attack surface (UR-015).** Mitigations planned: 128-bit random token, no route data in the URL, expiry at route completion plus a short grace, optional PIN, per-route scoping enforced server-side, no other route reachable from the link, audit on every action. Residual risk: a forwarded link before expiry. The PIN is the answer, and it is optional per the user's decision — worth confirming whether it should default On during crunch week.
7. **"Nearby" reroute radius (G-023).** Set at about 0.5 mile or same-street cluster per the orchestrator default. Straight-line vs driving distance is unspecified; P9 will use straight-line from the Mapbox geocode because the manager confirms every suggestion anyway, and the radius will be a setting.
8. **Legacy data quality is the schedule risk (G-029, UR-014).** Year-one repeat orders are only as good as the migrated address book. P12 is deliberately ahead of P13 and produces a manual-review queue; the size of that queue is unknowable until a real export is in hand, and it may need volunteer hours rather than code.
9. **Shippo negotiated-rate wiring is an external dependency.** The plan assumes the org's FedEx and UPS business accounts can be connected to Shippo and return negotiated rates. If either account cannot be connected in time, margin capture degrades to list rates and the spread shrinks. P6 handles a missing provider by falling back to manual quotes, and R-184's UPS direct credentials stay declared-but-unused as the inventory has them.
10. **Off-season auto-flip is optional in the brief (UR-008).** Built as a scheduled setting that a manager can leave off. Open: whether a flip should also close the previous season's open drafts, which the inventory does not say.
11. **Scale numbers are a baseline, not a measurement (G-024).** 1,000 orders / 5,000 packages / 10+ staff comes from the grill. If real crunch volume is materially higher, the nightly batch is the first thing to break, which is why P15 times it explicitly.
12. **Two carry-forward conflicts are closed by the user, and I followed the resolutions, not the code.** R-109's six-vs-five role question is settled by resolution 8a (customers are not staff, three staff roles). R-166's Stripe client packages are settled by 8b (hosted only, packages not installed). R-165 cites a `scripts/migrate-from-old.ts` that never existed; P12 treats it as documentation only and writes fresh importers.

---

## Appendix — coverage

### Rebuild scope (16 / 16)

| ID | Phase | ID | Phase |
|---|---|---|---|
| UR-001 | P8 | UR-009 | P6 (+P9 scheduling) |
| UR-002 | P9 | UR-010 | P10 |
| UR-003 | P6 | UR-011 | P7 |
| UR-004 | P9 | UR-012 | P1 |
| UR-005 | P8 | UR-013 | P8 |
| UR-006 | P5 | UR-014 | P4 (+P12 migration) |
| UR-007 | P13 | UR-015 | P9 |
| UR-008 | P2 | UR-016 | P10 |

### Grill union (30 / 30)

| ID | Phase | ID | Phase | ID | Phase |
|---|---|---|---|---|---|
| G-001 | P8 | G-011 | P13 | G-021 | P8 (cards) |
| G-002 | P8 | G-012 | P13 | G-022 | P3 (+P2 gating) |
| G-003 | P8 | G-013 | P2 (+P13 use) | G-023 | P9 |
| G-004 | P8 | G-014 | P6 | G-024 | P15 |
| G-005 | P9 | G-015 | P6 | G-025 | P9 |
| G-006 | P6 | G-016 | P1 | G-026 | P10 |
| G-007 | P7 | G-017 | P9 (+P11 send) | G-027 | P6 + P9 |
| G-008 | P2 (+P10) | G-018 | P5 | G-028 | P7 |
| G-009 | P10 | G-019 | P4 (+P5 capture) | G-029 | P12 |
| G-010 | P10 | G-020 | P8 | G-030 | P9 |

### Codebase carry-forward (192 / 192)

| Phase | R IDs | Count |
|---|---|---:|
| P0 | 122, 124, 131, 132, 133, 136, 137, 138, 139, 140, 141, 142, 163, 164, 185, 187, 188, 189, 190, 191 | 20 |
| P1 | 10, 51, 98, 99, 100, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 115, 117, 118, 119, 120, 129, 130, 134, 135 | 24 |
| P2 | 48, 65, 66, 67, 68, 70, 71, 94, 95, 96, 97, 128, 146, 147, 148, 156, 157, 158, 161, 180 | 20 |
| P3 | 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 15, 16, 17, 18, 88, 123, 171, 172, 178, 181, 192 | 23 |
| P4 | 24, 25, 29, 38, 39, 40, 42, 43, 62, 64, 114, 144, 145, 162, 179 | 15 |
| P5 | 19, 20, 21, 22, 23, 26, 27, 28, 30, 31, 44, 45, 46, 47, 59, 60, 121, 149, 150, 151 | 20 |
| P6 | 32, 81, 154, 155, 173, 174, 177, 183, 184 | 9 |
| P7 | 33, 34, 35, 36, 37, 52, 53, 54, 61, 87, 93, 125, 126, 127, 152, 159, 160, 166, 167, 168, 169, 170 | 22 |
| P8 | 55, 56, 76, 153, 175, 176 | 6 |
| P9 | 72, 73, 74, 75, 77, 78, 116 | 7 |
| P10 | 69, 182 | 2 |
| P11 | 79, 80, 82, 83, 84, 85, 86, 89, 90 | 9 |
| P12 | 63, 143, 165, 186 | 4 |
| P13 | 41, 57, 58 | 3 |
| P14 | 14, 49, 50, 91, 92, 101, 102, 103 | 8 |
| P15 | load/concurrency re-verification only; no new IDs | 0 |
| **Total** | R-001 … R-192, each assigned exactly once | **192** |

**Coverage claim.** All 16 UR requirements, all 30 G checklist items, and all 192 R carry-forward rows are assigned to a phase. Four R rows are carried forward with their behavior **replaced** by the user's overrides rather than reproduced: R-032 (pass-through rates → margin capture), R-153 (fulfillment-group-only → package entity), R-077/R-078 (logged-in messenger → magic link), R-055/R-175 (label void on save failure → void on reroute). The five out-of-scope items are named in the non-goals and are deliberately absent from every phase. No feature outside the frozen inventory is planned; the SMS vendor, the filing-group key, the PDF renderer, and the G-021 ID collision are raised as open questions instead of being invented.
