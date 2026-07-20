# Arm 01 Greenfield Build Plan

## 1. Goals / non-goals

### Goals

- Build a seasonal fundraising storefront and operations system from a blank workspace, with customer web ordering, staff POS, package-level fulfillment, shipping, volunteer delivery, pickup, inventory, communications, reporting, and administration.
- Preserve every non-conflicting capability in `R-001`–`R-192`; where behavior differs, apply `UR-001`–`UR-016` and `G-001`–`G-030` as the controlling requirements.
- Make a physical package the fulfillment unit. Printing is an operational action, not proof that a package shipped, was delivered, or was picked up.
- Support 1,000+ orders, 5,000+ packages, and 10+ concurrent staff through pagination, indexed queries, batch operations, idempotent jobs, optimistic conflict handling, and auditable state changes.
- Keep customer identities and address books separate from Manager, Staff, and Driver identities. Enforce permissions and route scope on the server.
- Keep launch operations print-friendly while allowing optional digital package stages and a narrowly scoped driver mobile flow.
- Deliver each phase as a mergeable increment with migrations, seed updates, automated checks, and observable smoke checks.

### Non-goals

- No embedded card form at launch; web payment uses hosted Stripe Checkout.
- No ingredient/BOM user interface at launch. The schema and assembly behavior exist, but managers must explicitly enable the later UI.
- No customer-selected delivery appointments, no out-of-area manager override for per-package delivery, and no automatic map rerouting.
- No full driver account portal and no unrestricted public route URL. Drivers use an expiring, unguessable route link with an optional four-digit PIN.
- No behavior outside the frozen inventories.

## 2. Stack proposal

Use a TypeScript Next.js application with the App Router, React Server Components for read-heavy pages, server actions or route handlers for mutations and integrations, and a small client surface for carts, maps, dialogs, and live operational controls.

- **Application and UI:** Next.js, TypeScript, React, Tailwind CSS, and shadcn-style primitives. This fits the public storefront, authenticated account area, admin workspace, route-link pages, print views, cron endpoints, and responsive UI in one deployable application. The UI-kit direction is inventory-forced by `R-188`–`R-190`.
- **Data:** PostgreSQL with Prisma and ordered migrations. This is inventory-forced by `R-137`–`R-143`. Use database constraints for lifecycle invariants, transactions for stock/payment/package transitions, and indexes for seasonal, customer, order, package, route, and work-queue queries.
- **Identity:** Clerk for customer and staff sign-in (`R-107`–`R-114`), with app-owned Manager/Staff/Driver records and permission overrides. Route-link authentication remains app-owned and separate from Clerk.
- **Payments:** Stripe hosted Checkout, webhooks, refunds, and reconciliation. Cash and check are staff-only POS methods. Do not install Stripe client UI packages unless embedded checkout is later approved.
- **Shipping:** Shippo with the organization’s connected FedEx and UPS accounts, plus USPS where returned by Shippo. Persist all quotes, charge the highest eligible quote, buy the cheaper selected label, and record the margin.
- **Maps and media:** Mapbox for geocoding and the admin route map, Google Maps deep links for driver navigation, and Vercel Blob for catalog media.
- **Messaging and jobs:** Resend plus a transactional outbox for email. Select an SMS provider only after the open provider question is resolved. Vercel Cron invokes authenticated, idempotent sweepers and reminders.
- **PDF/print:** Server-generated print-safe HTML or PDFs for filing-group batches, labels, slips, cards, route sheets, and pickup lists. Choose the smallest PDF dependency that proves reliable against the required grouped and reprint smoke checks.
- **Verification:** Type checking, linting, unit tests for business and permission rules, integration tests against a disposable Postgres database, and browser smoke tests for the critical customer/staff/driver flows.

## 3. Ordered phases

### P1 — Platform, schema, identity, and security foundation

**Primary inventory IDs:** `R-107`–`R-143`, `R-161`–`R-164`, `R-187`; `UR-012`; `G-016`, `G-024`.

**Deliverables**

