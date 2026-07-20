# Aggregate Review — P4 — arm-02

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Arm:** arm-02
**Phase:** P4 (cart-first order builder, address book, customer account, guest drafts)
**Inputs:** P4-security, P4-quality, P4-rules, P4-clean-code (arm-02)
**Method:** Union + dedupe by location+claim. Security blockers always survive. No new findings.

## Counts

| Severity | Count |
|---|---|
| Blocker | 1 |
| Major | 13 |
| Minor | 23 |
| **Total** | **37** |

Source totals (pre-dedupe): security 8, quality 8, rules 12, clean-code 16 = 44. 7 findings merged into 5 cross-source clusters; net 37 unique.

## Blockers (1)

### B1 — Account takeover via phone collision at registration
**Sources:** security H1
**Location:** `app/api/account/register/route.ts` L31–43 + `lib/customers.ts` `findOrLinkCustomer` L32–48
**Claim:** `findOrLinkCustomer` matches by `email` OR `phoneNormalized`. A passwordless customer with a phone (admin/staff/seed-created) lets an attacker supply the phone, set the password, overwrite `name`, and own the victim's `Customer` record (addresses, drafts, orders) without proving phone ownership. Live in P4.

## Majors (13)

### M1 — Account enumeration via registration response
**Sources:** security M1
**Location:** `app/api/account/register/route.ts` L36–38
**Claim:** Returns `409 "An account with this email already exists"` for existing `passwordHash`, directly confirming which emails are registered. Login is anti-enumeration; register is not.

### M2 — Rate-limit bypass via spoofable X-Forwarded-For
**Sources:** security M2
**Location:** `lib/rate-limit.ts` `clientIp` L21–23
**Claim:** `clientIp` reads `x-forwarded-for[0]` with no trusted-proxy check. Fresh random XFF per request → fresh rate-limit key, defeating `register:ip`, `autocomplete:ip`, `draft-save:ip`, `customer-login:ip`. Per-email login limiter still holds.

### M3 — Migration backfill normalizedKey diverges from normalizedAddressKey
**Sources:** quality F1
**Location:** `prisma/migrations/20260720231000_p4_builder_accounts/migration.sql` L10–14 vs `lib/addresses/normalize.ts` L38–46
**Claim:** SQL backfill lowercases + punctuation→space but does NOT collapse suffix aliases (`street`→`st`); app does. Re-saving a pre-existing row produces a different key → unique constraint doesn't fire → duplicate address-book entry (UR-014 dedupe breaks on real upgrades). Fresh-seed smoke never trips it.

### M4 — OrderDraft.guestTokenHash globally unique → cross-season 500
**Sources:** quality F2
**Location:** `prisma/schema.prisma` L610, `lib/order-builder/draft-store.ts` L54–69
**Claim:** `guestTokenHash @unique` is global, but drafts are season-scoped. A 14-day guest cookie whose ACTIVE draft sits in season A, when the same browser opens season B, makes `saveDraft` collide on the global index → uncaught `P2002` → 500. Stale cookie across season boundary breaks the builder.

### M5 — On-order recipient is single per-draft field but UI presents per-line
**Sources:** quality F3
**Location:** `lib/order-builder/cart.ts` L30, `components/builder/order-builder.tsx` L157–168, `components/builder/assignment-dialog.tsx` L99–106
**Claim:** `cart.onOrderRecipient` is one address (DECISION-P4-4). Assigning a second on-order line with a different address silently overwrites the recipient of every previously-assigned on-order line; cart panel reads it live so all on-order lines flip with no warning. Smoke S1 uses one on-order line only.

### M6 — Duplicated address-update logic in staff PATCH route
**Sources:** quality F6, rules clean-code VIOLATION, clean-code F3
**Location:** `app/api/admin/customers/[id]/addresses/[addressId]/route.ts` L29–47 vs `lib/addresses/book.ts` `updateAddressBookEntry` L45–66
**Claim:** Staff PATCH inlines normalizedKey + geocode + field-by-field update a third time instead of calling `updateAddressBookEntry` (audit row is the only legitimate addition). Three writes to the same model will drift on the next column add. Refactor helper to accept a transaction client and reuse inside `db.$transaction`.

