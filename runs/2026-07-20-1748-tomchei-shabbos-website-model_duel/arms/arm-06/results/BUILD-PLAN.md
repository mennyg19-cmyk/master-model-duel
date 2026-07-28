# BUILD-PLAN — arm-06 (Test 2, greenfield)

Input: `shared/USER-RESOLVED-INVENTORY.md` (frozen) + carry-forward rows in `shared/RECONCILED-INVENTORY.md` (192 R-IDs) as referenced by that brief. No reference app, no source codebase, no other arms' plans.

Scope basis: 16 UR rows (greenfield behavior changes), 30 G rows (grill feature checklist), 192 R rows (carry-forward capabilities, adapted where the user-resolved brief overrides them).

---

## 1. Goals / non-goals

### Goals

1. Rebuild the Tomchei Shabbos storefront + operations platform as a greenfield app covering the full frozen inventory: 192 carry-forward rows, 16 UR behavior changes, 30 G checklist items.
2. Package-first fulfillment: physical packages (boxes) with default grouping, staff split, per-package status and printing, where printing never means shipped (UR-001, G-001–G-004).
3. Money behavior exactly as resolved: shipping rate margin capture (UR-003), method switch with paid-charge preservation (UR-002), Stripe hosted checkout with immediate capture on web and check/cash with staff audit at POS (UR-011).
4. Delivery execution: Mapbox admin map with manager-confirmed reroute that voids Shippo labels (UR-004), driver magic links with optional PIN and per-tap audit (UR-015), free Google Maps deep links for turn-by-turn (resolution 5).
5. Ordering experience: cart-first entry with three-way recipient picker, identical on web and POS (UR-006); repeat-last-year flow with replacement + recipient review (UR-007); per-year seasons with off-season archive (UR-008).
6. Production truth: finished-package inventory as v1 primary, BOM/ingredients present in schema but hidden until a manager enables them (UR-016).
7. Scale from day one: 1,000+ orders / 5,000+ packages / 10+ concurrent staff at crunch (G-024).

### Non-goals (from inventory "Out of scope / deferred" only)

- Embedded Stripe Elements on-site checkout — hosted redirect only at launch (resolution 8b).
- Ingredient/BOM inventory UI — schema only; manager enables later (resolution 7, G-009).
- Customer-chosen bulk or per-package delivery appointment slots — rejected in grill.
- Manager override for out-of-area per-package delivery — hard zip block stands.
- Automatic map reroute without manager confirmation — never auto (G-027 default).
- UPS direct API integration — R-184 is declaration-only in the inventory; Shippo covers the UPS account (resolution 6).
- Customers in the staff roles table — customers are a separate identity with accounts/address books (resolution 8a).
- Pixel-copy of any prior UI — greenfield; carry-forward means capability parity, not layout cloning.

---

## 2. Stack proposal

| Layer | Choice | Forced by inventory? |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | Yes — carry-forward rows are all `src/app/…` App Router capabilities (R-001–R-192) |
| Data | PostgreSQL + Prisma migrations | Yes — R-137–R-142, R-146–R-160 |
| Identity | Clerk (staff + customer) | Yes — R-107, R-108 carried forward; role model rebuilt per UR-012 + 8a |
| Payments | Stripe hosted Checkout + webhooks | Yes — resolution 8b, UR-011, R-166–R-170 |
| Shipping | Shippo with org FedEx + UPS business accounts | Yes — resolution 6, UR-003/UR-004, R-173–R-177 |
| Maps | Mapbox (admin map + geocoding w/ cache); Google Maps deep links for drivers | Yes — resolution 5, R-162, R-179 |
| Email | Resend + transactional outbox with retrying sweeper | Yes — R-087, R-088, R-171, R-178, R-181 |
| Media | Vercel Blob, validated uploads | Yes — R-128, R-180 |
| Jobs | Vercel Cron (secret-authenticated) | Yes — R-124, R-185 |
| SMS | Twilio | No — channel (email + SMS for bulk delivery notify) is forced by the G-021 default; vendor is my pick, cheapest well-known path |
| UI kit | Tailwind + shadcn-style kit + tokens | Yes — R-188–R-190 carried forward |
| Tests | Vitest (unit, incl. permissions R-135) + Playwright (phase smoke) | No — framework unnamed in inventory; one test runner per concern |
| Hosting | Vercel | Yes in practice — Vercel Cron + Blob carried forward |