- Create the Next.js/TypeScript application, environment validation, health endpoint, design-token base, CI checks, disposable migration test, baseline seed, and test/live isolation.
- Model customers, saved addresses, staff, roles, permission grants/denies, seasons, catalog, orders, lines, recipients, packages, inventory, payments, routes, outbox messages, audits, settings, geocode cache, and job runs.
- Keep customer identity records outside the staff-role model. Implement Manager, Staff, and Driver roles, individual login, invitations, confirmation/revocation, permission toggles, server authorization, ownership checks, same-origin/rate-limited public endpoints, error masking, and bounded client-error intake.
- Establish money, normalization, phone, ID, season, date, and typed-result helpers only where the first two call sites require them.
- Add audit primitives and concurrency/version fields used by later package, stock, payment, route, and staff mutations.

**Smoke checks**

- Apply every migration to an empty disposable database, seed it twice without duplicate state, and pass schema-change guards.
- Bootstrap the first manager only when no staff exist; confirm that bootstrap locks afterward.
- Sign in as customer, Manager, Staff, and Driver fixtures; verify each allowed route and a representative denied mutation.
- Revoke a staff account and confirm the next protected request fails; verify grant and deny overrides take effect.
- Run 10 concurrent versioned updates against one fixture and confirm conflicts are reported instead of silently overwriting state.
- Hit the health and guarded error endpoints with valid and invalid inputs; verify secrets and internal errors are not returned.

**Merge boundary:** deployable shell with a migrated database, seeded identities, authorization tests, health check, and no business UI dependency on later phases.

### P2 — Seasons, catalog, storefront, settings, and design system

**Primary inventory IDs:** `R-001`–`R-018`, `R-065`–`R-067`, `R-094`, `R-096`–`R-097`, `R-146`–`R-148`, `R-180`, `R-188`–`R-192`; `UR-008`; `G-022`.

**Deliverables**

- Build the branded storefront shell, responsive navigation, mission homepage, impact/how-it-works/testimonial sections, test-mode and closed-store banners, footer signup, and marketing imagery.
- Build current-season catalog list/detail, category filters, price sorting, options, restricted add-ons, sold-out states, quick view, loading/error/empty states, and the all-season public archive.
- Add manager catalog, add-on, media, photo-needs, and season administration, including replacement links and the new-season wizard.
- Implement Open/Closed season state, optional scheduled flips, closed-season checkout enforcement, and archive browsing without checkout.
- Build the shared admin/storefront visual primitives, responsive tables, list controls, navigation chrome, global error page, and accessibility baseline.

**Smoke checks**

- Open the storefront at desktop and mobile widths; use all navigation, quick-view, filter, and sort controls with seeded catalog data.
- Mark products in stock, sold out, option-priced, and add-on restricted; verify each public and admin state.
- Close the season and confirm banners appear, ordering/checkout entry is blocked server-side, and every archived year remains browsable.
- Open a new season from the wizard, schedule a state flip, run the due job, and verify the current catalog changes once.
- Upload an allowed image and reject a disallowed file; assign and remove media from a product.

**Merge boundary:** independently usable marketing/catalog release with season gates and admin catalog management.

### P3 — Customer accounts, address books, cart-first ordering, and repeat orders

**Primary inventory IDs:** `R-019`–`R-031`, `R-038`–`R-043`, `R-048`, `R-144`–`R-145`; `UR-006`, `UR-007`, `UR-014`; `G-011`–`G-013`, `G-018`–`G-020`.

**Deliverables**

- Build customer profile, order history/detail, owned draft continuation/cancellation, and one address book shared by storefront and staff POS.
- Implement normalized customer lookup/deduplication, address autocomplete/validation, geocoding fields, ownership enforcement, and audited staff edits.
- Build the shared cart-first storefront/POS shell: catalog, quantities, options/add-ons, desktop sidebar, mobile cart control, and assignment of each line to the ordering customer, a saved recipient, or a new recipient.
- Save new recipients to the address book automatically; remember the last greeting per recipient while supporting an order default and later per-package overrides.
- Autosave authenticated drafts, support guest draft/access tokens, and clear guest state only after successful placement.
- Copy a prior year into a draft, follow replacement chains, require unresolved products to be replaced or removed, make price-aware suggestions, and require confirmation of both replacements and recipients before continuing.

**Smoke checks**

- Build the same multi-recipient cart on web and POS; assign lines through all three recipient choices and verify totals and saved recipients match.
- Refresh an authenticated and guest draft, resume each, and confirm one customer cannot enumerate another customer’s draft or profile.
- Edit an address as its customer and as staff; verify ownership, normalized dedupe, geocode fields, and the staff audit entry.
- Repeat a prior-season order containing mapped, chained, unmapped, repriced, and removed products; placement remains blocked until every replacement and recipient is confirmed.
- Change a recipient greeting, start a later draft, and verify the remembered greeting appears without overwriting the order default.

