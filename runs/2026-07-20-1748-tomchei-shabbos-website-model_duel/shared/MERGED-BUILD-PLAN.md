# Merged Build Plan — Test 2

Run: `2026-07-20-1748-tomchei-shabbos-website-model_duel`
Reviewer merge of arm-01 (10 phases) + arm-02 (17 phases) into 12 mergeable phases.
Frozen target: `shared/USER-RESOLVED-INVENTORY.md` (UR-001..UR-016, G-001..G-030) + `shared/RECONCILED-INVENTORY.md` (R-001..R-192).

## 1. Goals / non-goals

### Goals (union of arm-01 + arm-02)

- Rebuild the nonprofit Purim mishloach manos platform greenfield: storefront, cart-first ordering, hosted Stripe checkout, POS, admin operations, fulfillment, shipping, volunteer delivery routes, pickup, inventory, email, reports, migration.
- Make the **physical package (box)** a first-class entity (UR-001): default grouping, staff split, per-package status/printing/rerouting, print != shipped.
- Money rules exactly as resolved: charge preserved on method switch (UR-002), carrier rate-margin capture (UR-003), hosted Stripe immediate capture on web + check/cash POS with audit (UR-011).
- Driver access via expiring magic-link + optional PIN with delivery audit log (UR-004/UR-015); Mapbox admin maps, Google Maps deep links for drivers (G-030).
- Roles: Manager / Staff / Driver with per-person permission toggles; customers are accounts, never staff rows (UR-012, resolution 8a).
- Seasons with per-year catalog, replacement mappings, off-season archive browse, repeat-order with review page (UR-007/UR-008).
- Finished-package inventory at launch; BOM/ingredient schema present but UI hidden behind a manager toggle (UR-016, G-009).
- Retain every carry-forward capability from the 192-row reconcile except the four explicit overrides (pass-through rates, group-only fulfillment, logged-in driver, save-failure-only void).
- Support 1,000+ orders / 5,000+ packages / 10+ concurrent staff at crunch from day one (G-024).

### Non-goals (out of scope per inventory)

- No embedded Stripe Elements on-site checkout — hosted redirect only at launch (resolution 8b; R-166 client packages treated as unused).
- No ingredient/BOM UI at launch — schema only, manager enables later.
- No customer-chosen delivery appointment slots (bulk or per-package) — rejected in grill.
- No manager override for out-of-area per-package delivery — zip block is hard (G-014).
- No automatic map reroute without manager confirmation — rejected; confirm always (G-023).
- No behavior outside the frozen inventories.

## 2. Stack (union; both arms agree, inventory-forced)

| Layer | Choice | Source |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript, route groups `(storefront)` `(admin)` `(driver)` | arm-01 + arm-02 (inventory-forced) |
| DB / ORM | PostgreSQL + Prisma, ordered migrations + CI schema guard + disposable migration harness | arm-01 + arm-02 (R-137..R-141) |
| Auth | Clerk (staff + customer identities, separate role tables); driver magic-links are app-issued tokens, not Clerk | arm-01 + arm-02 (R-107/108, UR-012) |
| Payments | Stripe hosted Checkout + webhooks; offline check/cash payments table (staff-only) | arm-01 + arm-02 (UR-011, G-007) |
| Shipping | Shippo with org FedEx + UPS accounts; rate-shop, charge higher, ship cheaper, record margin | arm-01 + arm-02 (UR-003, resolution 6) |
| Maps | Mapbox (admin map + geocoding with cache) + Google Maps deep links for drivers | arm-01 + arm-02 (resolutions 4/5, G-030) |
| Email | Resend + transactional outbox + retrying sweeper | arm-01 + arm-02 (R-171, R-088) |
| SMS | Twilio-class single provider (only unforced stack item; confirm before delivery phase) | arm-02 (G-021 default) |
| Storage | Vercel Blob for media | arm-01 + arm-02 (R-180) |
| UI | shadcn-style kit + design tokens + Tailwind | arm-01 + arm-02 (R-188..R-190) |
| PDFs | Server-rendered print routes + nightly batch PDF generation (one PDF per filing group) | arm-01 + arm-02 (UR-005) |
| Hosting/cron | Vercel + Vercel Cron with bearer-secret auth | arm-01 + arm-02 (R-124, R-185) |

Ponytail ladder note (arm-02): no queues, Redis, or job frameworks — Postgres row-locking + cron sweepers cover the 5k-package scale.

## 3. Ordered phases

Every phase ends with a gate: smoke checklist verified in the running app with seeded data, `.scratch/run-state.md` updated. Phase IDs are mergeable (P1..P12). "IDs covered" lists where a requirement is **delivered**; schema for later phases may land earlier (noted).

### P1 — Foundation, identity, roles, permissions, staff tooling