Free choices are minimal: SMS vendor and test frameworks. Everything else is inventory-forced.

---

## 3. Phases (ordered)

Dependency order: foundation → catalog → ordering → money → packages → shipping → delivery execution → pickup → print → migration → repeat → ops hub → hardening. Each phase lists IDs covered, deliverables, and smoke checks that must be observed in the running app.

### Phase 0 — Foundation, auth & roles, design system

- **IDs:** UR-012, G-016; R-010, R-098, R-099, R-104–R-106, R-107–R-113, R-115, R-117, R-119, R-120, R-130, R-131, R-135, R-136, R-137, R-138, R-140, R-141, R-142, R-144, R-161, R-163, R-164, R-187, R-188, R-189, R-190
- **Deliverables:** App skeleton (Next.js + TS, one pattern per concern documented in README); Postgres + Prisma core schema (staff, customers, settings KV, audit log, cron run log) with ordered migrations + CI schema-migration check + migration verification harness + baseline seed; Clerk auth with sign-in/sign-up; RBAC Manager/Staff/Driver with individual logins, per-person permission toggles, server-side `requirePermission` gate, staff confirmation/revocation, invitation identity linking, self-target mutation blocks, session login stamp; audit-write helper; staff account + permission management UI; staff impersonation with bar; admin shell with permission-gated sidebar, mobile nav, shared list controls, chrome links; shadcn-style UI kit + design tokens + brand constants; env validation at startup + `.env.example`; `/api/health`; production error masking; first-run setup page + empty-database bootstrap lockout; permission unit tests.
- **Smoke checks:** `/api/health` returns ok against live DB; first-run setup creates the first manager then locks; each role lands on a permission-appropriate admin home; hiding a permission removes its sidebar entry and the route 403s; a permission toggle change writes an audit row; impersonation start/stop shows the bar and audits both events; CI blocks a schema change with no migration.

### Phase 1 — Seasons & catalog

- **IDs:** UR-008, G-013, G-022; R-001–R-008, R-011, R-012, R-015, R-016, R-017, R-021, R-048 (mapping data + editor), R-065, R-066, R-067, R-097, R-128, R-146, R-147, R-148, R-180, R-192
- **Deliverables:** Season model: per-year catalog, manager Open/Closed, optional scheduled auto-flip, off-season archive browsing all years with no checkout; product/option/add-on admin CRUD with per-item replacement-mapping editor; media library (Blob, restricted + validated uploads); new-season setup wizard; storefront: mission-led homepage (impact bar, how-it-works, testimonials, final CTA), current-season catalog grid with category filters, price sorting, sold-out handling, package detail with option pricing, quick-view dialog, public past-collections archive, store-open-aware CTAs + closure enforcement + closed banner, storefront shell (sticky header, desktop nav, mobile menu, user menu, footer). Footer email-signup UI ships here; subscription backend is wired in Phase 11.
- **Smoke checks:** Create season + products → visible on storefront; close the store → checkout routes blocked, banner shows; archive renders prior years with zero checkout controls; replacement mapping saves and loads per product; sold-out item shows badge and cannot enter the cart; wrong-type media upload rejected.

### Phase 2 — Customers, address book & cart-first order builder

