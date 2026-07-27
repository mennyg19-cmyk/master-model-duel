# P6 fix pass notes

## Fixed

- Import stage/commit now requires `imports.manage` plus `customers.write` for customers or `settings.manage` for products; batches are bound to their stager.
- Product commits reject an existing SKU within the open season.
- POS cannot rename an existing customer unless the staff member has `customers.write`; offline payment finalization now rejects non-POS drafts.
- Stripe refunds retain `POSTED` when other posted payments remain.
- The bounded bulk action is named a version-conflict probe and rejects missing per-order versions.
- P6 smoke now covers product imports and repeated bulk probes, and its written evidence no longer claims untested S1 surfaces.

## Deferred

- Order/customer detail pages, cart-first POS UI, full settings tabs, import batch recovery/preview UI, and browser-level S1 traversal remain outside this single pass.