**Source:** arm-02 P1 + P2 (split) wins over arm-01 P1 (bundled). arm-01 folded identity into its foundation phase; arm-02 separated them. **Decision: keep arm-02's split** — foundation + identity are both "platform/auth" and merge cleanly into one mergeable increment; the domain schema (P2) stays separate so the grouping engine can be unit-tested before any UI.

**Primary IDs:** R-010, R-098, R-099, R-100, R-104, R-107..R-120, R-130, R-131, R-133, R-135, R-136, R-161, R-164, R-187..R-192; UR-012; groundwork G-016, G-024.

**Deliverables**
- Next.js + TS + Prisma + Postgres scaffold with route groups `(storefront)` `(admin)` `(driver)`; env schema validation + `.env.example` generator; typed key-value settings store (R-161).
- Helper libs (money-in-cents, normalize, phone, ids, season, dates, result-with-error-masking) — R-164.
- shadcn kit + design tokens + brand constants (R-188..R-190); global error page + bounded redacted client-error endpoint (R-132, R-191); marketing imagery assets (R-192).
- Health check (DB + env) — R-187; CI with lint, typecheck, migration guard, disposable migration harness, security guardrails workflow (R-133, R-140, R-141); baseline seed (R-142).
- Clerk integration + middleware; StaffUser (Manager/Staff/Driver) with per-user grant/deny overrides and `requirePermission` server gate (R-110, R-111); separate Customer identity linking (R-114); customers-not-staff per resolution 8a settles R-109 conflict.
- Staff confirmation/revocation + invitation linking (R-112, R-113); first-run setup page with empty-database bootstrap lockout (R-010, R-130).
- Staff management UI (add, roles, permission-override editor, self-target blocks — R-119); impersonation with banner (R-099); security audit trail + session login stamps (R-120); admin shell with permission-gated sidebar + mobile nav (R-104); permission unit tests (R-135); production error masking (R-136).

**Smoke checks**
- App boots; `/api/health` green; CI passes; a page renders with the design system; intentionally missing env var fails startup with a clear message.
- Bootstrap first manager on empty DB then endpoint locks; Staff without a permission gets 403 on a gated admin page while Manager passes; audit log records role change + impersonation; driver-role user sees no admin.
- Revoke a staff account and confirm the next protected request fails; verify grant/deny overrides take effect.
- Run 10 concurrent versioned updates against one fixture and confirm conflicts are reported instead of silently overwriting state.

**Merge boundary:** deployable shell with migrated DB, seeded identities, authorization tests, health check, and no business UI dependency on later phases.

### P2 — Domain core: seasons, catalog, customers, orders, packages, payments, shipping, inventory schema + engine

**Source:** arm-02 P3 wins over arm-01 P1 (which bundled schema into foundation). **Decision: arm-02's schema-first phase** — the package grouping engine is the keystone (arm-02 risk #1); isolating it before UI is safer than arm-01's big-bang P1.

**Primary IDs:** UR-001 (schema + grouping engine), UR-008 (season model), UR-016 (BOM schema, hidden), R-044..R-047, R-144..R-160, R-162, R-163; groundwork G-003, G-009, G-024.

**Deliverables**
- Prisma schema for Season (open/closed + optional scheduled auto-flip), Product (dims, kinds, inventory flags), options with price adjustments, restricted add-ons, replacement links (R-146..R-148).
- Customer (normalized phone/email, dedupe — R-144) + saved addresses with geocode fields (R-145).
- Order → OrderLine → add-ons tree with price snapshots (R-149, R-150), sequential per-season order numbers (R-151), draft reference numbers + wire format (R-047), cached payment status (R-152).
- **Package entity** (UR-001): recipient/address/method/greeting grouping key, optional stages New → Printed → Packed → Sent/Picked-Up, package-level audit; fulfillment methods data-driven (R-153, R-154).
- Payments (stripe/cash/check/comp, posted/voided — R-160); Stripe PaymentIntent model (R-159); shipping quotes with expiring options (R-155); pickup locations (R-156); package types + shipment boxes (R-157).
- Unified versioned inventory (products + add-ons, R-158) with XOR target integrity constraints (R-139); geocode cache with TTLs (R-162); cron run log (R-163).
- BOM/ingredient + assembly-batch tables (no UI — UR-016, G-009).
- Order state machine + finalize + discard (R-044..R-046); concurrency: row-level locking / optimistic versioning on inventory and package mutations.

**Smoke checks**
- Migration harness passes; seed creates a season + catalog + customer + order.
- Unit tests: grouping key combines same recipient/address/method/greeting and splits differing greeting; state machine rejects illegal transitions; two concurrent finalizations don't double-claim an order number.
- Race two checkouts for the last finished package (reserve engine): only one commits.

**Merge boundary:** schema + business-rule engine landed and unit-tested; no storefront/admin UI yet.

