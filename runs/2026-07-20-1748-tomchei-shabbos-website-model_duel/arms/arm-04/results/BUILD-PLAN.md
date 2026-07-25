# Greenfield build plan — arm-04

**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Arm:** `arm-04` (late join) · web port **3104** · db port **4104**
**Only input:** `shared/USER-RESOLVED-INVENTORY.md` (with `R-###` rows resolved via `shared/RECONCILED-INVENTORY.md`)
**Phases:** 16 (P0–P15)

Nothing here is invented. Every deliverable traces to a `UR-`, `G-`, `R-`, or a numbered user resolution (1–8b) from the frozen inventory. Where the inventory is silent I say so in Risks instead of guessing.

---

## 1. Goals / non-goals

### Goals

1. Rebuild the ordering, fulfillment, and back-office system for a seasonal Tomchei Shabbos package operation, greenfield, keeping all 192 reconciled capabilities unless an `UR-` row overrides them.
2. Make the **physical package (box)** the unit of work: grouping, splitting, per-package status, printing, rerouting (UR-001, G-003, G-004, user resolution 3).
3. Let staff move an order between shipping and volunteer delivery without touching what the customer paid (UR-002, user resolution 1).
4. Capture the carrier rate spread: quote FedEx/UPS (USPS where applicable), charge the higher, ship the cheaper (UR-003, G-006, user resolution 2).
5. Run the Purim-week crunch at 1,000+ orders / 5,000+ packages / 10+ concurrent staff with batch tools and concurrency safety from day one (G-024, scale baseline).
6. Print-first operations: nightly per-filing-group PDFs, card stock separate, reprint by group or order; printing never means shipped (UR-005, G-001, G-002).
7. Cart-first order entry with a three-way recipient picker, identical on web and POS, feeding one address book per customer (UR-006, UR-014, G-018, G-019).
8. Year-over-year repeat ordering with admin-defined replacement mappings and a confirm page for both items and recipients (UR-007, G-011, G-012, G-013).
9. Drivers get a mobile route page behind an unguessable expiring link with optional PIN, plus a printed fallback (UR-015, G-025, user resolution 4).
10. Managers control seasons, permissions, delivery days, and whether ingredient tracking is on (UR-008, UR-012, UR-009, UR-016).

### Non-goals (explicit, from the inventory's "Out of scope / deferred")

- Embedded Stripe Elements card forms on-site. Hosted Checkout redirect only; `@stripe/stripe-js` and `@stripe/react-stripe-js` are **not** installed (R-166, user resolution 8b).
- Ingredient/BOM **UI**. Schema ships, screens stay hidden until a manager enables them (UR-016, G-009, user resolution 7).
- Customer-chosen delivery appointment slots (bulk or per-package) — rejected in grill.
- Manager override for out-of-area per-package delivery — the ZIP block is hard (G-014).
- Automatic map reroute without a manager confirming (G-023, UR-004).
- Embedded Google Maps API. Drivers get free deep links only (G-030, user resolution 5).
- Storing website customers in the staff roles table (user resolution 8a).

---

## 2. Stack proposal

The inventory's evidence paths name most of this outright; those are marked **forced**. Where I had a choice, the ponytail ladder applies — no package unless the platform can't do it.

| Layer | Choice | Why / forced? |
|---|---|---|
| Framework | Next.js App Router + TypeScript, route groups `(storefront)` `(admin)` `(driver)` | **Forced** — R-001…R-192 evidence paths are `src/app/(storefront)/…`, `src/app/(admin)/…`, server actions, `next.config.ts` |
| DB | Postgres + Prisma, ordered migrations | **Forced** — R-137, R-138, R-140 |
| Auth (staff + customers) | Clerk, middleware-gated | **Forced** — R-107, R-108. Staff roles live in our own table (user resolution 8a); Clerk only supplies identity |
| Driver auth | Signed, expiring route-link token + optional 4-digit PIN, stored server-side | **Forced by resolution 4**; built with Node `crypto` HMAC, no new dep |
| Payments | Stripe hosted Checkout + webhooks, immediate capture | **Forced** — R-166, R-167, UR-011, resolution 8b |
| Shipping | Shippo SDK against the org's FedEx + UPS accounts | **Forced** — R-173, resolution 6 |
| Maps | Mapbox geocode + admin map; `https://www.google.com/maps/dir/?api=1&destination=…` deep links for drivers | **Forced** — R-179, resolution 5 |
| Email | Resend behind a transactional outbox with a retrying cron sweeper | **Forced** — R-171, R-088 |
| SMS | One provider behind a `sendSms()` port, mirroring the email outbox | Inventory requires SMS (G-021 bulk notify, resolution 4 PIN text) but names **no vendor** — see Risk R-4 |
| Files | Vercel Blob for media | **Forced** — R-180 |
| UI | Tailwind + shadcn-style kit + design tokens | **Forced** — R-188, R-189, R-190 |
| PDFs | Server-rendered HTML print routes with `@media print`, browser print dialog | Not forced. R-056/R-075/R-076 are `print/page.tsx` routes, so the existing pattern is HTML print. Zero new deps. Revisit only if nightly batch volume (UR-005) makes browser printing impractical — see Risk R-2 |
| Money | Integer cents everywhere, one `money` helper | **Forced** — R-164; margin math (UR-003) must not drift on floats |
| Background work | Vercel Cron with bearer-secret auth + a job run log | **Forced** — R-185, R-124, R-163 |
| Errors | One `Result` type for server actions, masked in production | **Forced** — R-136, R-164 |

