# P7 fix pass — arm-05

## Fixed

- **#2:** Packing-slip documents now require an active finalized order.
- **#4:** Split and regroup require current package versions and increment versions when lines change.
- **#5:** Nightly batches include only active `NEW`, `PRINTED`, and `PACKED` packages.
- **#6:** Packing slips, shipping labels, and greeting cards now render distinct PDF layouts.
- **#7:** Status changes and their `PackageAudit` entries now use one transaction.
- **#9–#11:** Regroup validates the full grouping identity; the board exposes Pick up plus bulk Pack, Send, and Pick up.
- **#12:** The board now labels the non-measured count as consolidated items rather than claimed package moves saved.
- **#13–#15:** S3 now checks a printed package remains unshipped, asserts two reprint audits, and the P7 status walks all EXPECTED items with evidence.
- **#16–#24:** Shared package helpers and display formatting remove the reported duplication and inconsistent patterns.
- **#26, #34–#35:** PDF text filters control characters, the print route no longer needs a non-null assertion, and PDF links use `rel="noopener noreferrer"`.

## Partial / skipped

- **#1 and #3:** Print and package operations now restrict targets to active packages or finalized orders. The schema has no per-staff tenant/scope model, so the requested tenant-level scoping cannot be implemented without adding a new authorization concept.
- **#8:** Cursor pagination and global dashboard aggregates were not changed in this single pass.
- **#25, #28–#33, #36–#40:** Not addressed except where covered by the fixes above.

## Deferred

- **#27:** Nightly cron wiring remains deferred to P11 as requested.

## Evidence

- `npm run smoke:p7` passed S1–S3 on embedded PostgreSQL port 4105.
- `npm run typecheck` passed.
- Detailed smoke and expectation evidence: `workspace/.scratch/PHASE-P7-SMOKE.md` and `workspace/.scratch/PHASE-P7-STATUS.md`.
