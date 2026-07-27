# P10 fix notes

## Fixed

- #1 — Captured P10 smoke and typecheck output in the required workspace evidence files.
- #2, #3 — Bulk repeat now limits requests to 25 customers, processes five at a time with `Promise.allSettled`, returns partial outcomes, and audits customer IDs plus individual failures.
- #4, #5 — Cron records every run with opened season IDs; manual close clears a schedule and expired seasons cannot reopen.
- #7, #15, #16 — Repeat draft construction resolves source lines concurrently, exports its shared line type, and emits one review line per package recipient.
- #8, #10, #24, #32 — The review flags stale addresses and unmapped lines; source orders must be finalized; repeat errors state the expected prior-order condition.

## Skipped

- None.

## Deferred

- #6 — Scheduling remains UTC; organization-local timezone design was not in scope for this targeted pass.
- #9, #11–14, #17–23, #25–31 — These need broader UI, route, schema, or audit work than this single pass.
- #28 — Customer ownership is narrowed before address lookup, but wire-format runtime validation remains.
- #29 — Removed the ineffective manual `Origin` header from the P10 repeat review request; other existing customer fetches remain.