### P3 — Storefront: marketing, catalog, archive, newsletter, admin catalog & media

**Source:** arm-01 P2 + arm-02 P4. arm-01 bundled season management + new-season wizard here; arm-02 deferred to P13. **Decision: arm-02's deferral** — season management + replacement mappings belong with repeat-order (P10). Keep only the season Open/Closed gate + archive browse here (UR-008 browse/gate half).

**Primary IDs:** R-001..R-018, R-065..R-067, R-094, R-096, R-097, R-128, R-146..R-148 (catalog admin), R-180; UR-008 (browse/gate half); G-022.

**Deliverables**
- Homepage (mission, impact bar, how-it-works, testimonials, CTAs) store-open-aware (R-001, R-002, R-007, R-008).
- Storefront shell: sticky header, desktop nav, mobile menu, user menu, footer signup, storewide closed banner (R-011..R-013).
- Current-season catalog: category filters, price sort, sold-out handling, quick view, detail + option pricing (R-003..R-006, R-015..R-017).
- Past-collections archive (all years, browse only, no checkout — R-005, G-022); closure enforcement on order/checkout routes (R-002).
- Newsletter subscribe + preferences + HMAC tokenized unsubscribe (R-009, R-018, R-123).
- Admin product catalog CRUD with season select + replacement-link editor shell (R-065); add-on management (R-066); media library on Vercel Blob with restricted validated uploads + needs-photos panel (R-067, R-128, R-180).
- Settings hub shell — Orders tab (store status, package types, pickup locations, follow-up), Shipping tab (rates, rules, delivery ZIPs), Email + Developer tabs (R-094..R-096).

**Smoke checks**
- Open storefront at desktop + mobile widths; use all nav, quick-view, filter, sort controls with seeded catalog.
- Closed season hides checkout CTAs and blocks `/order` server-side; archive shows prior seasons without buy buttons; every archived year remains browsable.
- Subscribe → unsubscribe token round-trip; reject tampered/expired tokens.
- Upload an allowed image and reject a disallowed file; product created in admin appears in storefront grid.
- Edit delivery-ZIP in settings and confirm checkout blocking updates immediately.

**Merge boundary:** independently usable marketing/catalog release with season gates and admin catalog management; no ordering yet.

### P4 — Cart-first order builder, address book, customer account

**Source:** arm-01 P3 (minus repeat) + arm-02 P5. arm-01 bundled repeat orders here; arm-02 split repeat to P13. **Decision: arm-02's split** — repeat needs replacement mappings (admin) + prior-year data; keep repeat in P10 with seasons management.

**Primary IDs:** UR-006, UR-014 (book + staff edit audit; migration in P12), G-018, G-019, R-019..R-031, R-038..R-043, R-114 (customer identity already in P1).

**Deliverables**
- Cart-first flow — catalog + cart + quantities first, then assign each line to **on-order / address-book / new recipient** (three-way picker — UR-006, G-018).
- New recipients auto-save to the customer's single address book; address autocomplete + server validation (R-025); edit saved address mid-order (R-024, R-029); staff edits audited (UR-014, G-019).
- Inventory-aware live stock in builder (R-020); product options + restricted add-ons (R-021); builder product panel/cards/quick view (R-026); recipient assignment + add recipient dialogs (R-027, R-028).
- Autosave drafts + guest draft clear on success (R-022); guest checkout access tokens (R-023); desktop sidebar + mobile cart FAB (R-030); shared storefront/POS builder shell (R-031).
- Account area: dashboard, order history + detail, continue/pay/cancel draft (R-038..R-040); profile (ownership-enforced — R-042); saved-address account view (R-043).

**Smoke checks**
- Add 3 items → assign to self, a saved recipient, and a new recipient → new recipient appears in address book; totals match.
- Refresh mid-order restores authenticated and guest drafts; guest draft cleared only after success; second browser cannot open another customer's draft.
- Edit an address as its customer and as staff; verify ownership, normalized dedupe, geocode fields, and the staff audit entry.

**Merge boundary:** complete draft-building workflow, ending before payment or fulfillment commitment.

### P5 — Checkout: delivery rules, fees, Stripe hosted, order lifecycle, payments

**Source:** arm-01 P4 + arm-02 P6. arm-01 put live rate resolution in checkout; arm-02 used a placeholder here and wired live Shippo rates in P8. **Decision: arm-02's placeholder approach** — Shippo margin engine is complex; isolate it in P8. Checkout uses rate-resolution rules with placeholder rates; live rates wired in P8.

**Primary IDs:** UR-009, UR-011 (web half), UR-013 (capture), G-007, G-014, G-015, G-020, G-028, R-023, R-032 (rule engine; live rates in P8), R-033..R-037, R-121..R-127, R-132, R-149..R-152, R-159, R-160, R-166..R-170.