- **IDs:** UR-006, UR-014 (address book half; migration in Phase 9), G-018, G-019, G-020; R-019–R-031, R-043, R-059, R-060, R-114, R-121, R-145
- **Deliverables:** Customer identity separate from staff (8a): identity linking, owned profile updates; one address book per customer shared by web + POS, staff edit with audit; address autocomplete + server-side validation; cart-first order builder in a shared storefront/POS shell: product panel + cards + in-builder quick view, cart with quantities, inventory-aware selection, per-line assignment to on-order recipient / address-book entry / new recipient, auto-save of new recipients to the book, per-recipient greeting memory (last greeting offered as default), edit-saved-address while ordering, desktop sidebar + mobile cart FAB; drafts: autosave + resume, guest clear on success, guest checkout access tokens, discard, draft reference numbers, ownership + anti-enumeration gate; POS screen with customer lookup + preselection + find-or-create running the same builder UX.
- **Smoke checks:** Build a cart with 2 items and 3 recipients (one from book, one new); the new recipient appears in the address book; reload mid-order → draft resumes; guest token link reopens the same draft; another user's token 404s; a greeting entered for a recipient is pre-filled on the next order; staff address edit writes an audit row; POS builder matches web builder step-for-step.

### Phase 3 — Checkout, delivery rules & payments

- **IDs:** UR-009, UR-011, G-007, G-014, G-015, G-028; R-023, R-032–R-040, R-042, R-044–R-047, R-122, R-124, R-125, R-126, R-127, R-149–R-155, R-159, R-160, R-166–R-171, R-178, R-181, R-185 (cron platform lands here with the first sweeps)
- **Deliverables:** Delivery rules engine: bulk = one fee per destination (staff-scheduled later), per-package = fee per recipient, zip hard-block with no override, manager-set Purim-week delivery days selectable at checkout, day-of-notification trigger registered for route start (fires in Phase 6); checkout validation (stock + price), fulfillment/shipping selection with rate resolution, recipient/donation summary with conflict/price UI, guest email; Stripe hosted Checkout redirect with immediate capture, webhooks with authenticity + idempotency, charged-amount + fulfillment safety checks with auto-refund of stale/failed sessions; offline check/cash payment path with server-enforced policy and staff audit (POS checkout); payment recalculation on order changes; order lifecycle: state machine + transitions, finalization claiming sequential per-season order numbers, price snapshots on lines, cached derived payment status, draft wire format; transactional outbox + retrying sweeper + order lifecycle emails (confirmation, payment link) via Resend with idempotent dispatch; customer account self-serve: dashboard, order history + detail, continue/pay/cancel draft, profile management.
- **Smoke checks:** Guest shipping order → redirected to Stripe hosted page → webhook marks paid; tampered webhook rejected; duplicate webhook is a no-op; per-package delivery to a blocked zip hard-errors with no override path; fee math: one bulk fee per destination, one per-package fee per recipient; only manager-configured Purim-week days are selectable; POS check payment writes an audit row with the staff id; confirmation email lands in the outbox and the sweeper delivers it once; changing catalog price after placement does not alter line snapshots; account page shows the order and its payment status.

### Phase 4 — Package entity & finished-package inventory

- **IDs:** UR-001, UR-016, G-001, G-003, G-004, G-008, G-009, G-010; R-068, R-069, R-070, R-071, R-139, R-153, R-154, R-157, R-158
- **Deliverables:** Package entity linked to the customer order: default combine by recipient/address/method/greeting, staff split UI, per-package status New → Printed → Packed → Sent/Picked Up (print ≠ shipped), hybrid fulfillment (print-first with optional digital stages); finished-package inventory as v1 primary: unified versioned stock, reserve/allocate/release engine, adjustments + write-offs + shortfall, inventory overview dashboard, production batch planning + history, assembly batches consuming supplies into finished stock; BOM/ingredient schema with a manager-enable runtime flag and zero reachable UI while disabled; inventory-target XOR integrity constraints; package types + shipment boxes; data-driven fulfillment methods; fulfillment groups superseded by packages (snapshots retained on the package).
- **Smoke checks:** Multi-recipient order auto-groups packages by recipient+address+method+greeting; split turns one package into two; printing a slip flips status to Printed, never Sent; stock reserves at order time and releases on cancel; a production batch raises finished counts; BOM tables exist in the schema but no route renders until the manager flips the flag (verified on in test, then left off).