### M7 — DECISION-LOG.md missing
**Sources:** rules workflow VIOLATION
**Location:** `PHASE-P4-STATUS.md` L21–26 (DECISION-P4-1..5)
**Claim:** Five business-logic decisions recorded under "## Decisions" in the status file instead of `DECISION-LOG.md`. Workflow § "Never silently choose business logic — log in DECISION-LOG.md and flag." Decisions are logged and flagged (not silent), but in the wrong artifact.

### M8 — codegraph index never initialized
**Sources:** rules codegraph VIOLATION
**Location:** `arms/arm-02/workspace/` (`.codegraph/` absent)
**Claim:** codegraph.md § "Hard rule": if `.codegraph/` missing and `codegraph` on PATH → `codegraph init` once, then use graph. Contestant built ~40 new P4 files with cross-file imports without ever creating or consulting the graph. arm-01 had `.codegraph/` present; arm-02 did not.

### M9 — Duplicated address display string (3 call sites)
**Sources:** clean-code F2
**Location:** `components/builder/assignment-dialog.tsx` L145–149, `components/account/addresses-manager.tsx` L94–96, `app/(storefront)/account/orders/[id]/page.tsx` L75–77
**Claim:** `{line1}{line2 ? ", ${line2}" : ""}, {city}, {state} {zip}` repeated three times. Extract `formatAddressLine(address)` into `lib/addresses/normalize.ts` (or `lib/addresses/format.ts`). Past Rule-of-2; next format tweak diverges across builder, account, order detail.

### M10 — Active-draft query duplicated in account pages
**Sources:** clean-code F4
**Location:** `app/(storefront)/account/page.tsx` L16–20, `app/(storefront)/account/orders/page.tsx` L18–22 vs `lib/order-builder/draft-store.ts` `findActiveDraft`
**Claim:** Account pages re-query `db.orderDraft.findFirst({ customerId, seasonId, ACTIVE })` inline instead of calling `findActiveDraft`. The two copies already disagree on `orderBy`. Helper is the single source of truth for "what is an active draft" (including the guest case).

### M11 — Address-book query duplicated (4+ sites)
**Sources:** clean-code F5
**Location:** `app/api/draft/route.ts` L19–24, `app/(storefront)/order/page.tsx` L43–48, `app/(storefront)/account/addresses/page.tsx` L7–10, `app/api/account/addresses/route.ts` L9–12
**Claim:** Same `db.customerAddress.findMany({ customerId, orderBy: updatedAt desc })` in four sites; API route diverges on sort order. Extract `getCustomerAddressBook(customerId)` into `lib/addresses/book.ts`.

### M12 — SavedAddress type hand-mirrors Prisma CustomerAddress
**Sources:** clean-code F7
**Location:** `components/builder/types.ts` L11–20 (also `LiveStock` L22–25)
**Claim:** `SavedAddress` is a manual field-by-field mirror of the Prisma model. On schema change (e.g. `recipient`→`recipientName`) it breaks silently and the client renders `undefined`. Derive `Prisma.CustomerAddressGetPayload<{}>` (or a `Pick`). Same concern for the hand-written `LiveStock` shape.

### M13 — P2002 unique-error handling duplicated
**Sources:** clean-code F8
**Location:** `app/api/account/addresses/[id]/route.ts` L32–37, `app/api/admin/customers/[id]/addresses/[addressId]/route.ts` L72–80
**Claim:** Both address PATCH routes independently catch `Prisma.PrismaClientKnownRequestError` code `P2002` → 409 with slightly different messages. Extract `handleUniqueViolation(error, message)` or a `withDuplicateGuard(handler, message)` wrapper. P5 checkout will likely upsert addresses too.

## Minors (23)