**Local config:** app on `http://localhost:3104`, Postgres on `localhost:4104` (`DATABASE_URL=postgresql://…@localhost:4104/tomchei`). Stripe and Shippo webhooks point at `:3104` via tunnel in dev. Env vars are validated at startup against a schema, with a generated `.env.example` (R-131).

**One pattern per concern** (clean-code): server actions for mutations, `Result` for errors, Prisma for all data access, Tailwind + tokens for styling, Zod for every trust-boundary parse.

---

## 3. Phases

Each phase lists the IDs it covers, what ships, and the smoke checks that must pass in the running app before the gate closes. A phase is not done until every smoke check has evidence (route opened, control clicked, value seen).

### P0 — Repo, schema spine, platform guardrails

**IDs:** R-131, R-133, R-136, R-137, R-138, R-140, R-141, R-142, R-161, R-163, R-164, R-187, R-188, R-189, R-190, R-191, R-192

**Deliverables**
- Next.js + TypeScript app on port 3104; Postgres on 4104 via docker compose.
- Prisma baseline migration: core enums, lifecycle enums, ordered `prisma/migrations/`.
- Startup env validation + generated `.env.example`; no secret has a default.
- Helper libs: money (cents), phone normalize, ids, season, dates, `Result`.
- Typed key-value settings registry (R-161) and a cron/job run log table (R-163).
- shadcn-style UI kit, custom primitives (confirm dialog, empty state, FAB, page header, price tag, callout), design tokens, brand constants, marketing image assets.
- Global error page + root layout with bounded client-error reporting.
- CI: schema-change-needs-migration guard, security guardrail workflow, disposable migration verification harness, repeatable baseline seed.

**Smoke checks**
1. `http://localhost:3104` renders the shell with tokens applied.
2. `/api/health` returns DB reachable + env valid.
3. Deleting a required env var makes the app refuse to boot with a named-variable error.
4. `prisma migrate reset` + seed produces a working baseline; migration harness passes on a throwaway DB.
5. Editing `schema.prisma` without a migration fails CI locally.
6. Forcing a server error shows the masked global error page and writes one client-error record.

---

### P1 — Identity, staff roles, permissions, audit

**IDs:** R-010, R-051, R-098, R-099, R-100, R-104, R-105, R-106, R-107, R-108, R-109, R-110, R-111, R-112, R-113, R-114, R-115, R-117, R-118, R-119, R-120, R-130, R-135 · UR-012, G-016 · resolution 8a

**Deliverables**
- Clerk middleware, sign-in/sign-up routes.
- **Staff roles = Manager / Staff / Driver only.** Customers are a separate table with their own accounts; the R-109 conflict (six-role permissions layer vs five-role enum) is resolved in favor of resolution 8a — no customer row in staff roles.
- Per-user permission grants/denies over role defaults, with a manager-facing override editor (UR-012).
- `requirePermission()` server gate used by every admin action; `canDrive` carve-out for driver-route permissions.
- Staff confirmation + revocation gate, invitation identity linking, customer identity linking with ownership-enforced profile writes.
- Admin and driver application gates; "must be staff" hard guard.
- Staff management hardening: cannot demote/disable yourself, cannot escalate past your own rank.
- Impersonation with a persistent banner and audit entry.
- Security audit trail + session login stamp; admin activity log page.
- Admin shell: permission-gated sidebar, mobile nav, shared list controls (search, pagination, page size, sortable/responsive tables, status badges), chrome links.
- First-run setup page usable only while the staff table is empty, then locked out.
- Permission unit tests.

**Smoke checks**
1. Empty DB → `/setup` creates the first Manager; revisiting `/setup` after that is refused.
2. Staff user without `manage_users` gets 403 on the users page and the sidebar link is absent.
3. Manager denies one permission for one Staff user; that user's action fails server-side even when the URL is typed directly.
4. Revoked staff member is bounced at the admin gate on next request.
5. Impersonation shows the banner, and the audit log records start and stop with both user ids.
6. A Manager cannot remove their own Manager role.
7. Permission tests green.

---

### P2 — Domain data model (customers, seasons, catalog, orders, **packages**, inventory, payments)

**IDs:** R-139, R-144, R-145, R-146, R-147, R-148, R-149, R-150, R-151, R-152, R-153, R-154, R-155, R-156, R-157, R-158, R-159, R-160, R-162 · UR-001 (schema), UR-008 (schema), UR-016 (schema), G-009