**Deliverables**
- Checkout with per-recipient fulfillment method; delivery rules — bulk: one fee per destination, staff-scheduled later; per-package: fee per recipient, **hard zip block** (G-014), manager-set Purim-week day choices (UR-009, G-015).
- Greeting: order default + per-recipient override, remembered per recipient for next season (UR-013, G-020).
- Stock + price validation (R-034); checkout recipient/donation/fulfillment summary + conflict/price UI (R-037).
- Hosted Stripe Checkout session with immediate capture (R-166); webhook authenticity + idempotency (R-125, R-167); charged-amount safety checks with auto-refund of stale/failed (R-126, R-169); refund sync (R-168); payment recalculation on order edits (R-036).
- Guest checkout tokens + draft ownership anti-enumeration (R-121); public endpoint guards — same-origin, IP rate limit, Zod (R-122); server-enforced offline-payment policy — staff only (R-127).
- Staff-only cash/check POS posting + voiding with audit (UR-011, G-028); preserve fulfillment prices as paid snapshots so later staff method changes cannot trigger a refund or collection.
- Order lifecycle: normalized order trees, price snapshots, seasonal order numbers, draft wire format, transitions, finalization, discard, cached payment status (R-044..R-047 exercised here; schema from P2).
- Lazy Stripe singleton (R-170); no client Stripe packages (resolution 8b).

**Smoke checks**
- Place a multi-recipient web order through hosted Stripe test checkout; replay its webhook and verify one order, one payment, one stock commitment, one confirmation trigger.
- Out-of-zone zip cannot select per-package delivery (no override); bulk to 2 destinations bills 2 destination fees; per-package to 3 recipients bills 3 fees.
- Change price/stock after draft creation; checkout reports the conflict and refuses stale totals; tampered price fails validation.
- Place cash and check POS orders as authorized staff; reject the same methods publicly; verify post/void audit entries.
- Exercise allowed and forbidden order transitions, sequential numbering, draft discard, refund, safety-refund, payment-status recalculation.

**Merge boundary:** customer and POS orders can be placed and paid safely, with fulfillment snapshots ready for package creation.

### P6 — Admin operations hub & POS

**Source:** arm-01 P5 + arm-02 P11. arm-01 bundled staff account management + impersonation + test-mode + help/tours here; arm-02 split staff account management to P2 (identity) and test-ops/help/tours to P17. **Decision: arm-02's split** — staff account management belongs with identity (P1); test-mode/help/tours belong with launch readiness (P12). P6 keeps the operations hub + POS + customer directory + imports + settings hub.

**Primary IDs:** UR-006 (POS parity), UR-011 (POS half), G-028, R-049, R-050, R-052..R-054, R-057 (shell; plan logic in P10), R-059..R-064, R-092 groundwork, R-094..R-096, R-105, R-106, R-143.

**Deliverables**
- Permission-aware dashboard (KPIs, recent orders — R-049); "Today" work queue (R-050); searchable/filterable/paginated order list with shared list controls built for 1k+ orders (R-052, R-105); full order detail with money actions (R-053); refunds incl. Stripe path (R-054).
- POS using the same cart-first builder + customer lookup/find-or-create + POS checkout taking check/cash with staff audit (R-059..R-061, UR-011, G-028).
- Customer directory + detail + history (R-062, R-064); staged atomic CSV import (customers/products) with audit (R-063, R-143).
- Admin chrome — visit-store link, alert banner, back link (R-106); settings hub tabs already opened in P3 are wired to live config here.
- Bounded, concurrency-aware list queries and bulk actions for the crunch scale (G-024).

**Smoke checks**
- Process one seeded order through dashboard, Today queue, search, detail, refund, and audit views as Manager and restricted Staff.
- POS order for a walk-in with cash payment writes an audited payment row; repeat one order; create a bounded bulk-repeat batch.
- Stage an import with valid, duplicate, and invalid rows; preview errors, atomically commit valid corrected input, verify import audit.
- Load and page through fixtures representing 1,000 orders and 5,000 packages; run two conflicting bulk actions and report skipped/conflicted records deterministically.

**Merge boundary:** staff can operate customers and paid orders without relying on fulfillment, campaign, or reporting phases.

### P7 — Package engine live: grouping UI, statuses, print batches, cards

**Source:** arm-02 P7; arm-01 P7 package half. arm-01 combined package engine + shipping + reroute in one phase; arm-02 split package engine (P7), shipping (P8), and reroute (in P9). **Decision: arm-02's split** — shipping margin engine and reroute are distinct concerns; keep them separate for mergeability. This phase covers package materialization, board, print batches, and greeting-card PDFs only.