### m1 — Guest draft cookie survives sign-in and reappears after sign-out
**Sources:** security L1
**Location:** `lib/order-builder/draft-store.ts` (`saveDraft` L71–80, `discardDraft` L89–92) + `app/api/account/login/route.ts` + `register/route.ts`
**Claim:** Login/register never clear `tomchei_guest_draft`. After sign-out (only customer cookie deleted) the still-present guest cookie re-attaches the prior guest draft to the next user on a shared device, leaking recipient names, addresses, cart via the draft API.

### m2 — OrderDraft no uniqueness guard on (customerId, seasonId, ACTIVE)
**Sources:** security L2
**Location:** `lib/order-builder/draft-store.ts` `saveDraft` L54–82 + `prisma/schema.prisma` `OrderDraft` L604–617
**Claim:** `findActiveDraft` then `create` is a TOCTOU; no `@@unique` on `(customerId, seasonId, status)`. Two concurrent PUTs from two browsers can create two ACTIVE drafts; orphan lingers, `findActiveDraft` silently picks one. Same customer only (no cross-user leak).

### m3 — No rate limit on auth-gated account mutations
**Sources:** security L3
**Location:** `app/api/account/profile/route.ts`, `app/api/account/addresses/route.ts`, `app/api/account/addresses/[id]/route.ts`, `app/api/account/logout/route.ts`, `app/api/admin/customers/[id]/addresses/[addressId]/route.ts`
**Claim:** None call `rateLimit`. Customer routes bounded to caller's own data (low); staff route is audited per call but unthrottled → audit-log flooding.

### m4 — In-memory rate limiter is per-process only
**Sources:** security I1
**Location:** `lib/rate-limit.ts` L1–19
**Claim:** Documented dev limitation. Under multi-instance deploy, per-IP/per-email limits reset per node → effective thresholds multiply by instance count. Informational for single-node dev target.

### m5 — requirePermissionApi 403 echoes internal permission name
**Sources:** security I2
**Location:** `lib/auth/current-user.ts` L67–73
**Claim:** 403 body `Missing permission: ${permission}` exposes internal slugs (`customers.manage`, `staff.impersonate`, …) to any authenticated caller. Minor info disclosure; not exploitable alone.

### m6 — Add-on stock checked per-line, not aggregated across cart
**Sources:** quality F4
**Location:** `lib/order-builder/cart.ts` L135–140 vs L145–151
**Claim:** Product stock is aggregated across the whole cart; add-on stock is not. Two lines ordering the same tracked add-on each pass while combined demand exceeds stock. Inconsistent with product logic and the P5 "issues block checkout" gate — checkout would accept an over-sold add-on.

### m7 — Autosave error state never recovers; UI says "retrying" but nothing retries
**Sources:** quality F5
**Location:** `components/builder/order-builder.tsx` L78–81, `components/builder/cart-panel.tsx` L139–141
**Claim:** On non-OK PUT, `persistCart` sets `saveState="error"` and panel renders "Autosave failed — retrying". No retry scheduled, no manual retry button. Structural failures (store closed 409, auth lost 401, network down) leave the user stuck with a misleading message and no recovery short of hard reload.

### m8 — Smoke coverage gaps (unexercised paths)
**Sources:** quality F8
**Location:** `.scratch/p4-smoke.ps1` / `.scratch/PHASE-P4-SMOKE.md`
**Claim:** Smoke drives `/api/draft` and admin address API directly. Does not exercise: on-order shared-recipient collision (M5), cross-season guest draft creation (M4), add-on stock aggregation across two lines (m6), autosave error/recovery UI (m7), or assignment-dialog mid-order saved-address edit flow. EXPECTED S1–S3 satisfied as written; defects above have no smoke guardrail.

### m9 — YAGNI: completeDraft and mode="pos" plumbed before call sites
**Sources:** rules ponytail MINOR, quality F7
**Location:** `lib/order-builder/draft-store.ts` L101–107 (`completeDraft`), `components/builder/order-builder.tsx` L201 (`mode` → `data-builder-mode` attr only)
**Claim:** `completeDraft` reserved for P5 checkout (R-022) with no P4 caller; `mode` threaded only to a data attribute with no behavior. Both documented, but ponytail § "No boilerplate 'for later.'" Not a stub regression — explicitly out of scope this phase per EXPECTED.

