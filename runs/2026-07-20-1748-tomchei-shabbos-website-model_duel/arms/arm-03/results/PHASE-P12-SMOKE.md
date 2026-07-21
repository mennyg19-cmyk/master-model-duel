# PHASE-P12-SMOKE

**Arm:** arm-03
**Base:** http://127.0.0.1:3103
**Passed:** 5 / 5
**Failed:** 0

| ID | Check | Pass |
|---|---|---|
| S1 | Reports + margin | PASS |
| S2 | Exports + reconciliation | PASS |
| S3 | Legacy import | PASS |
| S4 | Imported repeat | PASS |
| S5 | Dress rehearsal | PASS |

## Details

```json
[
  {
    "id": "S1",
    "check": "Reports + margin",
    "pass": true,
    "seasonOrders": 144,
    "paidOrders": 100,
    "marginTotals": {
      "chargedCents": 27000,
      "purchasedCents": 18000,
      "marginCents": 9000
    },
    "seededLabels": {
      "charged": 3600,
      "purchased": 2400,
      "margin": 1200
    },
    "pages": {
      "perf": 200,
      "margin": 200
    }
  },
  {
    "id": "S2",
    "check": "Exports + reconciliation",
    "pass": true,
    "exportRows": 15,
    "unauthorized": 403,
    "authorized": 200,
    "orphanFlagged": true,
    "recon1": {
      "orphaned": 1,
      "created": 1
    },
    "recon2": {
      "created": 0,
      "skipped": 1
    },
    "cron": {
      "ok": 200,
      "noAuth": 401
    }
  },
  {
    "id": "S3",
    "check": "Legacy import",
    "pass": true,
    "drySummary": {
      "total": 5,
      "valid": 3,
      "duplicate": 1,
      "invalid": 1
    },
    "dryCommitted": 3,
    "interrupted": true,
    "resumed": "COMMITTED",
    "goodCustomer": true,
    "cleanup": {
      "flagged": 1,
      "queue": 1
    }
  },
  {
    "id": "S4",
    "check": "Imported repeat",
    "pass": true,
    "importedOrderId": "cmrv8oe0z003eqxqctnowizfm",
    "draftRef": "D-2026-42C774EE",
    "reviewPage": 200,
    "accountReview": 200
  },
  {
    "id": "S5",
    "check": "Dress rehearsal",
    "pass": true,
    "printBatch": {
      "artifacts": 98,
      "created": true
    },
    "switched": true,
    "pickup": "stamped",
    "scalePackages": 5000,
    "nightlyMs": 65,
    "wipe": {
      "deletedOrders": 1004,
      "deletedLabels": 1,
      "deletedCustomers": 3
    },
    "reseed": {
      "openSeasonId": "cmruro40z0007qx5wepn8bspr",
      "orderCount": 164,
      "packageCount": 136
    },
    "pages": {
      "testOps": 200,
      "help": 200,
      "reports": 200
    },
    "cronUnauthorized": [
      401,
      401,
      401,
      401,
      401,
      401
    ],
    "labels": 13
  }
]
```
