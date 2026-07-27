# P2 fix notes

## Fixed

- M1: `discardOrder` now performs its state change with the same `DRAFT` status and optimistic-version predicate used by finalization. A finalize/discard race test proves exactly one transition wins.
- M6: the migration harness now runs `prisma migrate deploy` and `prisma migrate status` against embedded PostgreSQL instead of string-matching the schema.
- m1: finalization rejects orders whose season is not `OPEN`.
- m6: grouping tests cover recipient, address, fulfillment method, and greeting changes.
- m7: P2 smoke queries the seeded season, product, customer, and order before reporting S1 passed.

## Deferred

- M2 and R1 require the P1/P5 authentication boundary and caller identity, which P2 engine functions do not receive.
- M3 and M4 require a deliberate retention/deletion policy and a migration; changing foreign-key deletion behavior blindly risks breaking existing data flows.
- M5 has no package mutation in P2 to guard; adding an unused mutation API would be speculative.
- M7 and M8 require a broader, intentional project-wide concurrency and error-result convention.
- Remaining minors need focused schema/domain decisions and were not expanded in this one-pass fix.

## Smoke proof

`npm run smoke:p2` exited 0 against embedded PostgreSQL on port 4105. All six P2 domain tests passed, including the finalize/discard race and closed-season guard; migrations, seed-fixture queries, and S1–S5 completed.