**Primary IDs:** UR-001 (staff UI), UR-005, UR-013 (card PDFs), G-001, G-002, G-003, G-004, G-021 (card side), R-056, R-072, R-073.

**Deliverables**
- Finalized orders explode into packages via P2 grouping; staff package board — split a package, regroup, per-package status advance (optional stages; printing never implies shipped — UR-001, G-001..G-004).
- Fulfillment channel dashboard with bulk status actions + production/savings summaries (R-072, R-073).
- **Nightly print batch** (UR-005): separate PDF per filing group (slips, labels) with parallel print/file workflow, reprint per group or per order; greeting-card PDFs per filing group on card stock (UR-013, G-021); per-order packing slip (R-056).

**Smoke checks**
- Order with 2 recipients × 2 methods yields correctly split packages; split one package into two and both print; order links + audit retained.
- Print every artifact and confirm no package stage changes; mark one package Printed/Packed/Sent and verify each transition separately.
- Run nightly batch twice; second run is idempotent. Reprint one filing group and one order without regenerating unrelated groups; printed package still shows unshipped.

**Merge boundary:** all physical packages can be grouped, printed, and status-tracked without driver, shipping, or notification dependencies.

### P8 — Shipping: Shippo, rate margin, labels

**Source:** arm-02 P8; arm-01 P7 shipping half. **Decision: arm-02's isolation** — margin engine is a keystone risk (arm-02 risk #2/#3); wire live rates into P5 checkout placeholder here.

**Primary IDs:** UR-003, G-006, R-055, R-081, R-173..R-177, R-183, R-184 (declaration-only carry: UPS creds env slot).

**Deliverables**
- Shippo wrapper (rate/buy/void/track/validate — R-173) with org FedEx + UPS accounts.
- **Margin engine** (UR-003, G-006): quote both carriers (+USPS where applicable), charge customer the higher quoted rate, buy label on the cheaper carrier, record spread for internal reconciliation (report in P12).
- Bin packing + shipment planning against package types/boxes (R-081); label create/void from order detail and package board (R-055); label-failure compensation (R-175); tracking refresh (R-176); Shippo address validation (R-177); typed optional-provider env handling (R-183, R-184).

**Smoke checks**
- Feed Shippo fixtures where different carriers are high and low; verify customer charge = highest quote, purchased label = cheaper eligible quote, stored margin is exact.
- Void a label and buy again; rate-resolution rules honored at checkout (live rates replace P5 placeholder).
- For a printed-but-unshipped label, confirm reroute (P9) voids it before route assignment.

**Merge boundary:** shipping is live, margin is captured, and checkout rates are real.

### P9 — Delivery routes, driver magic links, reroute map, pickup, bulk delivery scheduling

**Source:** arm-01 P8 + arm-02 P9 + P10. arm-01 combined routes/driver/reroute/pickup/bulk into one phase; arm-02 split routes/driver/reroute (P9) from pickup/bulk (P10). **Decision: arm-01's combination** — pickup + delivery are operationally intertwined (route start triggers day-of notification; pickup eligibility ties to inventory). One phase hits the ~12-phase target without losing coverage.

**Primary IDs:** UR-002, UR-004, UR-010, UR-015, G-005, G-017, G-023, G-025, G-026, G-027, G-030, R-074..R-080, R-116 (replaced by magic-link scoping), R-179, R-182.

**Deliverables**
- Mapbox route builder from delivery packages (geocode + cache — R-074, R-179); route admin — list/detail/reassign/print, per-route greeting-card print (R-075, R-076).
- **Driver magic link** (UR-004, UR-015, G-025): unguessable per-route URL scoped to that route's stops, expires on route completion (optional short grace), optional 4-digit PIN the manager texts, audit log on every Delivered tap (time + link id); driver mobile web — stop cards, start route, mark delivered, **Google Maps deep link per stop** (G-030), printed route fallback.
- **Method switch** (UR-002, G-005): shipping ↔ delivery with charge preserved + who/when audit, both directions.
- **Map reroute** (UR-004, G-023, G-027): route map shows unshipped shipping packages within ~0.5 mile of a stop (or same street cluster), manager always confirms, voids printed-not-shipped Shippo label (via P8), adds to route, updates print batch; day-of delivery notification on route start (per-package delivery).
- Pickup (UR-010, G-017, G-026): eligibility when order inventory is available; ready-notification; door list with picked-up stamp; unclaimed-pickup report; pickup-expiry cron (R-182 auth from P1).
- Staff scheduling of bulk delivery date/window with **email + SMS notification** (G-021 default channel); follow-up call center with filters (R-079); payment-reminder cron (R-080).