**Deliverables**
- Customers with normalized phone/email + dedupe keys; saved addresses with geocode fields (one address book per customer, UR-014 schema half).
- Season model gating catalog per year, with cross-season replacement links (UR-008 schema).
- Products (dims, inventory flags, kinds), product options with price adjustments, add-ons.
- Order tree: Order → OrderLine → add-ons, price snapshots on lines, sequential order numbers per season, cached derived payment status.
- Fulfillment groups with destination snapshots, data-driven fulfillment methods, pickup locations, shipping quotes with expiring selectable options, package types and shipment boxes.
- **Package entity (UR-001):** rows for physical boxes, each linked to an order and a fulfillment group, carrying recipient/address/method/greeting grouping key, split lineage, stage (`New → Printed → Packed → Sent/PickedUp`), print batch ref, route stop ref, label ref. Stages are optional per the inventory — a package can go New → Sent.
- Unified versioned inventory over products + add-ons; XOR check constraints on inventory targets.
- **BOM + assembly-batch tables ship now, no UI** (UR-016, G-009): ingredient, recipe line, assembly batch, batch consumption. Gated by a settings flag defaulting off.
- Stripe PaymentIntent modeling; payments in stripe/cash/check/comp with posted/voided states.
- Geocode cache with separate success/failure TTLs.
- Concurrency-safety decisions written down: row-level locks for stock moves and order-number issuance (G-024).

**Smoke checks**
1. Migration applies clean and reverses on the harness DB.
2. Seed creates two seasons, a catalog, customers with addresses, and one order with three packages.
3. Inserting an inventory row targeting both a product and an add-on is rejected by the CHECK constraint.
4. Two concurrent order finalizations produce two distinct sequential numbers (scripted).
5. BOM tables exist and the ingredient-tracking setting reads `false`.
6. Splitting a package in a SQL fixture preserves the parent link and order total.

---

### P3 — Storefront: browsing, marketing, season gate, email capture

**IDs:** R-001, R-002, R-003, R-004, R-005, R-006, R-007, R-008, R-009, R-011, R-012, R-013, R-014, R-015, R-016, R-017, R-018, R-122, R-123 · UR-008 (browse/archive), G-022

**Deliverables**
- Mission-led homepage: impact-stats bar, How It Works, mission, testimonials, final CTA.
- Store-open-aware CTAs with server-side closure enforcement on order and checkout routes, plus the storewide closed banner (manager Open/Closed from UR-008).
- Current-season catalog grid with category filters, price sorting, sold-out handling, quick-view dialog, loading state.
- Package detail with option pricing.
- **Off-season archive browsing across all years, no checkout** (UR-008, G-022) — the public past-collections view.
- Storefront shell: sticky header, desktop nav, mobile menu, user menu, footer with email signup; test-mode banner.
- Newsletter subscribe with three preference options and tokenized unsubscribe (HMAC, timing-safe compare).
- Public JSON endpoints behind the shared guard: same-origin check, IP rate limit, Zod parse.

**Smoke checks**
1. Store closed → homepage CTA reads closed, `/order` and `/checkout` redirect, banner shows sitewide.
2. Store open → catalog lists only current-season products; a sold-out product cannot be added.
3. Category filter and price sort change the visible grid; quick view opens and closes.
4. Archive page lists a prior season with no add-to-cart control anywhere on it.
5. Subscribe → row created; unsubscribe link with a tampered token is rejected; the valid token saves the chosen preference.
6. Hammering `/api/subscribe` past the limit returns 429.

---

### P4 — Cart-first order entry + address book (web and POS, one shell)

**IDs:** R-019, R-020, R-021, R-022, R-023, R-024, R-025, R-026, R-027, R-028, R-029, R-030, R-031 · UR-006, UR-014, G-018, G-019

**Deliverables**
- **Cart first, recipients second** (UR-006): browse catalog, add with quantity, then assign each line to one of three targets — already on the order, from the address book, or a brand-new recipient.
- New recipients auto-save to the customer's address book (G-019); staff edits to address-book entries are audited (UR-014).
- One shared builder shell used by storefront and POS so the UX matches (R-031, UR-006).
- Product panel, product cards, in-builder quick view, restricted add-ons, product options.
- Live-stock aware selection with soft reservation while the draft is open.
- Autosave drafts with resume; guest drafts cleared on success; guest access tokens for later retrieval.
- Saved-address reuse, edit-saved-address dialog, address autocomplete with server-side validation.
- Desktop order sidebar + mobile cart FAB with running totals.

**Smoke checks**
1. Add three items, assign one to an existing recipient, one to an address-book pick, one to a new address; all three appear on the draft.
2. The new address shows in `/account/addresses` afterwards without a second save step.
3. Refresh mid-build → draft restores with the same lines and assignments.
4. Reduce stock below the drafted quantity in another tab → the builder flags it before checkout.
5. POS builder at `/admin/pos` renders the same shell and completes the same three-way assignment.
6. Staff edit of an address-book entry writes an audit row naming the staff user.

---

### P5 — Checkout, pricing, payments, order lifecycle, POS tender, customer account

