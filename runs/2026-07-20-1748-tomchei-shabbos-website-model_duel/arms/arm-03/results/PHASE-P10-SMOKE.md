# PHASE-P10-SMOKE

**Arm:** arm-03
**Base:** http://127.0.0.1:3103
**Passed:** 3 / 3
**Failed:** 0

| ID | Check | Pass |
|---|---|---|
| S1 | Repeat with discontinued item | PASS |
| S2 | Bulk repeat + auto-flip | PASS |
| S3 | Imported prior-year repeat | PASS |

## Details

```json
[
  {
    "id": "S1",
    "check": "Repeat with discontinued item",
    "pass": true,
    "priceSmart": true,
    "forcedConfirm": true,
    "defaultProductId": "cmrv6iq73000pqxk45qp3drca",
    "nearPriceId": "cmrv6iq73000pqxk45qp3drca",
    "draftRef": "D-2026-8793D994",
    "mappedOk": true,
    "apiPreviewOk": true,
    "candidates": [
      "FAMILY-DELUXE",
      "FAMILY-BOX"
    ]
  },
  {
    "id": "S2",
    "check": "Bulk repeat + auto-flip",
    "pass": true,
    "bulkCreated": 2,
    "conflicts": [],
    "skipped": [],
    "flipOpened": [
      "cmrv92dcy000mqx8kyjzw60nv"
    ],
    "flipSeasonStatus": "OPEN",
    "productsCopied": 7,
    "cronStatus": 200
  },
  {
    "id": "S3",
    "check": "Imported prior-year repeat",
    "pass": true,
    "draftRef": "D-2026-C17236FA",
    "productId": "cmrv6iq73000pqxk45qp3drca",
    "recipientName": "Rivky Cohen",
    "savedAddressId": "seed-addr-customer-friend",
    "greeting": "Chag Sameach from 2025"
  }
]
```

Pages: seasons=200 review=200
