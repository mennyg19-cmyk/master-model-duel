# P4 Fix Notes — arm-01

## Single fix pass

- **Q-F1:** Removed the address-book fallback from `ON_ORDER`; the picker now contains only recipients already assigned to another line and explains the empty state.
- **Q-F2:** The new-recipient dialog now receives the draft ID returned by `ensureDraft`, avoiding the stale React state closure on a guest's first add.
- **Q-F3:** Draft persistence now uses a customer-scoped `tomchei-order-draft:{owner}` key, validates persisted drafts against the server before displaying them, and removes the legacy shared key.
- Moved the final inventory availability check under row locks in the draft PATCH transaction.
- Guest draft POST now deduplicates by the existing httpOnly draft cookie and enforces a database-backed 10-per-minute source limit.
- Removed guest tokens from JSON responses and removed Bearer-token access; guest access is cookie-only.
- Draft restoration rehydrates the guest address book, and the smoke now verifies that refresh path.
- Draft saves recover from a 409 by refreshing the server version and retrying the current local lines once.
- Draft creation now uses `formatDraftReference`.

## Verification

- `npm run ci`: PASS (lint, typecheck, 13 tests, Prisma validation/migration status).
- P4 S1–S3: PASS — S1 three assignments and totals; S2 authenticated/guest restore, guest address rehydrate, cross-customer 404, post-success token revocation; S3 owner/staff address edits, normalization, geocode field, and audit.
