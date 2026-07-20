# Phase EXPECTED — P4

**Written before build.** Arms: all. Plan ref: `shared/MERGED-BUILD-PLAN.md` § P4 — Cart-first order builder, address book, customer account.

## Must be true when phase is done

1. [ ] Cart-first flow: add catalog items + quantities first, then assign each line via **on-order / address-book / new recipient** three-way picker
2. [ ] New recipients auto-save to the customer's single address book; address autocomplete + server validation; edit saved address mid-order
3. [ ] Staff address-book edits audited (UR-014, G-019)
4. [ ] Inventory-aware live stock in builder; product options + restricted add-ons; builder product panel/cards/quick view
5. [ ] Recipient assignment + add-recipient dialogs; autosave drafts; guest draft cleared only after success
6. [ ] Guest checkout access tokens; draft ownership anti-enumeration for authenticated and guest drafts
7. [ ] Desktop sidebar + mobile cart FAB; shared storefront/POS builder shell
8. [ ] Account area: dashboard, order history + detail, continue/pay/cancel draft; profile ownership-enforced; saved-address account view

## Smoke

| # | Check | How |
|---|---|---|
| S1 | Three-way assignment | Add 3 items → assign to self, saved recipient, new recipient → new recipient in address book; totals match |
| S2 | Draft persistence | Refresh mid-order restores auth + guest drafts; guest draft cleared only after success; second browser cannot open another customer's draft |
| S3 | Address edit audit | Edit address as customer and as staff; verify ownership, normalized dedupe, geocode fields, staff audit entry |

Evidence path per arm: `arms/{id}/workspace/.scratch/PHASE-P4-SMOKE.md`

## Out of scope this phase

- Payment capture, Stripe checkout, fulfillment commitment (P5)
- POS cash/check posting (P5/P6)
- Repeat orders, replacement mapping admin (P10)
- Package board, printing, shipping labels, routes (P7–P9)
