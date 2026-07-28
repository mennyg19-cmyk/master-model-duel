# P4 FIX NOTES — arm-06 (Test 4 fix pass)

**Date:** 2026-07-29 · **Source list:** `AGGREGATE-REVIEW-P4.md` (10 majors / 19 minors)
**Result:** **10/10 majors fixed. 14/19 minors fixed, 5 deferred** (justifications below).
**Verification:** lint ✓ · typecheck ✓ · migration-guard ✓ (7 migrations, in sync) · test:unit ✓ (5 suites) · test:domain ✓ · **re-smoke S1–S3: 38 checks, 0 failures** (`.scratch/PHASE-P4-SMOKE.md`).

---

## Majors — all 10 fixed

### MAJ-1. Guest draft attaches to an existing customer with no verification — FIXED
`lib/customers/dedupe.ts`: new `findOrCreateGuestCustomer` + `VerifiedCustomerExistsError`. A guest identity matching a customer who has ever authenticated (Clerk link **or** any `CustomerSession` row) is refused with **409** ("An account already exists… sign in"); guest-shadow rows (never authenticated) still dedupe, so a returning guest keeps one row. `app/api/drafts/route.ts` uses it for the guest branch, and `saveDraft` now takes `allowBookWrites` — `writeRecipients` honors `saveToBook` only for verified sessions, so guests can never inject into an address book. Smoke: S2c2 (409), S1g (authed autosave to book still works).

### MAJ-2. Guest bearer token in URL query strings — FIXED
New `lib/orders/guest-draft-cookie.ts`: the raw token travels only in an **httpOnly, SameSite=Lax cookie** (`arm06_guest_draft_<draftRef>`, Max-Age 30d, Secure in prod). `POST /api/drafts` sets it on guest create and **omits the token from the JSON body**; `app/api/drafts/[draftRef]/route.ts` and the `/checkout` + `/order` pages read it from the cookie jar. `?token=` is gone from every route, `router.push`, and page — the bearer never touches browser history, access logs, or Referer. Smoke: S2c (cookie set, no body token), S2d (missing/forged cookie 404), S2h/S2i (checkout by cookie).

### MAJ-3. Autosave never persists an emptied cart — FIXED
`use-auto-save.ts`: the `lines.length === 0` early return is removed for signed-in customers, so emptying the cart saves the empty state. `lib/orders/drafts.ts` `saveDraft` treats `lines: []` as a **full clear** (deletes lines + recipients, total 0, version bump). `app/api/drafts/route.ts` still refuses a *brand-new* empty draft (422). Smoke: S2n2 (emptied draft cleared server-side), S2n3 (new empty draft 422).

### MAJ-4. Edit-address skips the deliverability probe — FIXED
`edit-saved-address-dialog.tsx` now calls `POST /api/addresses/validate` before PATCHing and blocks on `deliverable === false` with the same copy as add-recipient — parity with the add path (EXPECTED §2).

### MAJ-5. Undeliverable recipient still added, with P5 stub message — FIXED
`add-recipient-dialog.tsx` now **blocks the add** on `deliverable === false` (`onCreated` is not called) and the error copy no longer references the out-of-scope P5 pickup flow: undeliverable addresses are refused outright.

### MAJ-6. Customer session TTL drift (30d vs 12h) — FIXED
`lib/customers/session.ts`: `CUSTOMER_SESSION_TTL_HOURS = 12`, matching the README/STATUS docs and staff-session discipline (12h, revocable).

### MAJ-7. Address-form UI duplicated across three dialogs — FIXED
New `components/ui/address-fields.tsx` (`AddressFields`): one Street/Apt/City/State/ZIP block (with the address-autocomplete slot) now shared by `add-recipient-dialog.tsx`, `edit-saved-address-dialog.tsx`, and the account `AddAddressDialog` in `address-book.tsx`. All three drive it from a single `fields` state object.

### MAJ-8. Open-season assertion duplicated — FIXED
`assertOpenSeason` in `lib/orders/drafts.ts` is now exported and used by `lib/orders/create-draft.ts` — one lookup, one closed-season wording ("expected OPEN to accept orders").

### MAJ-9. Client-IP extraction duplicated across seven sites, with drift — FIXED
New `lib/client-ip.ts` `clientIp(headers)` (first hop, trimmed, capped at 45 chars). All seven call sites use it: `lib/auth.ts`, `lib/customers/session.ts`, `app/api/drafts/route.ts`, `app/api/delivery-check/route.ts`, `app/api/subscribe/route.ts`, `app/api/addresses/validate/route.ts` (the uncapped one — drift removed), comment in `lib/rate-limit.ts` updated.