**Merge boundary:** complete draft-building and repeat-order workflow, ending before payment or fulfillment commitment.

### P4 — Checkout, pricing, order lifecycle, and payments

**Primary inventory IDs:** `R-032`–`R-037`, `R-044`–`R-047`, `R-149`–`R-160`, `R-166`–`R-170`; `UR-009`, `UR-011`; `G-007`, `G-014`–`G-015`, `G-028`.

**Deliverables**

- Implement normalized order trees, price snapshots, seasonal order numbers, draft wire format, lifecycle transitions, finalization, discard, and cached payment status.
- Build checkout summaries for recipients, donations, fulfillment choices, conflicts, stock, prices, guest email, and fulfillment fees.
- Enforce per-package delivery ZIP hard blocks; charge per recipient for per-package delivery and once per destination for bulk delivery. Present only manager-configured Purim-week dates for per-package delivery.
- Create hosted Stripe Checkout sessions with immediate capture, authentic idempotent webhooks, charged-amount checks, stale/failed-order safety refunds, normal refunds, and payment recalculation after permitted edits.
- Add staff-only cash/check POS posting and voiding with audit records; keep offline payment unavailable to public checkout.
- Preserve fulfillment prices as paid snapshots so later staff method changes cannot trigger a refund or collection.

**Smoke checks**

- Place a multi-recipient web order through hosted Stripe test checkout; replay its webhook and verify one order, one payment, one stock commitment, and one confirmation trigger.
- Change price or stock after draft creation; checkout reports the conflict and refuses stale totals.
- Try per-package delivery inside and outside configured ZIPs and dates; verify the hard block and exact fee units. Verify bulk delivery charges once per destination.
- Place cash and check POS orders as authorized staff; reject the same methods publicly and verify post/void audit entries.
- Exercise allowed and forbidden order transitions, sequential seasonal numbering, draft discard, refund, safety-refund, and payment-status recalculation.

**Merge boundary:** customer and POS orders can be placed and paid safely, with fulfillment snapshots ready for package creation.

### P5 — Admin operations, POS, customer service, and staff tooling

**Primary inventory IDs:** `R-049`–`R-064`, `R-098`–`R-106`; cross-checks `UR-012`, `G-016`, `G-024`, `G-028`.

**Deliverables**

- Build the permission-aware admin shell, dashboard KPIs, recent orders, Today queue, searchable/filterable/paginated order list, order detail, money actions, and administrative audit log.
- Complete POS customer search/find-or-create, customer directory/add/detail/history, staged customer/product CSV import, staff repeat, and bulk repeat workflows.
- Build staff invitation, confirmation, revocation, permission override, safe impersonation, and visible impersonation state.
- Add test-environment seed/reset/email-capture tools, test/live switch, staff help center, and guided tours.
- Make list queries and bulk actions bounded and concurrency-aware for the stated crunch scale.

**Smoke checks**

- Process one seeded order through dashboard, Today queue, search, detail, refund, and audit views as Manager and restricted Staff.
- Search/create a customer from POS, place cash/check orders, repeat one order, and create a bounded bulk-repeat batch.
- Stage an import containing valid, duplicate, and invalid rows; preview errors, atomically commit valid corrected input, and verify the import audit.
- Impersonate a permitted staff user, exit impersonation, block self-destructive staff mutations, and verify all security events.
- Load and page through fixtures representing 1,000 orders and 5,000 packages; run two conflicting bulk actions and report skipped/conflicted records deterministically.

**Merge boundary:** staff can operate customers and paid orders without relying on fulfillment, campaign, or reporting phases.

### P6 — Finished-package inventory and production

**Primary inventory IDs:** `R-068`–`R-071`; `UR-016`; `G-008`–`G-010`.

**Deliverables**

- Build finished-package inventory overview, reserve/allocate/release, adjustments, write-offs, shortfall reporting, production planning, daily assembly batches, and production history.
- Support products and add-ons in one versioned stock engine with database integrity checks and auditable movements.
- Add BOM, ingredient, supply, and assembly-consumption schema. Keep ingredient screens hidden until a manager enables the feature; finished-package counts remain the launch default.
- Connect draft validation, final order allocation, cancellation, refund policy, and production completion to explicit stock movements.