### m10 — ponytail: ladder marker absent on P4 shortcuts
**Sources:** rules ponytail MINOR
**Location:** `lib/addresses/geocode.ts` L9–21 (ZIP-centroid), `lib/addresses/autocomplete.ts` L16–30 (street index)
**Claim:** Deliberate stdlib/native shortcuts; upgrade path named in comments ("swapping in a real provider later means replacing lookupCoordinates only") but the `ponytail:` marker convention isn't used. Same gap as arm-01 P4.

### m11 — Duplicated tab-list UI
**Sources:** rules clean-code MINOR
**Location:** `components/builder/assignment-dialog.tsx` L76–91, `components/account/auth-forms.tsx` L44–67
**Claim:** Both inline the same `role="tablist"` + `bg-brand-soft p-1` strip with identical `cn(...)` ternary. Rule of 2 met; extract a `Tabs` primitive. § duplicated UI / repeated class strings.

### m12 — Duplicated SavedAddress→AddressInput mapping
**Sources:** rules clean-code MINOR, clean-code F1
**Location:** `components/account/addresses-manager.tsx` L26–34 (`startEdit`), `components/builder/assignment-dialog.tsx` L154–164 (Edit onClick)
**Claim:** Both hand-copy the same 7 fields. Extract `toAddressInput(saved)` next to `SavedAddress` or in `lib/addresses/normalize.ts`. A new field (e.g. `label` required) updated in one is silently dropped in the other.

### m13 — Duplicated address-completeness check (isComplete mirrors addressInputSchema)
**Sources:** rules clean-code MINOR, clean-code F9
**Location:** `components/builder/assignment-dialog.tsx` L54–62 vs `lib/addresses/normalize.ts` L5–17
**Claim:** `isComplete` re-encodes recipient/line1/city/state-length/zip-regex that `addressInputSchema` already defines server-side. If the server schema relaxes (ZIP+4, state optional), this client gate keeps rejecting valid input. `addressInputSchema` is pure Zod and bundle-safe — import and use `safeParse`, or share `isAddressComplete`.

### m14 — Inconsistent button styling
**Sources:** rules clean-code MINOR
**Location:** Builder/account mix shared `<Button>` (`components/ui/button`) with raw `<button>` + hand-rolled Tailwind: product-panel "Customize" L63–69, cart-panel qty ± L79–97 / Remove L99–105 / "Choose recipient" L116–123, assignment-dialog tabs L77–90 / Edit L151–169
**Claim:** README § Patterns: "shared primitives in components/ui/". § UI Consistency / one styling approach.

### m15 — Magic numbers
**Sources:** rules clean-code MINOR, clean-code F10
**Location:** `components/builder/address-form.tsx` L50 (debounce `250` ms inline); `lib/addresses/autocomplete.ts` L66 (`take: 5`) + L80 (`.slice(0, 8)`); `lib/order-builder/cart.ts` L19 `.max(999)`, L20 `.max(20)`, L23 `.max(20)`, L25 `.max(500)`, L31 `.max(200)` — `20` duplicated across two unrelated fields
**Claim:** Every other P4 timing is a named constant (`AUTOSAVE_DELAY_MS`, `STOCK_REFRESH_MS`, `GUEST_DRAFT_TTL_DAYS`, `CACHE_TTL_DAYS`). Pull cart limits into `MAX_LINE_QUANTITY`, `MAX_OPTIONS_PER_LINE`, etc. and autocomplete caps into `MAX_SAVED_SUGGESTIONS` / `MAX_TOTAL_SUGGESTIONS`.

### m16 — Unchecked DELETE response (swallowed failures)
**Sources:** rules clean-code MINOR, clean-code F6
**Location:** `components/account/addresses-manager.tsx` L56–60 (`remove`), `components/account/draft-actions.tsx` L16–18 (`cancelDraft`)
**Claim:** Both fire-and-forget the DELETE and `router.refresh()` regardless of outcome. If DELETE 401s (session expired) or 404s (already gone), the UI still refreshes as if it succeeded — row reappears on next navigation. `save()` in the same file checks `response.ok`; `remove()` does not. § no swallowed errors.

