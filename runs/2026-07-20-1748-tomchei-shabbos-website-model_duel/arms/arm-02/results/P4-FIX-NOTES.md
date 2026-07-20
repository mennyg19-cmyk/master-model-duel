# P4 fix pass — arm-02

**Input:** `arms/arm-02/results/AGGREGATE-REVIEW-P4.md`. Single pass. CI green after fixes (lint, typecheck, migration guard, 32/32 tests). Re-smoke: **38/38 PASS** (29 baseline S1–S3 + 9 new fix-regression checks) — `workspace/.scratch/PHASE-P4-SMOKE.md`.

## Must-fix — all fixed

### B1 — Phone-collision account takeover (FIXED)
`lib/customers.ts findOrLinkCustomer` no longer matches or links by phone — registration (and any future Clerk link) matches by email only. Possessing a phone number proves nothing, so it can never select someone else's record for a password set. A phone already on another record is stored raw-only (unique `phoneNormalized` unclaimable). Live evidence in smoke (`p4-b1-check.ts`): victim record stays passwordless and untouched; attacker gets a fresh record.

### M1 — Registration email enumeration (FIXED)
`register` never returns 409. Every outcome answers generic `200 {ok:true}`: fresh/passwordless email → password set + session; taken email → no state change (unless the supplied password is correct, which is simply a sign-in). Residual, documented in DECISION-P4-7: session-cookie presence still differs; full indistinguishability needs email verification (out of scope for dev auth).

### M2 — Spoofable X-Forwarded-For (FIXED)
`lib/rate-limit.ts clientIp` ignores XFF unless new env `TRUST_PROXY=true` (one trusted reverse proxy), and then uses the **last** hop — the one the proxy appended, which the client can't forge. Direct-served dev shares a single `"direct"` bucket. arm-01 had no trusted-proxy pattern to mirror (it also read raw XFF), so this is the standard fix.

### M3 — Migration backfill key divergence (FIXED)
New migration `20260721050000_p4_fix_pass` recomputes every `CustomerAddress.normalizedKey` in SQL using the exact `normalizedAddressKey` algorithm (lowercase → punctuation to spaces → split/trim → suffix aliases street→st etc. → join, parts `|`-joined). Rows whose recomputed key would collide (pre-existing true duplicates) keep their old key — merging rows is a data decision, not a schema repair. Applied + migration guard green.

### M4 — guestTokenHash global unique → cross-season 500 (FIXED)
Schema now `@@unique([seasonId, guestTokenHash])` (same migration): one draft per guest cookie **per season**. `saveDraft` additionally catches `P2002` on create and recovers by updating the winning row instead of surfacing a 500.

### M5 — On-order recipient silent overwrite (FIXED)
Assignment dialog now states "there is one on-order address per order" in the tab copy, and when N other lines are already assigned on-order and the address is edited, shows a live warning ("changing it here changes it for them too") before assignment. DECISION-P4-4 updated.

### M6 — Staff PATCH duplicated address-update logic (FIXED)
`updateAddressBookEntry` accepts an optional transaction client; the staff route now calls it inside `db.$transaction` next to the audit write. The third copy of the field map is gone.

## Stretch items

- **M7 (FIXED):** `DECISION-LOG.md` created at workspace root — P4 decisions moved from PHASE-P4-STATUS plus four new fix-pass decisions (DECISION-P4-6..9).
- **M10 (FIXED):** account dashboard + orders pages now call `findActiveDraft` (inconsistent inline queries deleted).
- **M11 (FIXED):** `getCustomerAddressBook` added to `lib/addresses/book.ts`; the four inline `customerAddress.findMany` sites (draft API, order page, account addresses page, addresses API) use it — one sort policy.
- **m1 (FIXED):** `clearGuestDraftCookie` called on login, register, and logout; smoke check proves login clears it. Guest→customer cart merge deliberately deferred (DECISION-P4-9).
- **m2 (PARTIAL):** guests are now guarded by the `(seasonId, guestTokenHash)` unique + P2002 recovery. The customer-side ACTIVE-draft TOCTOU has no DB constraint: a partial unique index (`WHERE status='ACTIVE'`) isn't expressible in Prisma schema and would break the migration guard. Risk unchanged and same-customer-only; noted for P5.

## Not attempted (out of single-pass budget)

M8 (codegraph init), M9, M12, M13, m3–m23 — untouched per fix-list priority.

## Files changed

`lib/customers.ts`, `lib/rate-limit.ts`, `lib/env.ts`, `lib/addresses/book.ts`, `lib/order-builder/draft-store.ts`, `app/api/account/{register,login,logout}/route.ts`, `app/api/account/addresses/route.ts`, `app/api/admin/customers/[id]/addresses/[addressId]/route.ts`, `app/api/draft/route.ts`, `app/(storefront)/order/page.tsx`, `app/(storefront)/account/{page,orders/page,addresses/page}.tsx`, `components/builder/{assignment-dialog,order-builder}.tsx`, `prisma/schema.prisma`, `prisma/migrations/20260721050000_p4_fix_pass/`, `DECISION-LOG.md`, `.scratch/{p4-smoke.ps1,p4-b1-check.ts,PHASE-P4-SMOKE.md}`.