### Phase 5 — Shipping: Shippo, rate margin, labels

- **IDs:** UR-003, G-006; R-055, R-081, R-155 (quote options), R-173–R-177, R-183, R-184 (stays declaration-only)
- **Deliverables:** Shippo wrapper (rate/buy/void/track/validate) connected to the org's FedEx + UPS business accounts, with typed optional-provider handling; rate-shop across carriers including USPS where applicable; margin capture: customer charged the higher quoted carrier rate, label bought on the cheaper carrier, margin recorded per package for internal reconciliation; expiring selectable shipping quote options; carrier label creation + voiding; tracking refresh; Shippo address validation; label failure compensation (no stuck charge on failed purchase); shipment planning + bin packing against package types/boxes.
- **Smoke checks:** Quote a package → the customer-visible charge equals the higher quote and the purchased label is the cheaper carrier; a margin row is recorded; void via Shippo succeeds; a simulated label failure leaves no orphan charge; tracking refresh updates the package; USPS rates appear only when applicable.

### Phase 6 — Fulfillment execution: routes, map reroute, method switch, driver links, bulk

- **IDs:** UR-002, UR-004, UR-015, G-005, G-017, G-023, G-025, G-027, G-030; R-074, R-075, R-078 (Delivered semantics via magic link), R-116 + R-118 (adapted: route access scoped by per-route link instead of portal ownership), R-162, R-179
- **Deliverables:** Mapbox route builder with geocoding + cache and coordinate refresh; route administration (list/detail/reassign/print); map suggestion of nearby unshipped shipping packages (~0.5 mile of a stop or same-street cluster) with mandatory manager confirmation — never automatic; confirmed reroute voids the Shippo label if printed-not-shipped, adds the package to the route, and updates the print batch; staff method switch shipping ↔ delivery with paid-charge preservation (no refund/collect) and who/when audit; bulk delivery scheduling per destination with customer notification by email + SMS on assignment; per-package day-of notification on route start; driver magic-link UX: unguessable per-route link showing only that route's stops, expiry when the route is marked complete (optional short grace), optional 4-digit PIN the manager texts, audit log (time + route link id) on every Delivered tap; per-stop "Open in Google Maps" deep links; printed route sheet fallback.
- **Smoke checks:** Build a route from per-package deliveries → stops render on the Mapbox map; an unshipped shipping package near a stop appears as a suggestion; confirm → its Shippo label is voided, the package joins the route, the print batch updates; reject → nothing changes; switch a paid order shipping→delivery → charge unchanged, audit row written; open the magic link incognito → only that route's stops; wrong PIN blocks; a Delivered tap writes an audit row; completing the route kills the link; route start fires day-of notifications; bulk assignment sends both email and SMS.

### Phase 7 — Pickup channel

- **IDs:** UR-010, G-026; R-156, R-182
- **Deliverables:** Pickup eligibility when order inventory is available; ready notification; door list with picked-up stamp; unclaimed report; secured pickup-expiry cron; pickup locations configuration.
- **Smoke checks:** Order with available stock offers pickup at checkout; marking ready notifies the customer; the door list shows the order and the stamp persists; unclaimed orders surface on the report; the expiry cron flips stale ready orders and refuses unauthenticated calls.

### Phase 8 — Print pipeline & greeting cards

- **IDs:** UR-005, UR-013, G-002, G-021; R-056, R-076
- **Deliverables:** Nightly print batch: one PDF per filing group, parallel print/file, reprint per group or per order; greeting cards: order-level default with per-recipient override, separate card-stock PDF per filing group; printable packing slips per order/package; per-route greeting-cards print view; printing across all of the above never marks anything shipped (G-002).
- **Smoke checks:** Seed orders across filing groups → the nightly job emits exactly one PDF per group plus the card-stock PDF; reprint of a single order works; after printing, package status is Printed, not Sent; a per-recipient greeting override renders on that recipient's card; the route greeting view matches the PDF content.