### MAJ-10. Guest-draft storage key duplicated as a magic string — FIXED
`components/storefront/clear-guest-draft.tsx` now imports and calls `clearGuestDraft()` from `use-auto-save.ts` — one key constant, one clear implementation, so the clear-on-success contract (S2) can't drift.

---

## Minors — 14 fixed

| # | Fix |
|---|---|
| MIN-2 | `geocodeAddress(point, { persist: false })` option; the unauthenticated validate route no longer upserts `GeocodeCache` rows (cache-bloat closed) |
| MIN-4 | Guest token removed from the localStorage payload — the bearer now lives only in the httpOnly cookie (with MAJ-2) |
| MIN-7 | `recipient-assign-dialog.tsx` book pick dedupes: re-picking an already-assigned book address focuses the existing recipient instead of creating a duplicate |
| MIN-8 | `account/orders/[id]/page.tsx` guards `if (!draftRef) notFound()` — no non-null assertion |
| MIN-9 | `account/orders/page.tsx` sorts by an explicit `STATUS_SORT_PRIORITY` map, not alphabetical accident |
| MIN-10 | `saveAddress` unique-violation handling now uses `PrismaClientKnownRequestError` + `code === "P2002"` (string-match removed) |
| MIN-11 | `result` renamed at every call site (`saveResult`, `validation`, `deleteResult`) |
| MIN-12 | `setQty((value) => …)` callbacks renamed to `current` in `product-quick-view.tsx` |
| MIN-14 | New `components/order-builder/recipients.ts`: `recipientFromBook` + `recipientFromOrderRow` mappers; used by the assign dialog and `/order` page |
| MIN-15 | `PricedProduct` type in `components/order-builder/types.ts`; `lineTotalCents`/`cartTotalCents` reference it instead of inline literals |
| MIN-16 | New `components/ui/filter-chip.tsx` (`FilterChip`) replaces `CategoryChip` (builder) and `FilterButton` (storefront grid) |
| MIN-17 | New `lib/storefront/pricing.ts` (`lowestPriceCents`, `priceLabel`); used by `product-card.tsx` and `packages-grid.tsx` |
| MIN-18 | `GuestIdentityDialog` extracted to `components/order-builder/guest-identity-dialog.tsx` |
| MIN-19 | `runCheckoutFlow` wrapper in `order-builder-shell.tsx` owns the busy/error/try-catch skeleton; `proceedToCheckout`/`submitGuestIdentity` pass only their redirect |

## Minors — 5 deferred (with justification)

| # | Why deferred |
|---|---|
| MIN-1 | Allowlist probing via the validate endpoint: the endpoint must answer deliverability for the unauthenticated ZIP-check UX (checkout + dialogs); auth-gating it would break EXPECTED §2 flows. Residual risk accepted (rate-limited; ZIP allowlist is low-sensitivity business data). |
| MIN-3 | In-memory per-instance rate limiter: replacing it needs shared infra (Redis/KV) that doesn't exist on this host; acknowledged in code since P3. Bounded blast radius — every limit is a speed bump, not an auth boundary. |
| MIN-5 | Token expiry on the order row: needs a schema change (`guestTokenExpiresAt` + `canAccess` check) outside a fix pass. Partially mitigated — the cookie's Max-Age bounds the bearer to 30d, FINALIZED drafts no longer load via the drafts API (S2j), and the token left URLs/localStorage (MAJ-2/MIN-4). |
| MIN-6 | QuickView single-option-value: matches the single-FK `OrderLine.optionValueId` schema (P3 shape); no seeded product has >1 option. A proper fix is a schema + UX change, deferred with the schema. |
| MIN-13 | `findDuplicate` in-memory scan: O(1) needs an indexed `dedupeKey` column (schema change). Real books are a handful of rows, one scan per save — design note accepted. |

## Contract changes reviewers should know

1. `POST /api/drafts` guest-create response **no longer contains `guestToken`** — the bearer is set as an httpOnly cookie instead.
2. `?token=` is unsupported everywhere; guest draft load/cancel/checkout require the cookie.
3. Guest identity matching a verified customer → **409** (was: silent attach).
4. `POST /api/drafts` with `lines: []` + `draftRef` clears the draft (was: unreachable); without `draftRef` → 422.
5. `saveDraft` requires `allowBookWrites`; guests get `false` (no address-book writes).
