# P7 fix-pass notes

Exactly one fix pass was performed.

## Fixed

- **B1** — Removed package materialization from the fulfillment page GET. A deliberate `materialize` POST now runs behind `orders:manage`.
- **B2** — Replaced ASCII-only PDF string assembly with PDFKit, an embedded Noto Sans Hebrew TrueType font, and Unicode bidirectional reordering. Hebrew recipient and greeting fixtures are covered by P7 smoke.
- **B3** — Bulk-status responses now show applied and conflicted counts plus conflict reasons in the live board message; `router.refresh()` keeps the message visible.
- **B4** — `materializeOrderPackages` returns `0` when the order is ineligible or already materialized.
- **M1** — Regroup locks both package rows in deterministic ID order with `FOR UPDATE` before reading or moving lines.
- **M2** — PDF artifact downloads now require `orders:manage` instead of `admin:view`.

## Verification

- S1 PASS
- S2 PASS
- S3 PASS
- `npm run ci` PASS
- `npm run build` PASS