**IDs:** R-032, R-033, R-034, R-035, R-036, R-037, R-038, R-039, R-040, R-042, R-043, R-044, R-045, R-046, R-047, R-054, R-059, R-060, R-061, R-121, R-125, R-126, R-127, R-166, R-167, R-168, R-169, R-170 · UR-009 (fees + ZIP block + Purim-week days), UR-011, G-007, G-014, G-015, G-028 · resolution 8b

**Deliverables**
- Checkout: recipient/donation summary, per-recipient delivery selection, bulk option, live shipping quotes, guest email, conflict and price-change UI.
- Fulfillment method selection with rate resolution and the rule engine.
- **Delivery fee rules (UR-009, G-015):** bulk = one fee per destination; per-package = one fee per recipient.
- **ZIP hard block (G-014):** an out-of-area address cannot pick per-package delivery, with no manager override path.
- **Manager-set Purim-week delivery days** selectable at checkout (UR-009).
- Stock + price validation at submit; payment recalculation when an order changes later.
- **Stripe hosted Checkout redirect, immediate capture** (UR-011, G-007, resolution 8b). No client Stripe packages in `package.json`. Webhook with signature verification and idempotency; refund sync; automatic safety refund on stale or failed fulfillment; server-enforced charged-amount check.
- Refunds including the Stripe refund path.
- **POS: check and cash tender with staff attribution and audit** (G-028, UR-011); server-enforced offline payment policy so offline tender needs the permission.
- POS customer lookup, preselection, find-or-create.
- Order state machine + transitions, finalization (draft → placed, claims number), draft discard, draft reference numbers and wire format.
- Draft-order ownership gate with anti-enumeration behavior.
- Customer account: dashboard with auth-gated nav, order history + detail, continue/pay/cancel a draft, profile management, saved-address view.
- Checkout success experience.

**Smoke checks**
1. Web order → Stripe hosted page → return to success → order is `paid` with captured amount matching cents-exact total.
2. Webhook replay of the same event changes nothing (idempotency row hit).
3. Out-of-area ZIP: per-package delivery is unavailable and a forged POST is rejected server-side.
4. Bulk delivery to one destination with four recipients charges one delivery fee; per-package charges four.
5. Purim-week day picker offers only the days the manager configured.
6. POS check payment records tender type, amount, and the staff user; a staff member lacking the offline-payment permission is refused.
7. Guessing another customer's draft URL returns not-found, not a permission hint.
8. Refund from admin posts to Stripe and the order's payment status updates from the webhook.
9. `package.json` contains no `@stripe/stripe-js` or `@stripe/react-stripe-js`.

---

### P6 — Shipping: rate shop, **margin capture**, Shippo labels, packing

**IDs:** R-055, R-081, R-095, R-173, R-174, R-175, R-176, R-177, R-183, R-184 · UR-003, G-006 · resolutions 2 and 6

**Deliverables**
- Shippo SDK wrapper: rate, buy, void, track, validate; typed optional-provider handling so a missing key degrades loudly, not silently.
- Org FedEx + UPS accounts connected through Shippo for negotiated rates; USPS quoted where applicable. UPS direct credentials stay declared-not-implemented (R-184) — Shippo is the path.
- **Margin capture (UR-003, resolution 2):** persist every quote; charge the customer the **higher** carrier rate; buy the label on the **cheaper** carrier; store `chargedRateCents`, `purchasedRateCents`, and the derived `marginCents` on the package for internal reconciliation. Margin is never shown to the customer.
- Bin packing + shipment planning from package dimensions to boxes.
- Label creation and voiding from the admin order/package view; failure compensation so a failed buy never leaves a phantom label; tracking refresh; address validation.
- Settings → Shipping tab: rates, rule engine config, delivery ZIP list.

**Smoke checks**
1. A quote returning FedEx $12.40 / UPS $14.10 charges the customer $14.10 and buys the FedEx label; the package row shows margin $1.70.
2. Voiding a purchased label flips package state and records the void; the margin row is reversed.
3. Simulated Shippo buy failure leaves no label reference and surfaces a named error.
4. Tracking refresh updates the stored status.
5. Manager edits the delivery ZIP list; checkout immediately honors the new list.
6. Missing Shippo key → rate call fails with a clear provider-not-configured message, not a crash.

---

### P7 — Package operations hub: grouping, splitting, **method switch with charge preserved**

**IDs:** R-049, R-050, R-052, R-053, R-072, R-073 · UR-001, UR-002, G-001, G-003, G-004, G-005, G-024 · resolutions 1 and 3

