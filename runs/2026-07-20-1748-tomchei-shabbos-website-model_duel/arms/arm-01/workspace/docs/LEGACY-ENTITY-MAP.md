# Legacy entity map

The P12 migration endpoint accepts one JSON document. A dry run stores the
source document, counts, money totals, mappings, and issues under a SHA-256
checkpoint before any product record is written.

| Legacy entity | New entity | Stable identity and cleanup |
|---|---|---|
| customer | `Customer` | `id` → `legacySourceId`; normalized email/phone merge duplicate people |
| customer address | `CustomerAddress` | `id` → `legacySourceId`; normalized recipient/address fields dedupe within one customer |
| product | `Product` | `id` → `legacySourceId`; season year creates/locates a closed `Season` |
| historical order | `Order` | `id` → `legacySourceId`; duplicate/broken source numbers are deterministically resequenced |
| historical line | `OrderLine` | product and optional saved-recipient IDs must resolve before commit |

Missing customer/product/address references are blocking. Malformed contacts
and incomplete addresses are review issues; imported addresses receive
`validationStatus=REVIEW` and a reason. Once blocking mappings are corrected,
the whole batch commits in one serializable transaction. Replaying a completed
checkpoint returns the existing batch, while interrupted transactions remain
safe to resume. Source and imported counts/totals are retained for acceptance.
