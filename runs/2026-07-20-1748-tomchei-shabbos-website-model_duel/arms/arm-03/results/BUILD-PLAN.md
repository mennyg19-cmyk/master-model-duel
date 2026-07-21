# BUILD-PLAN — arm-03 (Test 2)

**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`  
**Input:** `shared/USER-RESOLVED-INVENTORY.md` (frozen target: UR-001–016, G-001–030, carry-forward R-001–192 with listed overrides)  
**Workspace ports:** web `3103`, db `4103`  
**Phase count:** 12

---

## 1. Goals / non-goals

### Goals

Rebuild a seasonal charity package storefront + staff ops platform that:

- Sells catalog packages to web customers and via staff POS, with cart-first entry and shared builder UX (UR-006, G-018).
- Models **physical packages (boxes)** linked to orders: default grouping, staff split, per-package status/print, print ≠ shipped (UR-001, G-001–G-004).
- Supports hybrid fulfillment: shipping (Shippo + FedEx/UPS accounts), volunteer delivery routes, and pickup (UR-009–011, UR-015).
- Captures shipping **rate margin** (quote carriers, charge higher, ship cheaper) and preserves paid delivery/shipping charges when staff switch shipping ↔ delivery (UR-002, UR-003, G-005–G-006).
- Runs seasons (open/closed, archive browse), repeat-order with replacement review, address books, greeting cards, finished-package inventory v1 (BOM schema ready, UI hidden) (UR-007–008, UR-013–014, UR-016).
- Separates **customers** from **staff** (Manager / Staff / Driver + per-person permission toggles) (UR-012, G-016; R-109 override).
- Uses **hosted Stripe Checkout** for web cards; POS check/cash with audit (UR-011, G-007, G-028; R-166 hosted-only).
- Drivers use **magic-link** route access (optional PIN), Mapbox for office maps, Google Maps deep links for turn-by-turn (UR-004, UR-015, G-025, G-030).
- Retains carry-forward capabilities from the 192-row reconcile (storefront/marketing, account self-serve, admin catalog/media, reports/exports, email, ops hub, security patterns adapted to UR-012, integration scaffolding) unless overridden above.
- Scales for ~1k orders / 5k packages / 10+ concurrent staff (G-024).

### Non-goals (explicitly out / deferred)

- Embedded Stripe Elements / on-site card forms (R-166 deferred).
- Ingredient/BOM inventory UI at launch (schema only; manager enable later) (G-009).
- Customer-chosen bulk or per-package delivery appointment slots.
- Manager override for out-of-area per-package delivery (hard zip block).
- Automatic map reroute without manager confirmation.
- Direct UPS API implementation beyond Shippo-connected accounts (R-184 remains declaration-only).
- Source codebase copy or other arms’ plans.

---

## 2. Stack proposal

| Layer | Choice | Justification |
|---|---|---|
| App | **Next.js (App Router) + TypeScript** | Matches inventory surface (storefront/admin/API routes, SSR shells); greenfield default for this product shape. |
| DB | **PostgreSQL + Prisma** | Forced by R-137–164 data model expectations; ports: db `4103`. |
| Auth | **Clerk** (customers + staff identity) | R-107/R-108; staff roles live in app DB, not Clerk roles alone (UR-012 / R-109). |
| Payments | **Stripe Checkout Sessions** (hosted redirect) + webhooks | **Inventory-forced** (user #8b, UR-011, G-007, R-166). No `@stripe/stripe-js` client mount at launch. |
| Shipping | **Shippo** + org FedEx/UPS business accounts | **Inventory-forced** (user #6, G-006, R-173–177). |
| Maps | **Mapbox** (admin geocode + route map); **Google Maps URL deep links** for drivers | **Inventory-forced** (user #5, G-030, R-074, R-179). |
| Email | **Resend** + outbox/cron | R-171, R-087–088, R-181. |
| Media | **Vercel Blob** | R-067, R-180. |
| UI | Tailwind + shadcn-style kit + brand tokens | R-188–192. |
| Hosting/crons | Vercel-compatible app + secured cron routes | R-185, R-124. |
| SMS | Provider TBD for bulk-delivery + day-of driver notify | G-021 channel default (email + SMS); not named in inventory — open question. |

Dev: app on port **3103**. No git in arm workspace.

---

## 3. Phases

Coverage legend: each phase lists **UR-***, **G-***, and **R-*** IDs it owns or substantially completes. Later phases may deepen earlier IDs; the Coverage claim section asserts full union.

### Phase 1 — Foundation & schema spine

**IDs:** R-010, R-014, R-101, R-103, R-131, R-133, R-137–142, R-144–164 (schema foundations), R-187–191; UR-001 (Package table), UR-012/UR-016 (role + BOM columns), G-009 (schema-only BOM), G-024 (indexes/concurrency baselines)

**Deliverables:**
- Next.js app scaffold, env schema, health check, design tokens / UI kit stubs.
- Prisma schema: Season, Product(+options/add-ons), Customer (separate from staff), AddressBook, Order/OrderLine, **Package** (physical box), FulfillmentMethod, ShippingQuote, Payment, StaffUser + permissions, Inventory (finished packages + hidden BOM/assembly tables), Settings KV, GeocodeCache, AuditLog, Outbox, CronRunLog.
- Empty-DB setup/bootstrap lockout; seed baseline; migration CI guard; test-mode wipe/seed hooks.
- Local Postgres on `4103`; app on `3103`.

**Smoke:**
- `GET /api/health` green with DB.
- Migrate + seed; setup page creates first Manager; second setup attempt blocked.
- Schema has Package + BOM tables; no ingredient UI routes yet.

---

### Phase 2 — Auth, roles, admin shell

**IDs:** UR-012, G-016; R-051, R-098–100, R-104–106, R-107–120, R-134–136; R-049 (shell), R-115, R-117–119

**Deliverables:**
- Clerk sign-in/up; customer identity linking vs staff confirmation/invitation.
- Roles: Manager / Staff / Driver only in staff table; customers never stored as staff (R-109 resolution).
- Per-person permission grants/denies; requirePermission gates; admin shell + sidebar; audit log; impersonation; activity log.
- Permission unit tests.

**Smoke:**
- Unconfirmed staff cannot open `/admin`.
- Manager toggles a Staff permission; gated page appears/disappears.
- Customer account cannot access admin; Driver without route link cannot list all routes.

---

### Phase 3 — Seasons, catalog, media, settings

**IDs:** UR-008, G-022; R-003–R-006, R-015–017, R-048, R-065–067, R-094–097, R-146–148, R-161, R-180, R-192; G-013 (replacement mappings admin)

**Deliverables:**
- Season model + Open/Closed + optional scheduled flip; new-season wizard.
- Admin product/add-on CRUD, media library (Blob), replacement mappings per catalog item.
- Settings: store status, package types, pickup locations, shipping rules/ZIPs/rates cards, email/dev tabs.
- Public catalog grid (filters, sort, sold-out), package detail, quick-view; past-collections archive (browse-only when closed).

**Smoke:**
- Closed season: archive browse OK; checkout CTAs blocked + banner.
- Manager opens season; catalog purchasable.
- Upload media, assign to product; replacement mapping saves.

---

### Phase 4 — Storefront marketing & account self-serve

**IDs:** R-001–002, R-007–009, R-011–013, R-018, R-038–043, R-114, R-122–123; UR-014 (account address book view)

**Deliverables:**
- Homepage (mission, impact bar, how-it-works, testimonials, CTAs), storefront shell, newsletter subscribe/unsubscribe prefs (HMAC tokens).
- Customer account: dashboard, profile, addresses, order history/detail, draft continue/pay/cancel.

**Smoke:**
- Subscribe → preference token → unsubscribe path works.
- Signed-in customer edits profile/address; cannot edit another customer’s.
- Closed-store banner visible storewide.

---

### Phase 5 — Cart-first order builder (web + POS shell)

**IDs:** UR-006, UR-014, G-018–G-019; R-019–031, R-044–047, R-059–060, R-144–145, R-149–151

**Deliverables:**
- Shared OrderBuilderShell for storefront + POS: catalog → cart → qty; assign each line to on-order / address-book / new recipient; new recipients auto-save to address book.
- Address autocomplete + server validation; autosave drafts; guest draft clear on success; draft numbers/wire format.
- POS: customer search/find-or-create + preselection; same cart UX.
- Staff address-book edit with audit trail.

**Smoke:**
- Web: add 2 SKUs, assign to self + new recipient; recipient appears in address book.
- Resume draft after refresh.
- POS: look up customer, build cart with address-book pick; audit row on staff address edit.

---

### Phase 6 — Checkout, payments, fulfillment rules

**IDs:** UR-009–011, G-007, G-014–015, G-017, G-027–028; R-032–037, R-045, R-125–127, R-152, R-154–156, R-159–160, R-166–170; G-005 charge fields (paid delivery/shipping snapshot)

**Deliverables:**
- Checkout: fulfillment selection (shipping / bulk delivery / per-package delivery / pickup), zip hard-block for per-package delivery, bulk fee-per-destination vs per-recipient fee, manager-set Purim-week days at checkout (staff-routed days later).
- **Hosted Stripe Checkout** redirect + webhook capture (immediate); success page; stock/price validation; payment recalc helpers.
- POS offline: check/cash/comp with staff audit; server-enforced offline policy.
- Persist paid shipping/delivery charges as immutable customer-facing amounts for later method-switch preservation.

**Smoke:**
- Web card path: redirect → webhook → order paid; no card fields on-site.
- Per-package delivery to blocked ZIP rejected.
- POS cash payment posts with staff id in audit.
- Bulk vs per-package fee math matches rules.

---

### Phase 7 — Package entity, print batches, greeting cards

**IDs:** UR-001, UR-005, UR-013, G-001–G-004, G-020–G-021; R-056, R-072–073, R-076, R-081 (planning adapted to packages), R-153→Package linkage

**Deliverables:**
- Default combine packages by recipient/address/method/greeting; staff split/merge.
- Optional stages: New → Printed → Packed → Sent/Picked Up; printing does not mark shipped.
- Nightly print batch: separate PDF per filing group; parallel print/file; reprint by group/order.
- Greeting: order default + per-recipient override; remember last greeting per recipient; separate card-stock PDF per filing group.
- Fulfillment channel dashboard + bulk status actions oriented around packages.

**Smoke:**
- Order with 3 recipients → default 3 packages (or combined when same address/method/greeting); staff split one into two.
- Print slips/labels/cards; status stays pre-ship.
- Reprint one filing group only; card PDF distinct from packing slip.

---

### Phase 8 — Shipping margin, Shippo labels, method switch

**IDs:** UR-002, UR-003, G-005–G-006; R-055, R-173–177, R-183–184; overrides on R-032/R-174 (margin, not pass-through cheapest-only charge)

**Deliverables:**
- Rate-shop via Shippo (FedEx/UPS, USPS where applicable); **charge customer the higher rate**; plan/buy label on **cheaper** carrier; store margin for internal reconcile.
- Label buy/void/track/address validate; void on failure compensation.
- Staff method switch shipping ↔ volunteer delivery: **no** customer refund/collect; audit who/when; preserve paid charge (UR-002).

**Smoke:**
- Two carrier quotes differ → customer charged max; label purchased on min; margin row visible to Manager.
- Switch shipping→delivery after pay: customer balance unchanged; audit entry present.
- Void label via Shippo when cancelling a printed-not-shipped package.

---

### Phase 9 — Routes, Mapbox reroute, driver magic-link

**IDs:** UR-004, UR-015, G-023, G-025, G-027, G-030; R-074–075, R-077–078 (replaced auth model), R-116, R-118, R-162, R-179

**Deliverables:**
- Admin route builder (Mapbox): delivery stops + geocode cache; route list/detail/reassign/print fallback sheets.
- Nearby unshipped shipping packages (~0.5 mi / street cluster); manager **confirms** before switch; void Shippo label if printed-not-shipped; add to route; refresh print batch (G-027 map nearby).
- Driver UX: unguessable per-route magic link; optional 4-digit PIN; shows only that route’s stops; expires when route complete (+ short grace); “Open in Google Maps” per stop; Delivered tap audits time + route-link id.
- Day-of notification when route starts (per-package delivery).

**Smoke:**
- Build route on Mapbox map; confirm reroute of nearby shipping package; label voided if printed.
- Magic link opens mobile stop list; wrong/expired link fails; PIN required when set.
- Delivered creates audit with link id; Google Maps deep link opens for a stop.
- Printed paper route still usable as fallback.

---

### Phase 10 — Pickup, finished inventory, production batches

**IDs:** UR-010, UR-016, G-008–G-010, G-026; R-020, R-068–071, R-080 (pickup-expiry), R-156, R-158, R-182

**Deliverables:**
- Pickup eligible when finished inventory available; ready notify; door list + picked-up stamp; unclaimed report; pickup-expiry cron.
- Finished-package inventory v1 (overview, adjustments, write-offs, shortfall, reserve/allocate/release).
- Assembly batches consume supplies → finished stock in **schema + batch engine**; ingredient UI hidden behind manager enable flag (default off).
- Live-stock awareness in order builder.

**Smoke:**
- Zero stock → pickup option disabled; after production batch, pickup allowed + ready email/SMS.
- Door list marks picked up; unclaimed report lists leftovers.
- Manager enable-ingredients flag reveals UI; default launch path uses finished counts only.

---

### Phase 11 — Repeat order, customers admin, email, follow-up

**IDs:** UR-007, UR-014, G-011–G-013, G-017, G-029; R-041, R-048, R-057–058, R-062–064, R-079–080, R-082–090, R-087–088, R-143, R-165, R-171–172, R-178, R-181, R-186

**Deliverables:**
- Repeat prior year → draft; middle review page for replacements **and** recipients; unmapped items must pick or remove; price-smart suggestions; admin + bulk staff repeat.
- Customer directory/detail; CSV import (staged atomic); historical/messy migration tooling (Nexternal scripts + cleanup) before year-one repeat.
- Email hub: campaigns, subscribers/lists, templates, triggered/transactional, outbox sweeper, order lifecycle emails, test sender, purge cron.
- Follow-up call center; payment-reminder cron; bulk-delivery assignment notifies customer (email + SMS).

**Smoke:**
- Repeat flow blocks checkout until unmapped SKUs resolved; recipient confirm page required.
- Import CSV customers atomically; bad rows don’t partial-commit.
- Place order → confirmation email via outbox; cron sweeps retries.
- Assign bulk delivery window → customer email+SMS.

---

### Phase 12 — Reports, exports, money ops, harden scale

**IDs:** G-024; R-036, R-050, R-052–054, R-091–093, R-102, R-121–122, R-124–126, R-128–130, R-132, R-168–169, R-185; remaining R-* polish (Today queue, refunds, reconciliation, help/tours, exports, rate limits)

**Deliverables:**
- Admin Today work queue; searchable orders; order detail money actions; Stripe refunds + safety refunds; payment reconciliation cron/UI.
- Reports multi-season + CSV export center with audit history.
- Help center + tours; client error ingestion; public endpoint guards; cron bearer auth; CI security guardrails.
- Batch tools / pagination / concurrency hardening for 1k orders / 5k packages / 10+ staff.
- Coverage pass: any remaining R-001–192 row not yet smoke-verified gets a checklist tick or explicit defer only if inventory-deferred.

**Smoke:**
- Refund path updates Stripe + local payment state.
- Export deliveries CSV downloads; export audit logged.
- Concurrent staff edit two packages on same order without corrupt status (optimistic lock or equivalent).
- Full checklist: all in-scope G-001–030 and UR-001–016 demonstrated once.

---

## 4. Risks / open questions

| Risk / question | Impact | Mitigation |
|---|---|---|
| SMS provider not named in inventory (G-021 / day-of notify) | Cannot implement notify without a vendor | Pick one (e.g. Twilio) at Phase 9/11 kickoff; log in DECISION-LOG |
| Package vs legacy “fulfillment group” mental model | Staff confusion; print-batch filing groups | Treat filing group as print/file partition over packages; keep Order → Package as source of truth |
| Shippo + dual FedEx/UPS accounts + margin math | Wrong customer charge or label buy | Golden tests: quote pair → charge max / buy min; reconcile report |
| Magic-link + optional PIN threat model | Link leak before route complete | Unguessable tokens, expiry on complete, audit every Delivered; short grace only |
| Map “nearby” (~0.5 mi) false positives | Bad reroutes | Always require manager confirm; never auto-switch |
| Historical migration quality (G-029, R-165/R-186) | Broken year-one repeat | Migration + cleanup gate before enabling repeat on prod data |
| BOM UI hidden but batches exist | Accidental volunteer exposure | Feature flag default off; no nav entry until Manager enables |
| Scale (G-024) deferred to Phase 12 | Early phases may need rework | Add package indexes + list pagination from Phase 7; load-test in Phase 12 |
| R-184 UPS direct credentials | Env noise | Keep declaration-only; all rates/labels via Shippo |
| Clerk + separate customer/staff tables | Identity edge cases | Explicit ensureCustomer vs staff invite flows; never insert customer into StaffRole |

---

## Coverage claim

| Set | Coverage |
|---|---|
| UR-001–UR-016 | All mapped into Phases 1–11 |
| G-001–G-030 | All mapped; G-009 UI deferred (schema Phase 1/10) per inventory |
| R-001–R-192 | All carry-forward retained; overrides applied: margin (not pass-through), Package entity, magic-link drivers, Shippo void-on-reroute, hosted Stripe only, customers ≠ staff |
| Deferred (inventory) | Embedded Stripe; ingredient UI; customer delivery slots; auto-reroute; out-of-area override |

**Total phases: 12.** Every in-scope inventory ID is owned by at least one phase with a smokeable gate.
