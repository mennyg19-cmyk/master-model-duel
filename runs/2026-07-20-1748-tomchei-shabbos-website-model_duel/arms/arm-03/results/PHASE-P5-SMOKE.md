# PHASE-P5 smoke evidence

Run at: 2026-07-21T20:11:55.681Z
Base: http://127.0.0.1:3103
Result: PASS (5/5)

| ID | Check | Pass |
|---|---|---|
| S1 | Stripe web checkout + webhook replay → one order/payment/stock | PASS |
| S2 | Delivery fees + zip block | PASS |
| S3 | Stale price/stock refused | PASS |
| S4 | POS cash/check post+void; public reject | PASS |
| S5 | Lifecycle transitions, numbering, discard, safety refund, payment recalc | PASS |

```json
{
  "ok": true,
  "passed": 5,
  "total": 5,
  "failed": [],
  "evidence": [
    {
      "id": "S1",
      "check": "Stripe web checkout + webhook replay → one order/payment/stock",
      "pass": true,
      "status": "PAID",
      "orderNumber": 39,
      "payments": 1,
      "reserved": 2,
      "replay": true
    },
    {
      "id": "S2",
      "check": "Delivery fees + zip block",
      "pass": true,
      "bulkFees": {
        "bulkDestinationCount": 2,
        "bulkFeeCents": 1000,
        "perPackageRecipientCount": 0,
        "perPackageFeeCents": 0,
        "shipLineCount": 0,
        "shipFeeCents": 0,
        "totalFeeCents": 1000,
        "blockedZips": []
      },
      "pkgFees": {
        "bulkDestinationCount": 0,
        "bulkFeeCents": 0,
        "perPackageRecipientCount": 3,
        "perPackageFeeCents": 2400,
        "shipLineCount": 0,
        "shipFeeCents": 0,
        "totalFeeCents": 2400,
        "blockedZips": []
      },
      "blocked": true
    },
    {
      "id": "S3",
      "check": "Stale price/stock refused",
      "pass": true,
      "status": 409,
      "conflicts": [
        {
          "kind": "stale_price",
          "lineId": "cmrv3ahwp00a3qx0opmcffexk",
          "sku": "FAMILY-BOX",
          "expected": 5900,
          "actual": 5400,
          "message": "Price changed for FAMILY-BOX. Refresh to continue."
        },
        {
          "kind": "stale_total",
          "expected": 5400,
          "actual": 1,
          "message": "Order total changed (was 1¢, now 5400¢)."
        }
      ]
    },
    {
      "id": "S4",
      "check": "POS cash/check post+void; public reject",
      "pass": true,
      "publicStatus": 401,
      "cashOk": true,
      "checkOk": true,
      "voidOk": true,
      "audits": 9,
      "staffCashFirst": 400
    },
    {
      "id": "S5",
      "check": "Lifecycle transitions, numbering, discard, safety refund, payment recalc",
      "pass": true,
      "orderNumber": 42,
      "paymentStatus": "PAID",
      "badTransition": 409,
      "discarded": true,
      "recalc": "PAID",
      "safetyStillDraft": "DRAFT",
      "safetyAudit": 2
    }
  ]
}
```
