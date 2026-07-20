# P10 Fix Notes

## Fixed IDs

- B1 — `getCurrentSeason` is read-only; scheduled transitions remain behind the secret-authenticated cron route.
- A-H1 — Added `.scratch/PHASE-P10-SMOKE.md` with S1-S3 evidence.
- A-H2 / A-H3 — Draft creation accepts a precomputed review and uses its loaded source data, eliminating repeated review and source-order fetches in bulk creation.
- A-M2 — Customer repeats record customer and Clerk actor identifiers in audit metadata.
- A-M3 — Bulk repeat is now a review-then-create flow; the create payload must contain explicit per-line product and recipient decisions.
- A-M5 — Season status changes no longer also emit `settings.storefront_updated`.
- A-M6 — Added a Vercel cron registration for `/api/cron/season-status`.
- A-M7 — Repeating now fails clearly when the source fulfillment code is unavailable in the target season.

## Files changed

- `workspace/src/lib/storefront.ts`
- `workspace/src/domain/repeat-orders.ts`
- `workspace/src/app/api/order/repeat/route.ts`
- `workspace/src/app/api/admin/settings/route.ts`
- `workspace/src/app/api/admin/orders/bulk-repeat/route.ts`
- `workspace/src/components/admin-order-actions.tsx`
- `workspace/src/lib/admin-operations.ts`
- `workspace/scripts/p10-smoke.ts`
- `workspace/scripts/p6-smoke.ts`
- `workspace/vercel.json`
- `workspace/.scratch/PHASE-P10-SMOKE.md`

## Verification

- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run smoke:p10` — PASS
  - S1 — discontinued mapping, closest-price default, forced choice, replacement/recipient review
  - S2 — two confirmed bulk drafts, scheduled auto-flip, season wizard
  - S3 — imported mapping, recipient, greeting, and fulfillment preservation

## Blockers remaining

None for the required P10 fix list.