### Phase 9 — Historical data migration

- **IDs:** G-029, UR-014 (migration clause); R-063 (staged engine), R-143, R-165, R-186
- **Deliverables:** Auditable staged import pipeline with atomic commits; legacy (Nexternal-style) customer/product/historical-order import scripts incl. Excel handling; messy-data cleanup: phone/email normalization + dedupe; address book migration completed before year-one repeat ordering (UR-014); order-number repair; documented entity map. Lands before Phase 10 so repeat ordering runs on real migrated history.
- **Smoke checks:** Import a legacy fixture → the staged preview shows duplicates resolved; killing a run mid-way commits nothing partial; customers merge with normalized contacts; address books attach to the right customers; historical orders appear in customer history with repaired sequential numbers; a rerun is idempotent.

### Phase 10 — Repeat orders

- **IDs:** UR-007, G-011, G-012; R-041, R-048 (chain walk), R-057, R-058
- **Deliverables:** Customer "repeat a prior order": copy last year's order to a draft; middle review page confirming replacements AND recipients; price-smart defaults + suggestions; unmapped items must be picked or removed before checkout; cross-season replacement-chain walk honoring admin mappings; staff single-order repeat; bulk repeat of customer history.
- **Smoke checks:** Repeating last year's order produces a draft with mapped replacements at current prices; an unmapped item blocks checkout until resolved; the recipient list matches the prior year and stays editable; an A→B→C mapping chain resolves to C; bulk repeat creates drafts for N selected customers.

### Phase 11 — Admin operations hub, marketing & reporting

- **IDs:** G-024 (batch ops surfaces; load verification in Phase 12); R-009, R-013, R-018, R-049, R-050, R-052, R-053, R-054, R-062, R-063 (CSV dialog), R-064, R-072, R-073, R-079, R-080 (payment reminders; pickup-expiry shipped in Phase 7), R-082–R-086, R-089, R-090, R-091–R-096, R-100, R-102, R-123, R-172
- **Deliverables:** Permission-aware dashboard + KPIs + recent orders; daily "Today" work queue; searchable/filterable order list; full order detail with money actions; refunds incl. Stripe path; fulfillment channel dashboard with bulk status actions and production + savings summaries (fed by the Phase 5 margin ledger); follow-up call center; payment-reminder cron; customer directory + search + add + detail/history; CSV customer/product import dialog on the staged engine; settings hub (orders/shipping/email/developer tabs: store status, package types, pickup, follow-up, delivery ZIPs, shipping rates, shipping rules); email hub: campaign builder + send + lifecycle lists, subscriber + mailing-list management, templates + branding, triggered overrides, test sender; newsletter subscribe + token-verified preferences + 3 unsubscribe prefs (HMAC, timing-safe); email log purge cron; multi-season performance reports + drill-downs; CSV export center + audit history; Stripe payment reconciliation (manual run + cron); administrative activity log page; staff help center + guided tours.
- **Smoke checks:** Dashboard KPIs match seeded data; Today queue lists the day's work; a refund posts to Stripe and the order; the fulfillment dashboard shows margin savings totals; a campaign sends to a list in test capture with subscriber prefs honored; an unsubscribe token validates and a forged one fails; exports download and audit; reconciliation flags a seeded mismatch; editing delivery ZIPs changes Phase 3 hard-block behavior immediately; the guided tour runs for a new staff account.

### Phase 12 — Scale, security sweep, test tooling & launch