**Smoke checks**

- Race two checkouts for the last finished package; only one commits and all reservations reconcile.
- Reserve, allocate, release, adjust, write off, and produce stock; verify the movement ledger and overview totals after every step.
- Complete an assembly batch with ingredient tracking disabled and verify finished stock rises without exposing ingredient UI.
- Enable ingredient tracking as Manager, consume a BOM through an assembly batch, reject insufficient supplies, and disable the UI without losing ledger data.
- Generate a shortfall from placed demand and verify it clears after production or release.

**Merge boundary:** inventory is transactionally reliable and usable at launch with the advanced ingredient UI safely gated.

### P7 — Package fulfillment, shipping, print batches, and map rerouting

**Primary inventory IDs:** `R-072`–`R-076`, `R-081`, `R-095`, `R-173`–`R-177`, `R-179`, `R-183`–`R-184`; schema integration `R-153`–`R-157`, `R-162`; `UR-001`–`UR-005`, `UR-013`; `G-001`–`G-006`, `G-021`, `G-023`, `G-030`.

**Deliverables**

- Materialize physical packages from placed order lines, default-grouped by recipient, normalized address, method, and greeting; allow audited staff split/regroup operations.
- Give packages optional New → Printed → Packed → Sent/Picked Up stages while keeping print events separate from fulfillment state.
- Build fulfillment pools, channel summaries, savings summaries, bulk stage actions, bin/box planning, package detail, and package-level slips, labels, and greeting cards.
- Generate a nightly batch with separate PDFs per filing group for slips/labels and separate card-stock PDFs; support parallel filing, per-group reprint, and per-order/package reprint.
- Quote eligible Shippo FedEx, UPS, and USPS services, persist expiring quotes, charge the highest eligible rate, select/buy the cheaper shipment, track it, and record quote cost, customer charge, actual cost, and margin.
- Let staff switch shipping and delivery without changing the paid charge. Audit the switch and preserve the organization’s savings.
- Show Mapbox delivery stops plus unshipped shipping packages within about 0.5 mile or the same street cluster. Require manager confirmation; when rerouting a printed-but-unshipped package, void its Shippo label, add it to the route, and update affected print batches.

**Smoke checks**

- Place lines sharing and differing by recipient/address/method/greeting; verify default boxes, split/regroup them, and retain order links and audit history.
- Print every artifact and confirm no package stage changes. Mark one package Printed/Packed/Sent and verify each transition separately.
- Run the nightly batch twice; the second run is idempotent. Reprint one filing group and one order without regenerating unrelated groups.
- Feed Shippo fixtures where different carriers are high and low; verify customer charge = highest quote, purchased label = cheaper eligible quote, and stored margin is exact.
- Switch delivery ↔ shipping after payment and verify no payment adjustment. For a printed label, confirm reroute voids it before route assignment; for a sent package, reject reroute.
- Display nearby and non-nearby fixtures on Mapbox; never reroute until Manager confirmation, and rebuild the affected route/print output afterward.

**Merge boundary:** all physical packages can be grouped, printed, shipped, rerouted, and audited without driver or notification dependencies.

### P8 — Delivery routes, driver links, pickup, and follow-up

**Primary inventory IDs:** `R-077`–`R-080`, `R-182`; `UR-010`, `UR-015`; `G-017`, `G-025`–`G-027`.

**Deliverables**

- Build route list/detail, assignment/reassignment, Mapbox office map, stop ordering, printable route sheets/cards, route start/completion, and package delivery confirmation.
- Issue unguessable per-route driver links that reveal only one route, optionally require a manager-provided four-digit PIN, expire on completion with configurable short grace, and audit every Delivered tap with time and route-link ID.
- Build a responsive driver stop view and free per-stop Google Maps deep links; retain printed route sheets as the fallback.
- Schedule bulk delivery date/window by staff and send email plus SMS. For per-package delivery, use manager-configured days and send day-of notifications when the route starts.
- Mark pickup eligible only when its ordered inventory is available; send ready notices, produce a door list, stamp package pickup, and report unclaimed packages.
- Add payment and pickup follow-up queues plus authenticated reminder/expiry jobs.

**Smoke checks**

