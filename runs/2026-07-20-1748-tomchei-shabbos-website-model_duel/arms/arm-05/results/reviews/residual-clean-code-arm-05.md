# Residual clean-code review — arm-05 (post self-fix)

**Scope:** `arms/arm-05/workspace/` after the SR-001…SR-008 self-fix pass.
**Rule source:** `arms/arm-05/.cursor/rules/clean-code.mdc`.
**Method:** tree-only inspection (no access to SELF-REVIEW.md). Findings are residual issues the self-fix pass did not address.

Severity legend: **high** = correctness/anti-pattern risk or duplicated logic with functional drift; **medium** = clear rule violation, stable code; **low** = cosmetic / minor drift.

---

## H-1 · Two competing CSV parsers in the same project

- **Severity:** high
- **Location:** `lib/admin-operations.ts:33` (`parseCsv`) vs `lib/reporting.ts:14` (`parseCsvRecords`) and `lib/reporting.ts:45` (`parseCsv`).
- **Claim:** The project ships two independent CSV parsers with different semantics. `admin-operations.parseCsv` is a naive `line.split(",")` that breaks on quoted fields containing commas; `reporting.parseCsvRecords` is a full quoted-field state machine. This is both duplicated logic and inconsistent patterns (clean-code: "one pattern per concern" + "duplicated logic" refactor category).
- **Evidence:**
  - `lib/admin-operations.ts:33-58` — `parseCsv` splits on `/\r?\n/` then `line.split(",")`, no quote handling.
  - `lib/reporting.ts:14-43` — `parseCsvRecords` tracks `quoted`, handles `""` escapes and embedded newlines.
  - Both are invoked from staging paths (`stageImport` and `stageLegacyImport`), so customer-facing CSV uploads use different parsing rules depending on which import screen is used.

---

## M-1 · `lib/delivery.ts` is a god file (547 lines, mixed concerns)

- **Severity:** medium
- **Location:** `lib/delivery.ts` (547 lines).
- **Claim:** Exceeds the 500-line / mixed-concerns split threshold from clean-code.mdc. One module owns geocoding + Mapbox + fixture coordinates, magic-link/PIN throttling, route CRUD, driver stop delivery, package method switching, nearby-shipping proximity, bulk-delivery scheduling, pickup eligibility/ready/door-list/stamp/expire, and payment reminders.
- **Evidence:** `geocodeAddress` (l.79), `loadDriverLink` (l.146), `createRoute` (l.183), `deliverDriverStop` (l.304), `switchPackageMethod` (l.331), `nearbyShippingPackages` (l.374), `scheduleBulkDelivery` (l.419), `pickupEligibility`/`markPickupReady`/`pickupDoorList`/`stampPickedUp`/`expirePickupPackages` (l.439-523), `sendPaymentReminders` (l.533). Natural split: `lib/delivery/geocoding.ts`, `lib/delivery/driver-routes.ts`, `lib/delivery/pickup.ts`, `lib/delivery/bulk.ts`.

---

## M-2 · Duplicated SHA-256 hashing helper under two names

- **Severity:** medium
- **Location:** `lib/delivery.ts:28` (`hashSecret`) and `lib/order-builder.ts:62` (`tokenHash`).
- **Claim:** Both functions are `createHash("sha256").update(value).digest("hex")` with different names. Duplicated logic + inconsistent naming for the same concern (token hashing for DB lookup).
- **Evidence:**
  - `lib/delivery.ts:28` `function hashSecret(value: string) { return createHash("sha256").update(value).digest("hex"); }` — used for driver-link tokens and PINs.
  - `lib/order-builder.ts:62` `function tokenHash(token: string) { return createHash("sha256").update(token).digest("hex"); }` — used for guest access tokens.
  - Two call sites each, so the Rule-of-2 bar for a shared `lib/crypto.ts` helper is met.

---

## M-3 · `normalizeEmail` redefined locally instead of reusing the shared one

- **Severity:** medium
- **Location:** `lib/admin-operations.ts:29-31` vs `lib/foundation.ts:16-18`.
- **Claim:** `foundation.ts` exports the canonical `normalizeEmail`, used by `reporting.ts`, `order-builder.ts`, `newsletter.ts`, and `api/staff/route.ts`. `admin-operations.ts` redefines its own `normalizeEmail(email: string | undefined)` instead of importing the shared helper. Pattern drift on a one-pattern-per-concern concern (email normalization).
- **Evidence:**
  - `lib/foundation.ts:16` `export function normalizeEmail(email: string) { return email.trim().toLowerCase(); }`
  - `lib/admin-operations.ts:29` `function normalizeEmail(email: string | undefined) { return email?.trim().toLowerCase(); }`
  - Grep shows 5 files import the shared one; only `admin-operations.ts` forks it.

---

## M-4 · Inconsistent error-handling pattern across API routes