**Smoke checks**
- Assign/reassign a route, print it, open its magic link on a phone viewport; only that route's stops are visible; wrong PIN throttled; mark all delivered → link expires; audit contains timestamp + route-link ID.
- Open every Google Maps deep link and verify encoded stop address; complete the same route using only the printed fallback.
- Switch a shipping package to delivery → customer balance unchanged, label voided, audit row written; nearby suggestion requires explicit confirm; sent package rejects reroute.
- Schedule bulk delivery → one email + SMS per intended customer (test capture); start a per-package route → one idempotent day-of notification.
- Move stock from unavailable to available, send pickup-ready once, print door list, stamp pickup, verify unclaimed/expiry and follow-up behavior; crons reject requests without bearer secret.

**Merge boundary:** delivery and pickup are operational end to end, including least-privilege driver access and print fallback.

### P10 — Seasons management, repeat orders, replacement mappings

**Source:** arm-02 P13; arm-01 scattered repeat (P3) + season management (P2). **Decision: arm-02's grouping** — repeat + replacement + season management belong together (replacement mappings feed repeat; season management drives both). **Dependency:** year-one repeat requires P12 migration to finish before season open.

**Primary IDs:** UR-007, UR-008 (management + auto-flip), G-011, G-012, G-013, R-041, R-048, R-057, R-058, R-097.

**Deliverables**
- Admin replacement mappings per catalog item with cross-season chain resolution (R-048, G-013).
- Customer repeat: copy prior year to draft, **middle review page confirming replacements AND recipients** (UR-007, G-011, G-012), price-smart defaults, unmapped items must be picked or removed.
- Staff single-order repeat (R-057); bulk repeat of customer history (R-058).
- New-season setup wizard (R-097); manager Open/Closed switch + optional scheduled auto-flip (UR-008); archive stays browsable off-season (gate already in P3).

**Smoke checks**
- Repeat an order containing a discontinued item → review page forces a replacement pick; price-smart default suggests closest-priced mapped item; confirm both replacements and recipients before continuing.
- Bulk repeat drafts N customers; auto-flip opens the season at the scheduled time (org-local timezone — open question).
- Repeat an imported prior-year order (after P12 migration) and verify mapped products, recipients, address-book entries, greetings.

**Merge boundary:** season lifecycle + repeat-order workflow complete; year-one repeat gated on P12 migration.

### P11 — Email & notification platform

**Source:** arm-01 P9 + arm-02 P14. Both arms agree on Resend + outbox + cron sweepers.

**Primary IDs:** G-021 (channel wiring), R-082..R-090, R-163 (log live), R-171, R-172, R-178, R-181, R-185, R-087.

**Deliverables**
- Resend integration (SDK isolated — R-171); email hub — campaigns, subscribers, lists, templates + branding, triggered (R-082..R-086, R-089).
- Campaign builder + send (R-083); triggered/transactional emails with per-key overrides + idempotency + test capture (R-086, R-178).
- Order lifecycle emails — confirmation, payment link, refund (R-087); transactional outbox + retrying sweeper cron (R-088, R-181); email-log purge cron (R-172); email test sender in settings (R-090).
- SMS dispatch module reused by P9 notifications (G-021 channel); SMS provider confirmed before P9 (open question).

**Smoke checks**
- Subscribe, change all three preference states through a valid signed token, reject tampered/expired tokens, unsubscribe.
- Draft, preview, test-send, send, list a campaign; rerun send and verify no duplicates.
- Trigger each transactional template from its domain event; force a provider failure, retry it, verify eventual single delivery plus an auditable failure trail.
- Invoke every cron endpoint with missing, wrong, and correct secrets; run overlapping sweeps and confirm one claim per message/job.
- Purge eligible logs without deleting active outbox records or audit evidence; confirm test mode captures instead of contacting providers.

**Merge boundary:** all required messaging is configurable, idempotent, testable, and decoupled from provider outages.

### P12 — Reporting, exports, reconciliation, historical migration, scale hardening, launch readiness

**Source:** arm-01 P10 (reports + migration + final scale pass) + arm-02 P15 + P16 + P17. arm-02 split reports (P15), migration (P16), scale hardening (P17); arm-01 bundled all three into P10. **Decision: arm-01's bundle** — these are the pre-launch acceptance gates; one closing phase hits the ~12-phase target. Internal ordering: reports → migration → scale dress rehearsal.

**Primary IDs:** UR-003 (margin report), UR-014 (legacy cleanup), G-029, R-014, R-063 (reuse), R-091..R-093, R-101..R-103, R-129, R-165, R-185, R-186; G-024 final sweep.

