# Decision log

## 2026-07-28 — Reconciliation permission

Stripe reconciliation uses the new `payments.reconcile` permission, while staging and committing legacy imports retain `imports.manage`. Both are manager defaults. This keeps payment-audit access separate from data-import authority.
