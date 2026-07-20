# P3 fix notes — arm-01

## Fixed

- **B1:** Test auth is disabled in production and requires localhost plus a
  short-lived HMAC signed token from `TEST_AUTH_SECRET`.
- **A1:** The impersonation cookie now contains an `ImpersonationSession` ID;
  auth accepts only an open session belonging to the current actor.
- **A2:** First-manager bootstrap requires the operator's `SETUP_TOKEN`.
- **A3:** Unauthenticated subscribe responses no longer return a preferences
  token or URL.
- **A4:** Archive DELETE requires the current product version and returns 409
  on an optimistic-lock conflict.
- **A5:** PATCH rejects blank names and invalid/negative integer prices.
- **A6:** Newsletter PATCH preserves `unsubscribedAt` when `isSubscribed` is
  omitted.
- **A7:** Quick view supports Escape, backdrop close, initial focus, focus
  trapping, focus restoration, and scroll locking.
- **A8:** P3 smoke restores the original season status in `finally`.
- **A13:** S1-S5 were re-run and evidence/status artifacts were updated.
- **m7:** DELETE distinguishes unknown products (404) from version conflicts
  (409).

## Skipped

- None of the requested priority findings were skipped.

## Deferred

- **A9-A12, A14-A20:** Deferred because this was one bounded fix pass; these
  broader tests, transactions, and cross-component refactors were not required
  to complete the priority security, correctness, accessibility, and smoke
  fixes.