**Deliverables**
- Multi-season performance reports + drill-downs (R-091); **shipping-margin reconciliation view** — charged vs paid per package, season totals (UR-003 report).
- CSV export center + audit history — deliveries, year-end, year metrics, item sales, lapsed customers (R-092); Stripe payment reconciliation — run button + cron + matcher (R-093).
- Documented entity map (legacy → new — R-165); import pipeline for messy legacy export (customers, products, historical orders) with normalization, order-number repair, staged atomic commits + audit (R-186, G-029); address-book cleanup pass (dedupe, validation flags, staff review queue) so repeat-order works year one (UR-014); dry-run mode against disposable DB.
- Load pass at scale baseline (seed 1k orders / 5k packages; verify order list, package board, nightly print batch, route builder, 10 concurrent staff mutations without deadlock — G-024); indexes/query fixes as found.
- Test-environment console (seed/reset/wipe, test-only destructive routes) + test-mode banner + test/live env switch (R-014, R-101, R-103, R-129); staff help center + guided tours (R-102); all 5 Vercel crons registered with secret auth (R-185).
- Full end-to-end dress rehearsal: web order → pay → package → print batch → ship one / deliver one / pickup one → reroute one → reports reconcile.

**Smoke checks**
- Compare every report total and drill-down against a fixed seeded ledger spanning multiple seasons and fulfillment methods; margin report totals match seeded shipments.
- Export each dataset as authorized staff, reject unauthorized access, verify quoting/encoding, audit records, large-result streaming; reconciliation flags an orphaned test PaymentIntent; rerun without duplicate adjustments.
- Dry-run a messy historical fixture (duplicates, malformed contacts, ambiguous recipients, missing products, broken order numbers); correct mappings, import atomically, resume after interruption, reconcile source counts/totals; duplicate customers merged per dedupe rules.
- Repeat an imported prior-year order through the P10 review page.
- Dress rehearsal completes with zero manual DB edits; nightly batch over 5k packages finishes acceptably; wipe + reseed restores a clean test season; every inventory ID is checked off in the coverage ledger.

**Merge boundary:** migration, financial/reporting acceptance, and scale hardening complete the releasable greenfield system.

## 4. Risks / open questions

### Risks (union of arm-01 + arm-02)