**Deliverables**
- **Default grouping (UR-001, G-003):** lines combine into one package when recipient, address, fulfillment method, and greeting all match. Staff can split a package into two, choosing which lines go where; split preserves the order link and the paid charge.
- Per-package status and per-package printing, independent of order status (G-004).
- Hybrid fulfillment stages: print-first, with the optional digital stages `New → Printed → Packed → Sent/PickedUp` toggled per operation (G-001).
- **Method switch (UR-002, G-005, resolution 1):** staff move a package between shipping and volunteer delivery. The customer's paid delivery/shipping charge does not change — no refund, no extra collection. Every switch writes who, when, from, to, and the untouched charge amount.
- Fulfillment channel dashboard with bulk status actions across channels; production and savings summaries (savings = charge preserved minus actual cost, the org's kept spread).
- Permission-aware admin dashboard with KPIs and recent orders; daily "Today" work queue.
- Searchable, filterable order list; full admin order detail with money actions.
- Crunch-scale behavior: server-side pagination everywhere, bulk actions chunked and idempotent, optimistic-lock guard so two staff acting on one package cannot double-apply (G-024).

**Smoke checks**
1. An order with two lines to the same recipient/address/method/greeting yields one package; changing one greeting yields two.
2. Split a 4-item package into 3+1; both packages keep the order link and the order total is unchanged.
3. Switch a shipping package to delivery: customer paid amount is byte-identical before and after; audit row names the staff user and both methods.
4. Bulk-mark 200 packages Printed from the channel dashboard; all 200 move and the order list still paginates under a second.
5. Two browser tabs switching the same package: the second gets a stale-state error, not a silent overwrite.
6. "Today" queue shows the packages actually due today.

---

### P8 — Nightly print batches, packing slips, greeting cards

**IDs:** R-056, R-076 · UR-005, UR-013, G-002, G-020, G-021

**Deliverables**
- **Nightly print batch (UR-005):** one run produces a **separate PDF per filing group** so several people print and file in parallel. Reprint by group or by single order without re-running the batch.
- **Print ≠ shipped (G-002, UR-001):** printing slips, labels, or cards marks packages `Printed` and nothing further.
- Printable packing slips per order and per package.
- **Greeting cards (UR-013, G-021):** an order-level default greeting with per-recipient overrides; the last greeting used for a recipient is remembered and pre-filled next time (G-020). Card stock renders as its **own** PDF per filing group, separate from slips, because the paper differs.
- Greeting-card print view per route (for delivery packages).

**Smoke checks**
1. Run the nightly batch on seeded data → one PDF per filing group, each containing only its group's packages, plus a separate card-stock PDF set.
2. All batched packages read `Printed`; none read `Sent`.
3. Reprint a single order → correct one-order document, no state change beyond a reprint log entry.
4. Set an order default greeting, override one recipient → the override prints for that recipient and the default for the rest.
5. Order for a recipient who had a greeting last season pre-fills that greeting.
6. Card PDF and slip PDF are separate files.

---

### P9 — Routes, Mapbox reroute, driver experience

**IDs:** R-074, R-075, R-077, R-078, R-116, R-134, R-179 · UR-004, UR-015, G-023, G-025, G-027, G-030 · resolutions 4 and 5, plus the G-027 nearby-radius default

**Deliverables**
- Route builder on Mapbox with geocoding + cache, coordinate refresh endpoint (staff-guarded).
- Route administration: list, detail, reassign driver, print route sheet.
- **Map reroute (UR-004, G-023):** the map shows this route's delivery stops **and** nearby unshipped shipping packages — within roughly 0.5 mile or the same street cluster. The manager must confirm each suggestion; nothing switches automatically. On confirm: void the Shippo label if it was printed-but-not-shipped, add the stop to the route, and update the affected print batch. The customer's charge is untouched (UR-002).
- **Per-package delivery days (G-027, UR-009):** staff route packages onto the manager-configured days; a day-of notification fires when the route is started.
- **Driver access (UR-015, G-025, resolution 4):** unguessable per-route magic link showing **only that route's stops**; expires when the route is marked complete with a short grace window; optional 4-digit PIN a manager texts the driver; every "Delivered" tap writes an audit row with time and route-link id. Route ownership scoping is enforced server-side, so a driver holding link A cannot read route B.
- Driver stop cards with start-route and deliver actions; **"Open in Google Maps" deep link per stop** for turn-by-turn (G-030, resolution 5). No embedded Google Maps.
- Printed route sheet as the offline fallback.

**Smoke checks**
1. Build a route from delivery packages; stops appear in map order and the printed sheet matches.
2. Map shows an unshipped shipping package ~0.3 mile from a stop as a suggestion; a package 5 miles away is not suggested.
3. Confirm the suggestion → Shippo label voided, stop added, print batch updated, paid charge unchanged. Nothing changes without the confirm click.
4. Driver link opens the route on a phone viewport with no login; swapping the route id in the URL returns not-found.
5. With PIN enabled, a wrong PIN is refused and a correct one opens the route.
6. Mark route complete → the link stops working after the grace window.
7. Each "Delivered" tap writes an audit row with timestamp and link id.
8. Stop's Google Maps link opens directions to that address.
9. Starting the route sends the day-of notification to that day's recipients.

---

### P10 — Pickup, bulk delivery scheduling, follow-up

**IDs:** R-079, R-080, R-182 · UR-009 (bulk), UR-010, G-017, G-026, G-021 (notification channel)

**Deliverables**
- **Pickup (UR-010, G-026):** an order is pickup-eligible only when its inventory is actually available; a ready-for-pickup notification fires; staff work a door list and stamp picked-up; an unclaimed-pickup report lists what is still sitting there.
- **Bulk delivery (UR-009, G-017):** staff assign the date and window per destination; the customer is notified by **email and SMS** when that happens (orchestrator default for G-021's channel question).
- Follow-up call center: filterable list of orders needing a human call.
- Automated payment reminders and pickup-expiry crons, both behind the bearer-secret gate.

**Smoke checks**
1. An order short on stock shows no pickup option; restock and it appears.
2. Mark ready → notification recorded in the outbox for that customer.
3. Door list shows today's pickups; stamping picked-up removes it from the list and stamps who and when.
4. Unclaimed report lists an order past its window.
5. Assign a bulk delivery date/window → email and SMS both queued.
6. Pickup-expiry cron without the bearer secret returns 401; with it, it processes and writes a job-run row.

---

### P11 — Inventory and production

**IDs:** R-068, R-069, R-070, R-071 · UR-016, G-008, G-009, G-010

**Deliverables**
- **Finished-package inventory as the v1 primary** (UR-016, G-008): counts of assembled packages, on hand vs reserved vs allocated.
- Reserve / allocate / release engine wired to drafts, finalization, and cancellation, with row-level locking under concurrency (G-024).
- Inventory overview dashboard with tabs; adjustments, write-offs, and a shortfall view.
- Production batch planning + history.
- **Assembly batches consume supplies and produce finished stock** (G-010). With ingredient tracking off, a batch simply adds finished units; with the manager flag on, it also decrements ingredients through the BOM built in P2. **The ingredient UI stays hidden until that flag is on** (G-009, resolution 7).

**Smoke checks**
1. Draft reserves stock; abandoning the draft releases it; finalizing allocates it.
2. Two concurrent finalizations for the last unit: one succeeds, one gets a clean out-of-stock error, and the count never goes negative.
3. Write-off reduces on-hand and appears in history with a reason.
4. Shortfall view flags a product with more allocated than on hand.
5. Production batch of 50 raises finished stock by 50.
6. Ingredient tracking off → no ingredient UI anywhere in admin. Flip the manager setting → ingredient screens appear and a batch decrements ingredients per BOM.

---

### P12 — Seasons, repeat orders, replacement mappings

**IDs:** R-041, R-048, R-057, R-058, R-097 · UR-007, UR-008, G-011, G-012, G-013, G-022

**Deliverables**
- Season lifecycle: per-year catalog, manager Open/Closed switch, and an **optional scheduled auto flip** (UR-008). New-season setup wizard.
- Admin replacement mappings per catalog item, editable from the product detail page; cross-season replacement chain resolution (G-013, R-048).
- **Repeat order (UR-007, G-011):** copy a prior year's order into a draft, then a middle review page that confirms **both** item replacements **and** recipients before the draft is accepted.
- **Price-smart defaults (UR-007, G-012):** suggest the replacement nearest in price; an item with no mapping must be explicitly picked or removed — it cannot silently vanish.
- Staff single-order repeat and bulk repeat across a customer's history.
- Off-season archive stays browsable for all years (G-022, wired in P3).

**Smoke checks**
1. Map last year's product A to this year's product B; a repeat of an order containing A proposes B.
2. An unmapped item blocks continue until picked or removed.
3. Two candidate replacements → the closer-priced one is preselected.
4. Review page lists recipients from last year; deselecting one keeps it out of the draft.
5. Bulk repeat over a customer with three prior orders creates three drafts, none finalized.
6. Manager closes the season → storefront ordering stops, archive still browsable. Scheduled flip fires at the configured time.

---

### P13 — Admin catalog, customers, media, email and marketing

**IDs:** R-062, R-063, R-064, R-065, R-066, R-067, R-082, R-083, R-084, R-085, R-086, R-087, R-088, R-089, R-090, R-128, R-171, R-172, R-178, R-180, R-181

**Deliverables**
- Product catalog management: list, create, edit, detail, season select. Add-on catalog management.
- Customer directory with search and add; customer detail with full history; find-or-create endpoint shared with POS.
- Staged atomic CSV import for customers and products (the engine; the messy legacy run is P15).
- Media library on Vercel Blob with photo assignment, a needs-photos panel, and restricted, validated uploads (type and size checked server-side).
- Email hub with its five tabs: campaigns list and lifecycle, campaign builder with blocks and send, subscriber and mailing-list management, templates with branding, triggered/transactional overrides.
- Order lifecycle emails: confirmation, payment link, refund; shared summary HTML.
- Transactional outbox with a retrying sweeper cron and idempotent sends with test capture; email-log purge cron; test-email sender in settings.

**Smoke checks**
1. Create a product with options and an add-on; both appear in the storefront catalog for the open season.
2. CSV import of 500 customers commits atomically; a file with one bad row commits nothing and reports the row number.
3. Upload a `.exe` renamed to `.jpg` → rejected server-side.
4. Send a campaign to a two-person test list; both land in the log, unsubscribed addresses are skipped.
5. Kill the email provider mid-send → the outbox retries on the next sweep and does not double-send.
6. Placing an order queues exactly one confirmation email.

---

### P14 — Reports, exports, reconciliation, settings, help, test-mode ops

**IDs:** R-091, R-092, R-093, R-094, R-096, R-101, R-102, R-103, R-124, R-129, R-132, R-185

**Deliverables**
- Multi-season performance reports with drill-downs.
- CSV export center with audit history: deliveries, year-end, year metrics, item sales, lapsed customers.
- Stripe payment reconciliation, on demand and on a cron, with a matcher and a mismatch list. Extended to cover the UR-003 margin ledger so charged-vs-purchased spread reconciles against Stripe and Shippo.
- Settings hub: Orders tab (store status, package types, pickup locations, follow-up), Email tab, Developer tab. (Shipping tab shipped in P6.)
- Staff help center with articles and guided tours.
- Test/live environment switch; test-environment operations console with seed, reset, and clear-emails; those destructive endpoints exist **only** outside production and are permission-gated.
- All five crons behind bearer-secret auth, each writing a job-run row. Bounded, redacted client-error ingestion.

**Smoke checks**
1. Reports show two seasons side by side; a drill-down opens the underlying orders.
2. Each of the five exports downloads a CSV with headers, and the export is logged with the requesting user.
3. Reconciliation run against a seeded mismatch lists it; the margin column matches the P6 package rows.
4. Toggle store status in settings → the storefront banner changes without a redeploy.
5. Destructive test-mode endpoints return 404 when the environment is production.
6. Every cron rejects a missing or wrong bearer secret and logs a run row when it succeeds.
7. Guided tour runs end to end on the admin dashboard.

---

### P15 — Legacy data migration and crunch-scale hardening

**IDs:** R-063, R-143, R-165, R-186 · UR-014, G-024, G-029

**Deliverables**
- **Legacy migration (G-029, UR-014):** documented entity map from the old export to the new schema, then the actual pipeline — Nexternal-style Excel/CSV readers for customers, products, and historical orders, plus order-number repair.
- **Address-book cleanup before year-one repeat ordering** (UR-014): dedupe by normalized phone/email/address, a staff review queue for ambiguous merges, and a dry-run report. Repeat ordering is only trustworthy if this runs first, so it gates P12's first live use.
- Auditable staged import pipeline with atomic commits and a reversible batch record.
- Load rehearsal at the stated baseline: 1,000 orders / 5,000 packages / 10 concurrent staff (G-024). Index review, N+1 elimination on the order and package lists, chunked bulk actions, print batch timing.

**Smoke checks**
1. Dry run over the messy export reports counts and every rejected row with a reason; nothing is written.
2. Committed import creates customers, products, and historical orders with the original order numbers preserved or repaired per the rule.
3. Dedupe merges two obvious duplicates and routes an ambiguous pair to the review queue instead of guessing.
4. A repeat order built on migrated history resolves to real address-book entries.
5. Seeded 5,000 packages: order list, fulfillment dashboard, and route builder each respond under two seconds.
6. Ten simulated concurrent staff running bulk status actions produce no lost updates and no negative stock.
7. Nightly print batch over 5,000 packages completes and produces the right per-group file set.

---

## 4. Risks / open questions

**R-1 — Margin capture and customer-facing honesty (UR-003).** Charging the higher quoted rate while shipping cheaper is settled policy (resolution 2), but the inventory does not say what the checkout line item is called. Building it as a neutral "Shipping" line; if the org wants different wording, that is a copy change, not a rebuild.

**R-2 — Print at batch scale (UR-005).** The inventory's evidence is HTML print routes, so that is what I am reusing rather than adding a PDF library. Unverified whether browser printing holds up across per-group PDFs for 5,000 packages. P15's load rehearsal measures it; if it fails, adding a server-side PDF renderer is a contained change behind the print-batch module.

**R-3 — Package split and money.** Splitting a package must never alter the order total or the paid charge (UR-001 + UR-002 + resolution 1). Charges therefore live on the order/fulfillment group, and packages carry cost and margin only. Flagging this as a business-logic decision worth a manager's confirmation.

**R-4 — SMS vendor is unnamed.** SMS is required in two places (bulk-delivery notification per the G-021 default, and the manager-texted driver PIN in resolution 4), but no provider appears anywhere in the inventory. Building against a `sendSms()` port with the outbox pattern so the vendor is a one-file swap. Needs a decision before P10 ships.

**R-5 — "Filing group" is undefined (UR-005).** The inventory says "separate PDF per filing group" without saying what defines a group. Treating it as a manager-configurable grouping key over route/method/neighborhood, defaulting to route for delivery and carrier for shipping. Needs confirmation before P8.

**R-6 — R-109 role conflict.** The reconciled inventory flagged six roles in the permissions layer against five in the schema enum, needing source verification. Since this is greenfield with no source to verify, I follow resolution 8a literally: Manager / Staff / Driver in the staff table, customers separate. If a fourth staff role existed in the old system, it will surface during P15 migration and is an additive change.

**R-7 — Nearby-package radius (G-027 default).** ~0.5 mile or same-street-cluster is the orchestrator's default, not a user answer. Shipping it as a setting so managers can tune it without a deploy.

**R-8 — Grace window length (resolution 4).** "Optional short grace" after route completion is unquantified. Defaulting to 30 minutes as a setting.

**R-9 — Ingredient flag flip is one-way in practice.** Once BOM tracking is on and batches consume ingredients, turning it off leaves partial consumption history. Building the flag as forward-only with a manager warning rather than pretending it toggles cleanly.

**R-10 — Shippo as the single carrier path.** Resolution 6 makes Shippo the only label path, so a Shippo outage stops label buying entirely. R-184's direct UPS credentials stay declaration-only per the inventory, which means the fallback is manual. Worth naming; not fixing without a user decision.

---

## 5. Inventory coverage map

Every `R-###` from the 192-row reconcile is assigned to exactly one owning phase (a few are exercised again later; the owning phase is listed).

| Phase | R-IDs owned | Count |
|---|---|---|
| P0 | R-131, R-133, R-136, R-137, R-138, R-140, R-141, R-142, R-161, R-163, R-164, R-187, R-188, R-189, R-190, R-191, R-192 | 17 |
| P1 | R-010, R-051, R-098, R-099, R-100, R-104, R-105, R-106, R-107, R-108, R-109, R-110, R-111, R-112, R-113, R-114, R-115, R-117, R-118, R-119, R-120, R-130, R-135 | 23 |
| P2 | R-139, R-144–R-160, R-162 | 19 |
| P3 | R-001–R-009, R-011–R-018, R-122, R-123 (R-010 owned by P1) | 19 |
| P4 | R-019–R-031 | 13 |
| P5 | R-032–R-040, R-042–R-047, R-054, R-059, R-060, R-061, R-121, R-125, R-126, R-127, R-166–R-170 | 28 |
| P6 | R-055, R-081, R-095, R-173–R-177, R-183, R-184 | 10 |
| P7 | R-049, R-050, R-052, R-053, R-072, R-073 | 6 |
| P8 | R-056, R-076 | 2 |
| P9 | R-074, R-075, R-077, R-078, R-116, R-134, R-179 | 7 |
| P10 | R-079, R-080, R-182 | 3 |
| P11 | R-068–R-071 | 4 |
| P12 | R-041, R-048, R-057, R-058, R-097 | 5 |
| P13 | R-062–R-067, R-082–R-090, R-128, R-171, R-172, R-178, R-180, R-181 | 21 |
| P14 | R-091, R-092, R-093, R-094, R-096, R-101, R-102, R-103, R-124, R-129, R-132, R-185 | 12 |
| P15 | R-063, R-143, R-165, R-186 | 4 |

Total: 17+23+19+19+13+28+10+6+2+7+3+4+5+21+12+4 = **193 assignments over 192 distinct IDs**. The single extra is R-063 (CSV import): the engine is built in P13 and re-used for the legacy run in P15. Every other ID has exactly one owning phase, and none of R-001…R-192 is unassigned.

**UR coverage:** UR-001 P2/P7/P8 · UR-002 P7/P9 · UR-003 P6 · UR-004 P9 · UR-005 P8 · UR-006 P4 · UR-007 P12 · UR-008 P3/P12 · UR-009 P5/P9/P10 · UR-010 P10 · UR-011 P5 · UR-012 P1 · UR-013 P8 · UR-014 P4/P15 · UR-015 P9 · UR-016 P2/P11. **16/16.**

**G coverage:** G-001 P7 · G-002 P8 · G-003 P7 · G-004 P7 · G-005 P7 · G-006 P6 · G-007 P5 · G-008 P11 · G-009 P2/P11 · G-010 P11 · G-011 P12 · G-012 P12 · G-013 P12 · G-014 P5 · G-015 P5 · G-016 P1 · G-017 P10 · G-018 P4 · G-019 P4 · G-020 P8 · G-021 P8/P10 · G-022 P3/P12 · G-023 P9 · G-024 P2/P7/P11/P15 · G-025 P9 · G-026 P10 · G-027 P9 · G-028 P5 · G-029 P15 · G-030 P9. **30/30.**

**User resolutions:** 1 → P7 · 2 → P6 · 3 → P2/P7 · 4 → P9 · 5 → P9 · 6 → P6 · 7 → P2/P11 · 8a → P1 · 8b → P5. Minor defaults: bulk notification channel → P10 · nearby radius → P9 · scale baseline → P2/P7/P15. **All closed.**

**Explicit overrides honored:** pass-through rates → margin capture (P6) · order/group-only fulfillment → package entity (P2, P7) · logged-in messenger driver → magic link + PIN (P9) · label void on save failure only → void on reroute (P9).

**Coverage claim: 192/192 R-IDs, 16/16 UR-IDs, 30/30 G-IDs, 8/8 user resolutions and all 3 orchestrator defaults are assigned to a phase with smoke checks. No feature outside the frozen inventory was added.**