### m17 — No .scratch/run-state.md
**Sources:** rules workflow MINOR
**Location:** `arms/arm-02/workspace/.scratch/` (absent)
**Claim:** P4 is a multi-phase feature; workflow § "Run checkpoint" says keep `run-state.md` for multi-phase runs. `phase-plan.md` exists but not the rolling run-state file.

### m18 — Non-null `!` assertions rely on guards not visible at the call site
**Sources:** clean-code F11
**Location:** `components/builder/assignment-dialog.tsx` L66 (`onEditSavedAddress(editingAddressId!, editDraft)`); `app/(storefront)/account/page.tsx` L11, `account/orders/page.tsx` L14, `account/addresses/page.tsx` L6, `account/profile/page.tsx` L7, `account/orders/[id]/page.tsx` L17 (`(await getCustomerContext())!`)
**Claim:** `!` sound only because of a layout redirect or branch guard invisible at the call site. A future refactor moving the button breaks silently. Prefer explicit `if (!x) return;` or a `requireCustomer()` helper that returns non-nullable and redirects otherwise.

### m19 — priceCart approaches 3+ levels of nesting
**Sources:** clean-code F12
**Location:** `lib/order-builder/cart.ts` L91–167
**Claim:** Single `cart.lines.map` whose callback contains nested `for` loops over `optionIds` and `addOns`, each with conditionals and `issues.push`. AddOn branch alone is three levels deep (`map`→`for`→`if isRestricted`→`if trackInventory`). Rule: "if a function has more than 3 levels of nesting, refactor it." Extract `priceLine(line, ctx)` and `priceAddOns(line, addOnById, product)`.

### m20 — Active-draft query inconsistent orderBy across account pages
**Sources:** clean-code F13
**Location:** `account/page.tsx` L18 (`orderBy: updatedAt desc`) vs `account/orders/page.tsx` L19–21 (no `orderBy`)
**Claim:** Same query, two sort policies. Moot today (one ACTIVE draft per customer+season) but pattern drift within the same feature. Pick one, or delete both in favor of `findActiveDraft` (M10).

### m21 — updateAddressBookEntry and saveToAddressBook update branch near-duplicate the field map
**Sources:** clean-code F14
**Location:** `lib/addresses/book.ts` L15–36 (`saveToAddressBook` update) + L52–65 (`updateAddressBookEntry`)
**Claim:** Both write the same seven fields + `normalizedKey` + geocode spread. Only real difference: `where` clause (unique-key upsert vs id update) and geocode-on-null handling. Extract `addressWriteData(input)` and spread it from both. Saves a field-drift bug on next column add.

### m22 — Curly quotes in order detail greeting
**Sources:** clean-code F15
**Location:** `app/(storefront)/account/orders/[id]/page.tsx` L78
**Claim:** Typographic curly quotes around the greeting; every other P4 string uses straight ASCII quotes. UI-consistency drift — pick one quote style for user-facing punctuation.

### m23 — LOCAL_STREETS and ZIP_CENTROIDS hardcoded as data inside source files
**Sources:** clean-code F16
**Location:** `lib/addresses/autocomplete.ts` L16–30 (13 Lakewood streets), `lib/addresses/geocode.ts` L9–14 (4 ZIP centroids)
**Claim:** Documented as local stand-ins for a real provider (fine), but domain data lives in `.ts` source. When the provider swap happens, data should move to a JSON/seed file and the code should just read it, so the swap is "replace the data source" not "edit the source array."

## Dedupe map

| Aggregate | Merged sources |
|---|---|
| M6 | security — ; quality F6 ; rules clean-code VIOLATION ; clean-code F3 |
| m9 | rules ponytail MINOR ; quality F7 |
| m12 | rules clean-code MINOR ; clean-code F1 |
| m13 | rules clean-code MINOR ; clean-code F9 |
| m15 | rules clean-code MINOR ; clean-code F10 |
| m16 | rules clean-code MINOR ; clean-code F6 |

All other aggregate IDs are single-source. No new findings introduced.



