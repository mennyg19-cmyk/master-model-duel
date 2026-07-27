# P3 Rules Review — arm-05 (blind)

**Phase:** P3 — Storefront: marketing, catalog, archive, newsletter, admin catalog & media
**Ruleset (always-on):** `vocabulary.mdc`, `ponytail.mdc`, `workflow.mdc`, `codegraph.mdc`, `clean-code.mdc`
**Scope:** findings only — no fixes.
**Plan ref:** `shared/MERGED-BUILD-PLAN.md` § P3; `shared/phases/PHASE-P3-EXPECTED.md`.

Findings below are graded against the arm's own always-on rules and the frozen P3 deliverables. Severity: `high` = rule breach with security/correctness impact; `medium` = rule breach or missing deliverable; `low` = drift / minor inconsistency.

## Findings

### 1. `.env.example` is missing P3 secrets — medium
**Location:** `.env.example`
**Claim:** `workflow.mdc` Security Basics — "`.env.example` with placeholders for every secret."
**Evidence:** `.env.example` lists `DATABASE_URL`, Clerk keys, `ERROR_REPORTING_TOKEN`, `DEV_AUTH_*`, but omits `NEWSLETTER_TOKEN_SECRET` and `BLOB_READ_WRITE_TOKEN`. `lib/newsletter.ts:14` throws "NEWSLETTER_TOKEN_SECRET is required" when the secret is absent. `app/api/admin/media/route.ts:20-22` returns 503 when `BLOB_READ_WRITE_TOKEN` is missing. Both are P3-introduced secrets with no placeholder. The phase status itself flags "BLOB_READ_WRITE_TOKEN ... cannot run until supplied" yet the example file was not updated.

### 2. Newsletter "preferences" deliverable not implemented — medium
**Location:** `app/api/newsletter/route.ts`, `app/unsubscribe/page.tsx`, `lib/newsletter.ts`
**Claim:** P3 deliverable — "Newsletter subscribe + preferences + HMAC tokenized unsubscribe (R-009, R-018, R-123)." Expectation item 5.
**Evidence:** `NewsletterSubscriber.preferences` exists in `prisma/schema.prisma:179` with a default JSON, but no API and no UI reads or writes it. `subscribe()` (`lib/newsletter.ts:47-55`) only upserts email; `unsubscribe()` (lines 57-65) only stamps `unsubscribedAt`. The unsubscribe page (`app/unsubscribe/page.tsx`) exposes a single "Unsubscribe" button — no preference toggles. The "preferences" half of the deliverable is absent.

### 3. Replacement-link editor shell absent from admin catalog — low
**Location:** `app/admin/catalog/page.tsx`
**Claim:** P3 deliverable — "Admin product catalog CRUD with season select + replacement-link editor shell (R-065)."
**Evidence:** The `ProductReplacement` model exists (`prisma/schema.prisma:211-220`) but the admin catalog page has no replacement-link UI; it explicitly defers with the string "Replacement links are managed with season lifecycle in P10" (`app/admin/catalog/page.tsx:70`). P10 owns R-048/G-013 (full replacement mapping admin), but the P3 text calls for a "shell" here. The arm chose full deferral — a deviation from the P3 wording, though consistent with the P10 primary allocation. Low severity given the ambiguity.

### 4. Add-on management (restricted add-on linking) missing — medium
**Location:** `app/admin/catalog/page.tsx`, `app/api/admin/catalog/route.ts`
**Claim:** P3 deliverable — "add-on management (R-066)."
**Evidence:** The admin form treats `ADD_ON` as a product `kind` on the same product form (`app/admin/catalog/page.tsx:78`). There is no UI and no API path to create `ProductAddOn` restricted-link rows (`prisma/schema.prisma:198-209`). The schema supports restricted add-ons but the admin cannot link an add-on product to a parent package, so R-066 is only partially covered.

### 5. Swallowed / misreported error in admin catalog POST — medium
**Location:** `app/api/admin/catalog/route.ts:40-47`
**Claim:** `clean-code.mdc` Error Handling — "No swallowed errors"; "Error messages say what went wrong AND what the expected state was."
**Evidence:** The `catch` block returns HTTP 409 with "A product with this SKU already exists for that season." for every Prisma failure — including non-unique-constraint errors (e.g. invalid `seasonId` FK, DB connection loss). The actual error is discarded; the client receives a misleading conflict message. No error logging, no error-type discrimination.