- **Severity:** medium
- **Location:** `lib/foundation.ts:41` (`maskError`) vs ~25 `app/api/**/route.ts` files.
- **Claim:** clean-code.mdc mandates "one error-handling approach per project." A `maskError` helper exists and is used by 3 routes, but every other route inlines `error instanceof Error ? error.message : "<fallback>"` (28 occurrences across 22 files). The two approaches diverge in behavior: `maskError` hides messages in production, the inline pattern leaks them.
- **Evidence:**
  - `maskError` imported in: `app/api/order/drafts/route.ts:3`, `app/api/order/drafts/[draftId]/route.ts:3`, `app/api/addresses/[addressId]/route.ts:5`.
  - Inline pattern count (grep `error instanceof Error ? error.message :`): 28 hits across `app/api/admin/**`, `app/api/checkout/**`, `app/api/driver/**`, `app/api/repeat/**`, plus `lib/email.ts`, `lib/shipping.ts`, `lib/package-operations.ts`, and the admin pages.

---

## M-5 · Duplicated admin POST-fetch boilerplate across every admin page

- **Severity:** medium
- **Location:** `app/admin/packages/page.tsx:54` (`postJson`), `app/admin/reports/page.tsx:55` (`post`), `app/admin/seasons/page.tsx:47` (`post`) and `:73` (inline), plus inline `fetch(..., { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(...) })` in `catalog`, `delivery`, `pos`, `staff`, `settings`, `operations`, `test-console`, `orders/[orderId]`.
- **Claim:** Every admin page re-implements the same JSON POST wrapper. No shared `apiPost` helper exists in `lib/`. Duplicated logic (Rule of 2 easily met: 10+ call sites) and inconsistent error shape (some return `{ok, body}`, some return `body | null`, some set a message string).
- **Evidence:** grep `content-type.{0,10}application/json` in `app/admin` returns 14 hits across 10 files; only `packages/page.tsx` extracted a helper, and even that one is local to the page.

---

## L-1 · Duplicated initial-fetch logic between `load()` and `useEffect` (SR-008 regression)

- **Severity:** low
- **Location:** `app/admin/seasons/page.tsx:18-45` and `app/admin/reports/page.tsx:22-53`.
- **Claim:** The SR-008 self-fix ("reworked reports and seasons initial fetch effects so lint passes without `set-state-in-effect` errors") duplicated the fetch logic: each page defines a `load()` function and then re-implements the same fetch inside `useEffect` instead of having the effect call `load()` with an abort signal. Same fetch URL, same response shaping, two copies per file.
- **Evidence:**
  - `seasons/page.tsx`: `load` at l.18-25 fetches `/api/admin/seasons` and `setState(body)`; the effect at l.27-45 fetches the same URL and runs the same `setState`/`setTargetSeasonId` lines verbatim.
  - `reports/page.tsx`: `load` at l.22-31 vs effect at l.33-53 — same five `set*` calls duplicated.

---

## L-2 · Duplicated storefront draft-session logic across components

- **Severity:** low
- **Location:** `app/components/order-builder.tsx:54` & `:77-81` & `:112` vs `app/components/checkout-flow.tsx:16` & `:30-31` & `:58-62`.
- **Claim:** Both client components independently define `const storageKey = "tomchei-order-draft"` and re-implement the sessionStorage read + `x-draft-access-token` header construction. No shared `useDraftSession` hook or `lib/draft-session.ts` helper. Duplicated logic + magic string duplicated.
- **Evidence:**
  - `order-builder.tsx:54` `const storageKey = "tomchei-order-draft";` and `:80` builds the `x-draft-access-token` header.
  - `checkout-flow.tsx:16` same constant, `:31` and `:62` rebuild the same header.
  - Server side, `lib/order-builder.ts:145` reads the same header name as a literal string — a third copy of the magic string.

---

## L-3 · Near-duplicate `.admin-alert` and `.notice` CSS rules

- **Severity:** low
- **Location:** `app/styles.css:27` and `app/styles.css:31`.
- **Claim:** Two classes express the same "highlighted alert banner" intent with slightly different values. Duplicated UI styling that has already started to drift.
- **Evidence:**
  - `:27` `.admin-alert { background: #fff0e9; border-left: 4px solid var(--accent); margin: 0 0 20px; padding: 10px 12px; }`
  - `:31` `.notice { background: #fff0e9; border-left: 4px solid var(--accent); margin-bottom: 20px; padding: 12px; }`
  - Same colors and border, different margin/padding shorthand — a sign the two classes should be one token.

---

## L-4 · `centsToDollars` is an alias for `formatMoney`

- **Severity:** low
- **Location:** `lib/foundation.ts:14`.
- **Claim:** `export const centsToDollars = formatMoney;` provides a second name for the same function. Two names for one concern creates naming inconsistency (clean-code: "Function names describe what they DO"); callers must wonder which to use.
- **Evidence:** `lib/foundation.ts:7` `formatMoney`, `lib/foundation.ts:14` `centsToDollars = formatMoney`. Grep shows `formatMoney` is used widely and `centsToDollars` has no call sites in the workspace — dead alias.

---

## Summary counts

| Severity | Count |
|---|---|
| High | 1 |
| Medium | 5 |
| Low | 4 |
| **Total findings** | **10** |

**Top recommendation:** extract a shared `lib/csv.ts` (collapses H-1, removes the naive splitter), a shared `lib/crypto.ts` `sha256Hex` (M-2), and a shared `lib/api-client.ts` `apiPost` + `apiError` pair (M-4 + M-5). Splitting `lib/delivery.ts` (M-1) is the next biggest structural win.
