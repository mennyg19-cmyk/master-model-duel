# P11 fix pass — arm-02 (single pass, correctness-first)

**Date:** 2026-07-21 · **Input:** `results/AGGREGATE-REVIEW-P11.md` (0 blockers · 11 majors · 18 minors)
**Gate proof:** `npm run ci` green (eslint + tsc + migration guard + 74/74 unit tests) · S1–S5 re-smoked, 28/28 assertions passed → evidence `workspace/.scratch/PHASE-P11-SMOKE.md`

## Fixed

| ID | Fix |
|---|---|
| **S-M1** | `campaigns/[id]` GET preview now renders for a synthetic `subscriber@example.com` sample with inert `token=PREVIEW-TOKEN`. No live signed token, no real subscriber email in the response. Side effect: also closes **S-L3** (preview no longer exposes a real audience address). |
| **S-M2** | Both test-send endpoints write `AuditLog` rows (`email.campaign.test_send` with campaign target + recipient/outcome detail; `email.test_send` for the settings sender). Campaign test-send renders with neutral "Test Recipient" instead of `gate.staff.realUser.name` — no staff real-name leak to external addresses. |
| **S-M3** | `lists/[id]/members` POST writes `email.list.member_add` / `email.list.member_remove` audit rows with the affected email (absorbs Q-L5). |
| **Q-M1** | `lib/email/dispatch.ts`: the three branding settings are loaded through a lazy memoized loader created once per sweep — a 100-row batch now does ≤3 `Setting` reads instead of 300, and capture mode never triggers the read. Standalone `dispatchOne` callers get a fresh loader by default. |
| **Q-M2** | S1–S5 rerun against the live dev server (mock provider + capture-mode restart); evidence written to `workspace/.scratch/PHASE-P11-SMOKE.md` with runner scripts kept in `.scratch/`. |
| **Q-M3** | Added `Notification.updatedAt` (`@default(now()) @updatedAt`, migration `20260721034525_notification_updated_at`); purge cron now anchors on `updatedAt` (terminal event) instead of `createdAt`. Smoke proves a row created 400 days ago but failed today survives the purge. |
| **R-H1 / R-M1** | `components/admin/email/types.ts` rewritten as the single source of truth matching the shape the server page actually builds (`CampaignRow`, `EmailListRow`, `TemplateRow`, `EmailHubData`); `email-hub.tsx` imports and re-exports it. Stale drifted shape and dead exports removed. |
| **R-M2** | Duplicate `formatCents` deleted from `lib/email/templates.ts`; `lib/email/transactional.ts` and the unit test import the canonical `lib/catalog.ts` helper. Side effect: also closes **C-m3** (formatter no longer lives in the template registry). |
| **R-M3** | New `components/admin/use-hub-act.ts`: one `useHubAct()` hook (message state + `act` mutation plumbing) and the single `ActFn` declaration. Email hub, settings hub, and the three settings tabs all consume it; the two duplicate `act` bodies and three `ActFn` declarations are gone (absorbs C-M2's type half). |

Also: `.scratch/**` added to eslint ignores (smoke scripts are evidence tooling, not product code).

## Deferred (per task scope)

- **R-M5** P2002 detection pattern unification — pure consistency refactor.
- **C-m1** email-hub tab split — god-file split, no behavior change.
- Remaining minors: S-L1, S-L2, S-I1, S-I2, Q-L1, Q-L2, Q-L3, Q-L4, Q-L6, Q-L7, R-L1, R-L2, R-L3, R-L4, C-m2, C-n2 — none was a trivial side effect of the fixes above (S-L3/C-m3 were, and are closed).

## Blockers remaining

None. 0 blockers before and after; all 11 targeted majors closed except the two explicitly deferred refactors (R-M5, C-m1 was a minor).