### 6. Floating-point money conversion rejects valid dollar prices — medium
**Location:** `app/admin/catalog/page.tsx:43`
**Claim:** `clean-code.mdc` Anti-Hallucination / correctness; `workflow.mdc` "Verify in the running app."
**Evidence:** `priceCents: Number(form.get("priceDollars")) * 100`. JS floating-point multiplication produces non-integer cents for many valid inputs (e.g. `1.13 * 100 === 113.00000000000001`). The server schema validates `z.number().int().min(0).max(1_000_000)` (`app/api/admin/catalog/route.ts:13`), so such prices fail with a generic "Enter a valid season, SKU, name, and price." error. `Math.round(Number(...) * 100)` is the safe form. Saving a $1.13 product through this UI fails.

### 7. Three competing money formatters — medium
**Location:** `lib/foundation.ts:7-12` (`centsToDollars`), `lib/storefront.ts:5-10` (`formatMoney`), `app/components/catalog-grid.tsx:16-18` (`formatMoney`)
**Claim:** `clean-code.mdc` Consistency — "One ... per project"; "duplicated logic — pull into `lib/` helpers."
**Evidence:** Three implementations of the same cents→USD formatting exist. `catalog-grid.tsx` defines its own local `formatMoney` instead of importing the identical one from `lib/storefront.ts` (or `centsToDollars` from `lib/foundation.ts`). The storefront and foundation helpers are themselves duplicates of the same concern. No single source of truth for money formatting.

### 8. Duplicated fetch logic in admin catalog page — low
**Location:** `app/admin/catalog/page.tsx:16-30`
**Claim:** `clean-code.mdc` — "No copy-paste patterns with minor variations — extract the pattern."
**Evidence:** `loadCatalog()` (lines 16-21) and the `useEffect` (lines 23-30) both fetch `/api/admin/catalog` with slightly different response-handling shapes. The effect does not call `loadCatalog`; it re-implements the fetch inline. One helper should cover both.

### 9. Public newsletter subscribe endpoint has no rate limiting or origin guard — medium
**Location:** `app/api/newsletter/route.ts:13-18`
**Claim:** `workflow.mdc` Security Basics — "Sanitize user input ... Least privilege by default"; `ponytail.mdc` Never cut — "Trust-boundary validation."
**Evidence:** `POST /api/newsletter` is unauthenticated, accepts any origin, and writes a row on every request. There is no same-origin check, no IP rate limit, no captcha. Compare `app/api/admin/media/route.ts:11` and `app/api/admin/catalog/route.ts:35`, which both call `hasSameOrigin(request)`. The public subscribe endpoint is a trust-boundary write with no throttling, enabling unlimited DB-row spam and email enumeration via the upsert path.

### 10. Store open/closed flip is not audited — low
**Location:** `app/api/admin/settings/route.ts:33-44`
**Claim:** `workflow.mdc` — "Never silently choose business logic ... log in DECISION-LOG.md and flag"; P1 audit-trail precedent.
**Evidence:** The PUT handler updates `season.status` (OPEN↔CLOSED) inside the transaction but writes no `AuditEvent`. P1 established the security audit trail for role changes and impersonation; flipping the store open/closed is an operationally significant, manager-only business action. There is no audit row recording who flipped the store and when.

### 11. Smoke test asserts UX checks via `console.log` without running-app evidence — medium
**Location:** `scripts/smoke-p3.ts:43-53`, `arms/arm-05/workspace/.scratch/PHASE-P3-STATUS.md:12`
**Claim:** `workflow.mdc` — "Verify in the running app — never mark done from code alone. An empty 200 is not working: seed data, exercise the real flow"; `clean-code.mdc` Anti-Hallucination — "Do not claim 'fixed/passed/working' without tool output or running-app evidence."
**Evidence:** `verifySmoke()` performs real DB and token assertions for S3 and the media validator, but for S1, S2, S4, and S5 it only emits `console.log("S1 ... passed.")` strings (lines 48-52) without exercising the storefront, nav, quick-view, filter, sort, mobile widths, archive browse, or admin→storefront product flow. The phase status then states "`npm run smoke:p3` passed S1–S5 automated fixture and behavior checks" — claiming behavior that the script never exercised. The expectation-file smoke table (S1, S2, S4) requires running-app verification, not log lines.

## Summary counts

| Severity | Count |
|---|---|
| High | 0 |
| Medium | 7 |
| Low | 4 |
| **Total** | **11** |

Top themes: incomplete P3 deliverables (preferences, add-on linking, replacement shell), public write endpoint without trust-boundary guards, error handling that misreports failures, duplicated money formatting, and smoke checks claimed but not exercised in the running app.
