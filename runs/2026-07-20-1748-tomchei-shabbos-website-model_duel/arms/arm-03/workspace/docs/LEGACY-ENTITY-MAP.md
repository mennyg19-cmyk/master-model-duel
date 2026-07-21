# Legacy → new entity map (R-165)

| Legacy export field | New model / field | Notes |
|---|---|---|
| customer name / email / phone | `Customer.displayName`, `email`/`emailNorm`, `phone`/`phoneNorm` | Dedupe on emailNorm then phoneNorm |
| recipient + address columns | `SavedAddress` (+ `OrderLine` snapshot) | `addressNorm` ownership-scoped unique; cleanup flags `needsReview` |
| product sku / name / price | `Product` (+ `InventoryItem`) | Season-scoped unique sku |
| historical order # / lines | `Order` + `OrderLine` + optional `Payment` | Broken order numbers repaired at stage; `checkoutSnapshot.legacyImport` |
| greeting | `Order.greetingDefault` / `OrderLine.greeting` | Feeds year-one repeat |

Dry-run stages classification + audit (`LEGACY_IMPORT_DRY_RUN`) without writing domain rows when commit is dry-run flagged. Atomic commits are resumable via `commitCursor` / `INTERRUPTED`.