- Assign and reassign a route, print it, open its magic link on a phone viewport, and confirm only that route’s stops are visible.
- Test no-PIN and PIN links, incorrect PIN throttling, route completion, grace expiry, and a Delivered audit containing timestamp and route-link ID.
- Open every Google Maps deep link and verify encoded stop address; complete the same route using only the printed fallback.
- Schedule bulk delivery and verify one email and SMS per intended customer. Start a per-package route and verify one idempotent day-of notification.
- Move stock from unavailable to available, send pickup-ready once, print the door list, stamp pickup, and verify unclaimed/expiry and follow-up behavior.

**Merge boundary:** delivery and pickup are operational end to end, including least-privilege driver access and print fallback.

### P9 — Email marketing, transactional messaging, and scheduled operations

**Primary inventory IDs:** `R-082`–`R-090`, `R-171`–`R-172`, `R-178`, `R-181`, `R-185`; integration checks `R-009`, `R-013`, `R-018`, `R-087`–`R-088`; delivery checks `G-017`, `G-021`, `G-027`.

**Deliverables**

- Build the email hub with campaign draft/sent lifecycle, block-based campaign builder, subscribers, lists, token-protected preferences/unsubscribe, templates, branding, triggered-message overrides, and test sender.
- Send order confirmation, payment link, refund, pickup, bulk-delivery, route-start, and other required transactional messages through an idempotent outbox.
- Isolate Resend behind a provider adapter, capture messages in test mode, retry transient failures, retain bounded redacted logs, and purge logs on schedule.
- Configure authenticated cron jobs for outbox sweep, reminders, pickup expiry, reconciliation hooks, and log purge with job-run records and overlap protection.
- Add SMS as a separate outbox channel once its provider is resolved; use the same recipient, idempotency, audit, and test-capture rules.

**Smoke checks**

- Subscribe, change all three preference states through a valid signed token, reject tampered/expired tokens, and unsubscribe.
- Draft, preview, test-send, send, and list a campaign; rerun the send command and verify recipients do not receive duplicates.
- Trigger each transactional template from its domain event; force a provider failure, retry it, and verify eventual single delivery plus an auditable failure trail.
- Invoke every cron endpoint with missing, wrong, and correct secrets; run overlapping sweeps and confirm one claim per message/job.
- Purge eligible logs without deleting active outbox records or audit evidence; confirm test mode captures instead of contacting providers.

**Merge boundary:** all required messaging is configurable, idempotent, testable, and decoupled from provider outages.

### P10 — Reporting, exports, reconciliation, and historical migration

**Primary inventory IDs:** `R-091`–`R-093`, `R-165`, `R-186`; `G-029`.

**Deliverables**

- Build multi-season performance reports and drill-downs for orders, recipients, products, fulfillment costs, captured shipping margin, production, pickup, delivery, and fundraising totals already represented by the inventory.
- Build guarded CSV exports for deliveries, year-end data, yearly metrics, item sales, and lapsed customers, with export audit history and bounded streaming.
- Run scheduled/manual Stripe reconciliation and surface unmatched, duplicate, missing, and amount-mismatch cases without silently changing money records.
- Document and implement staged historical imports for customers, normalized contact details, addresses, products, seasons, orders, recipients, greetings, and order-number repair.
- Provide dry-run, mapping/error reports, duplicate detection, atomic batches, resume checkpoints, rollback per batch, and post-import reconciliation. Complete this before enabling year-one repeat ordering against migrated history.
- Run the final scale and cross-domain acceptance pass over the complete release.

**Smoke checks**

- Compare every report total and drill-down against a fixed seeded ledger spanning multiple seasons and fulfillment methods.
- Export each dataset as authorized staff, reject unauthorized access, verify quoting/encoding, and confirm audit records and large-result streaming.
- Reconcile matching, duplicate, missing, refunded, and amount-mismatch Stripe fixtures; rerun without duplicate adjustments.
- Dry-run a messy historical fixture containing duplicates, malformed contacts, ambiguous recipients, missing products, and broken order numbers; correct mappings, import atomically, resume after interruption, and reconcile source counts/totals.
- Repeat an imported prior-year order and verify mapped products, recipients, address-book entries, greetings, and price-smart review.
- Execute the critical web order, POS, package print/ship/reroute, route delivery, pickup, notification, report, and refund flows against the scale baseline.

**Merge boundary:** migration and financial/reporting acceptance complete the releasable greenfield system.

## 4. Risks / open questions

### Risks

