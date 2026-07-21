# P4 fix notes — arm-03

Single pass against `AGGREGATE-REVIEW-P4.md`. Smoke: `npm run smoke:p4` → **16/16 PASS** (see `workspace/.scratch/PHASE-P4-SMOKE.md`).

## Fixed

| ID | Change |
|---|---|
| **B1** | `getAuthIdentity` exposes `emailVerified`; unverified Clerk emails are not returned / not used for linking. `linkOrCreateCustomer` only email-matches when `emailVerified === true`; otherwise creates a fresh customer without claiming `emailNorm`. Wired through `draft-access` + `/api/customer/link`. |
| **M1** | Guest token no longer in JSON. Cookie set `httpOnly` + `secure` + `sameSite=lax`. Removed `x-guest-draft-token` header auth path (cookie-only). |
| **M2** | `updateOwnedAddress` returns uniform `not_found` for missing and not-owned; customer PATCH maps only 404/409 (no 403 oracle). |
| **M3** | Guest `POST /api/drafts` reuses existing draft when cookie token matches (`existingGuestToken`). |
| **M5** | Migration backfill uses per-field `trim` + `lower` + `\s+` collapse via `regexp_replace`, matching `buildAddressNorm`. |
| **M6** | `addDraftLine` loads add-on inventory and rejects sold-out `tracksInventory` add-ons. |
| **M7** | Product stock checks sum other lines on the same draft (`cartDemandForProduct`) before add/qty update. |
| **M8** | `AssignDialog` address-book mode: preview + **Edit address** → PATCH `/api/addresses/:id` mid-order, then refresh book. |
| **M10** | Exported shared `draftInclude` from `lib/orders/drafts.ts`; draft routes import it. |

## Deferred (per brief)

- **M4** — `guest_success` still P4 stand-in (smoke S2f); gating to post-DRAFT would break S2f until P5 finalize.
- **M9** — `finalize.ts` left in place (P5).
- **M11** — no `DECISION-LOG.md`.
- Minors — not addressed except trivial overlap (smoke inventory reset for deterministic M7).

## Smoke

- Command: `npm run smoke:p4` (ports 3103/4103)
- Result: PASS 16/16 (includes S2b0 cookie-flag assertion)
- Evidence: `arms/arm-03/workspace/.scratch/PHASE-P4-SMOKE.md`