- **IDs:** G-024; R-014, R-101, R-103, R-122 (verification sweep), R-129, R-132, R-133, R-134, R-191
- **Deliverables:** Load pass at 1,000+ orders / 5,000+ packages / 10+ concurrent staff: batch tools, pagination, sort/filter performance, concurrency handling where staff collide on the same records; security verification sweep: public guard (same-origin + IP rate limit + Zod) on every public endpoint, staff-only guards on staff APIs, cron bearer secrets, restricted media uploads, test-only destructive operations gated, bounded + redacted client-error ingestion, production error masking verified; CI guardrails workflow green incl. schema-migration check and permission unit tests; test-environment operations console (seed/wipe/clear-emails), test/live environment switch, storefront test-mode banner; global error page + client error reporting; launch checklist.
- **Smoke checks:** Seed 1k orders / 5k packages → list pages paginate without visible lag, the nightly print batch completes, and 10 concurrent staff edits surface lock conflicts cleanly instead of corrupting; unauthenticated staff-API calls 403; a public endpoint over the rate limit 429s; destructive test endpoints refuse in live mode; CI blocks schema-without-migration; production build shows the masked error page and reports client errors bounded.

---

## 4. Risks / open questions

1. **SMS vendor is a free choice.** The G-021 default forces email + SMS for bulk-delivery notification but names no vendor. Plan assumes Twilio; swap costs one integration file if the org already has another provider.
2. **Magic-link expiry policy.** Resolution 4 says "expires when route is marked complete (optional short grace)" without defining the grace. Open question: concrete grace window (proposal: 2 hours) and link entropy standard.
3. **PIN + link delivery to drivers.** The manager texts the 4-digit PIN; unclear whether the system should also SMS the link itself or the manager copies it. Plan assumes manager copies the link, system sends nothing to the driver.
4. **Margin attribution timing.** Quoted rates can drift between checkout and label purchase. Open question: reconcile margin at quote time, purchase time, or both; plan records both and reports the delta.
5. **"Filing group" definition.** UR-005/UR-013 require per-filing-group PDFs but the grouping key (route / pickup location / shipping batch) is not pinned. Plan proposes grouping by fulfillment channel + route/location; needs confirmation before Phase 8.
6. **Legacy data quality.** G-029/UR-014 say the export is messy; cleanup effort is unbounded until the real export is inspected. Mitigation: staged import with preview + dedupe before any commit (Phase 9 smokes).
7. **Geocode accuracy for nearby suggestions.** The ~0.5-mile suggestion radius depends on geocode quality; bad pins produce bad suggestions. Manager confirmation is mandatory, which contains the risk, but geocode cache TTLs need tuning at scale.
8. **Nightly PDF throughput at 5k packages.** PDF generation is the slowest nightly step. Plan parallelizes per filing group; if a single group exceeds the cron time budget, the batch needs chunking — flagged for the Phase 12 load pass.
9. **Shippo account prerequisite.** Negotiated FedEx + UPS business accounts must be connected in the Shippo dashboard by the org before Phase 5 smokes can pass; that is an ops task, not code.
10. **Season auto-flip safety.** UR-008's optional scheduled flip changes what customers can buy. Plan gates it behind the manager setting and logs the flip; open question: whether a pre-flip warning email to staff is wanted (not in inventory — default no).

---

## Appendix A — Coverage matrix

- **UR-001–UR-016:** all 16 covered (Phases 4, 6, 5, 6, 8, 2, 10, 1, 3, 7, 3, 0, 8+2, 2+9, 6, 4 respectively).
- **G-001–G-030:** all 30 covered (Phases 4, 8, 4, 4, 6, 5, 3, 4, 4, 4, 10, 10, 1, 3, 3, 0, 6, 2, 2, 2, 8, 1, 6, 11+12, 6, 7, 3+6, 3, 9, 6 respectively).
- **R-001–R-192:** all 192 carried forward or explicitly adapted. Adaptations per the user-resolved brief: R-077 (messenger portal) superseded by UR-015 magic links; R-116/R-118 driver scoping adapted to per-route link scoping; R-109 role model rebuilt per resolution 8a; R-166 stays hosted-only per resolution 8b; R-184 remains declaration-only per inventory note; pass-through rates → UR-003; fulfillment-group-only → UR-001; void-on-save-failure → UR-004 void-on-reroute.

## Appendix B — Explicitly out (restated from inventory)

Embedded Stripe Elements, ingredient UI at launch, customer-chosen delivery slots, out-of-area manager override, automatic reroute, UPS direct integration.