- **Package regrouping after downstream work:** splitting or rerouting after print, label purchase, inventory allocation, or route assignment can orphan artifacts. Use explicit eligibility rules, version checks, compensating label voids, artifact supersession, and audit records.
- **Payment and fulfillment races:** hosted webhooks, staff edits, stock allocation, refunds, and method switches can arrive concurrently. Use idempotency keys, transactions, immutable paid snapshots, and conflict responses.
- **Margin correctness:** quote expiry, surcharge changes, address corrections, and label adjustments can diverge from the checkout estimate. Retain quoted, charged, purchased, and adjusted amounts separately and expose reconciliation differences.
- **Print scale and correctness:** thousands of packages can create oversized PDFs or duplicate filing. Partition by filing group, stream generation, persist batch membership, and make reprints supersede rather than mutate prior artifacts.
- **Magic-link leakage:** forwarded links expose route PII until expiry. Store only hashed tokens, scope every read/mutation to one route, throttle PIN attempts, minimize stop data, expire on completion, and audit use.
- **Migration quality:** messy contacts and recipient identity ambiguity can create duplicate address books and bad repeats. Require dry-run reports, human mapping for ambiguous rows, reversible batches, and source-to-target reconciliation.
- **Provider outages:** Stripe, Shippo, Mapbox, Resend, SMS, and Blob can fail during crunch time. Keep paid/order state durable, queue retryable side effects, make optional-provider failures visible, and preserve print/manual fallbacks where specified.
- **Crunch load:** broad admin queries, map geocoding, PDF generation, and bulk updates can contend. Use indexes, pagination, bounded jobs, cached geocodes, chunked batches, and conflict-aware mutations from the first phase.

### Open questions requiring configuration or a later product decision

1. Which SMS provider and sender identity should handle bulk-delivery and route-start notices? Email is covered by Resend, but the frozen inventory does not select an SMS vendor.
2. What exact filing-group key and sort order should the nightly PDFs use?
3. What short grace duration should apply after a route is marked complete, and should the optional PIN be selected per route or by a global manager setting?
4. Which Shippo service levels are eligible for the high-quote/low-purchase comparison, and what should staff do when only one valid quote exists or a quote expires before label purchase?
5. What source files, columns, encoding, and authoritative dedupe keys will be supplied for the historical migration?
6. What retention periods apply to route-link audits, transactional message logs, exports, and imported source snapshots?

## Coverage ledger

- **Baseline:** all 192 rows are assigned across phases: P1 `R-107`–`R-143`, `R-161`–`R-164`, `R-187`; P2 `R-001`–`R-018`, `R-065`–`R-067`, `R-094`, `R-096`–`R-097`, `R-146`–`R-148`, `R-180`, `R-188`–`R-192`; P3 `R-019`–`R-031`, `R-038`–`R-043`, `R-048`, `R-144`–`R-145`; P4 `R-032`–`R-037`, `R-044`–`R-047`, `R-149`–`R-160`, `R-166`–`R-170`; P5 `R-049`–`R-064`, `R-098`–`R-106`; P6 `R-068`–`R-071`; P7 `R-072`–`R-076`, `R-081`, `R-095`, `R-173`–`R-177`, `R-179`, `R-183`–`R-184`; P8 `R-077`–`R-080`, `R-182`; P9 `R-082`–`R-090`, `R-171`–`R-172`, `R-178`, `R-181`, `R-185`; P10 `R-091`–`R-093`, `R-165`, `R-186`.
- **User resolutions:** all 16 are primary-scoped: P1 `UR-012`; P2 `UR-008`; P3 `UR-006`–`UR-007`, `UR-014`; P4 `UR-009`, `UR-011`; P6 `UR-016`; P7 `UR-001`–`UR-005`, `UR-013`; P8 `UR-010`, `UR-015`.
- **Grill union:** all 30 are primary-scoped: P1 `G-016`, `G-024`; P2 `G-022`; P3 `G-011`–`G-013`, `G-018`–`G-020`; P4 `G-007`, `G-014`–`G-015`, `G-028`; P6 `G-008`–`G-010`; P7 `G-001`–`G-006`, `G-021`, `G-023`, `G-030`; P8 `G-017`, `G-025`–`G-027`; P10 `G-029`.
- Cross-phase IDs in phase bodies identify integration acceptance checks; the primary allocations above are exhaustive and non-duplicative.