- **Package ↔ inventory ↔ payment coupling** (P2): wrong grouping key ripples through printing, shipping, reroute. Mitigation: grouping engine unit-tested before any UI (P2 gate). *(arm-02 risk #1)*
- **Package regrouping after downstream work** (P7/P8/P9): splitting or rerouting after print, label purchase, inventory allocation, or route assignment can orphan artifacts. Use explicit eligibility rules, version checks, compensating label voids, artifact supersession, audit records. *(arm-01)*
- **Payment and fulfillment races** (P5): hosted webhooks, staff edits, stock allocation, refunds, method switches can arrive concurrently. Use idempotency keys, transactions, immutable paid snapshots, conflict responses. *(arm-01)*
- **Margin capture legality/rounding** (P8/UR-003): quoting two carriers with different service levels — which services count as comparable? Plan assumes cheapest ground-equivalent on each carrier. *(arm-02 risk #2)*
- **Shippo test accounts** (P8): negotiated FedEx/UPS rates aren't reproducible in test mode; margin math validated with mocked rate tables plus one live smoke. *(arm-02 risk #3)*
- **Print scale and correctness** (P7/P12): thousands of packages can create oversized PDFs or duplicate filing. Partition by filing group, stream generation, persist batch membership, reprints supersede rather than mutate. *(arm-01)*
- **Magic-link leakage** (P9): forwarded links expose route PII until expiry. Store only hashed tokens, scope every read/mutation to one route, throttle PIN attempts, minimize stop data, expire on completion, audit use. *(arm-01)*
- **Migration quality** (P12/UR-014/G-029): messy contacts and recipient identity ambiguity can create duplicate address books and bad repeats. Dry-run reports, human mapping for ambiguous rows, reversible batches, staff review queue, source-to-target reconciliation. *(arm-01 + arm-02)*
- **Repeat-order year-one depends on P12** finishing before season open — migration is deliberately late (needs stable schema) but must precede launch. *(arm-02 risk #8)*
- **Provider outages** (P5/P8/P11): Stripe, Shippo, Mapbox, Resend, SMS, Blob can fail during crunch. Keep paid/order state durable, queue retryable side effects, make optional-provider failures visible, preserve print/manual fallbacks. *(arm-01)*
- **Crunch load** (P6/P12): broad admin queries, map geocoding, PDF generation, bulk updates contend. Indexes, pagination, bounded jobs, cached geocodes, chunked batches, conflict-aware mutations from the first phase. *(arm-01)*

### Open questions requiring configuration or a later product decision (union)

1. **SMS provider** (arm-02 risk #4) — only unforced stack item; assumed Twilio-class single provider. Confirm before P9 notifications go live.
2. **Filing-group key + sort order** for nightly PDFs (arm-01 Q2).
3. **Magic-link grace duration** after route completion (arm-02 risk #5; resolution 4 "optional short grace") — default proposed 2 hours, manager-configurable. PIN per-route or global manager setting? (arm-01 Q3).
4. **Shippo service levels** eligible for high-quote/low-purchase comparison; staff action when only one valid quote exists or a quote expires before label purchase (arm-01 Q4).
5. **Historical migration source** — files, columns, encoding, authoritative dedupe keys (arm-01 Q5).
6. **Retention periods** for route-link audits, transactional message logs, exports, imported source snapshots (arm-01 Q6).
7. **Seasonal auto-flip timezone** (UR-008) — assumed org-local; confirm (arm-02 risk #9).

## Coverage ledger

- **Baseline (R-001..R-192):** all 192 rows assigned across P1..P12. P1: R-010, R-098..R-100, R-104, R-107..R-120, R-130, R-131, R-133, R-135, R-136, R-161, R-164, R-187..R-192. P2: R-044..R-047, R-144..R-160, R-162, R-163. P3: R-001..R-018, R-065..R-067, R-094, R-096, R-097, R-128, R-146..R-148, R-180. P4: R-019..R-031, R-038..R-043, R-114. P5: R-023, R-032..R-037, R-121..R-127, R-132, R-149..R-152, R-159, R-160, R-166..R-170. P6: R-049, R-050, R-052..R-054, R-057, R-059..R-064, R-092, R-094..R-096, R-105, R-106, R-143. P7: R-056, R-072, R-073. P8: R-055, R-081, R-173..R-177, R-183, R-184. P9: R-074..R-080, R-116, R-179, R-182. P10: R-041, R-048, R-057, R-058, R-097. P11: R-082..R-090, R-163, R-171, R-172, R-178, R-181, R-185, R-087. P12: R-014, R-063, R-091..R-093, R-101..R-103, R-129, R-165, R-186.
- **User resolutions (UR-001..UR-016):** all 16 primary-scoped. P1: UR-012. P2: UR-001 (schema), UR-008 (model), UR-016 (schema). P3: UR-008 (browse/gate). P4: UR-006, UR-014. P5: UR-009, UR-011 (web), UR-013 (capture). P6: UR-006 (POS parity), UR-011 (POS). P7: UR-001 (UI), UR-005, UR-013 (PDF). P8: UR-003. P9: UR-002, UR-004, UR-010, UR-015. P10: UR-007, UR-008 (management). P12: UR-003 (report), UR-014 (cleanup).
- **Grill union (G-001..G-030):** all 30 primary-scoped. P1: G-016, G-024 (base). P2: G-003, G-009 (base). P3: G-022. P4: G-018, G-019. P5: G-007, G-014, G-015, G-020, G-028. P7: G-001..G-004, G-021 (card). P8: G-006. P9: G-005, G-017, G-023, G-025..G-027, G-030. P10: G-011..G-013. P11: G-021 (channel). P12: G-024 (final), G-029.
- Cross-phase IDs in phase bodies identify integration acceptance checks; the primary allocations above are exhaustive and non-duplicative.

## Merge decisions summary (arm-01 vs arm-02)

| # | Topic | arm-01 | arm-02 | Merged choice | Phase |
|---|---|---|---|---|---|
| 1 | Foundation vs identity split | Bundled in P1 | Split P1/P2 | arm-02 split (foundation + identity merged into one P1; schema separate) | P1 |
| 2 | Domain schema placement | Bundled in P1 | Separate P3 | arm-02 (schema-first P2; grouping engine unit-tested before UI) | P2 |
| 3 | Season management + wizard | In storefront P2 | Deferred to P13 | arm-02 deferral (with repeat/replacement in P10) | P3 gate + P10 |
| 4 | Repeat order placement | In cart P3 | Separate P13 | arm-02 split (repeat needs replacement mappings + prior-year data) | P10 |
| 5 | Live shipping rates | In checkout P4 | Placeholder in P6, live in P8 | arm-02 placeholder (isolate margin engine) | P5 + P8 |
| 6 | Staff account mgmt + test-mode + help | Bundled in admin P5 | Staff mgmt in P2; test-ops/help in P17 | arm-02 split (staff mgmt in P1; test-ops/help in P12) | P1 + P12 |
| 7 | Package engine + shipping + reroute | One P7 | Split P7/P8/P9 | arm-02 split (package engine P7, shipping P8; reroute folded into delivery P9) | P7, P8, P9 |
| 8 | Routes/driver/reroute vs pickup/bulk | One P8 | Split P9/P10 | arm-01 combination (operationally intertwined) | P9 |
| 9 | Reports + migration + scale hardening | One P10 | Split P15/P16/P17 | arm-01 bundle (pre-launch acceptance gates) | P12 |
| 10 | SMS provider | Open question | Twilio-class assumed | arm-02 default; confirm before P9 | P9/P11 |

**Final phase count: 12.** Orchestrator may cut equal phase map against P1..P12.
