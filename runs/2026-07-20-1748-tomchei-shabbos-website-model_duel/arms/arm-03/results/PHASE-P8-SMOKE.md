# PHASE-P8-SMOKE

**Arm:** arm-03  
**Base:** http://127.0.0.1:3103  
**Mode:** SHIPPO_MODE=mock  
**Passed:** 3 / 3  
**Failed:** 0  

| ID | Check | Pass |
|---|---|---|
| S1 | Margin math: charge highest, buy cheaper, stored margin exact | PASS |
| S2 | Void + rebuy; checkout live Shippo quotes | PASS |
| S3 | Printed-but-unshipped voidable; route-assigned blocked (P9 stub) | PASS |

## S1 evidence

- Even zip `11218`: charge 1800¢ (USPS), buy 1200¢ (UPS), margin 600¢; shipment plan boxes=1
- Odd zip `11219`: charge 1800¢ (USPS), buy 1200¢ (FedEx), margin 600¢

## S2 evidence

- Void + rebuy OK on even package
- Checkout prepare `liveShip=true`, `shipFeeCents=1800`, quotes charge 1800 / buy 1200

## S3 evidence

- PRINTED package label still voidable
- After `stubAssignLabelToRoute`, void returns 409 with route message (P9 hook)

## Details

```json
[
  {
    "id": "S1",
    "check": "Margin math: charge highest, buy cheaper, stored margin exact",
    "pass": true,
    "even": {
      "chargedCents": 1800,
      "purchasedCents": 1200,
      "marginCents": 600,
      "buyCarrier": "ups",
      "planBoxes": 1
    },
    "odd": {
      "chargedCents": 1800,
      "purchasedCents": 1200,
      "marginCents": 600,
      "buyCarrier": "fedex"
    },
    "createEvenStatus": 200,
    "createOddStatus": 200
  },
  {
    "id": "S2",
    "check": "Void + rebuy; checkout live Shippo quotes",
    "pass": true,
    "voidOk": true,
    "rebuyOk": true,
    "liveShip": true,
    "shipFeeCents": 1800,
    "shipQuotes": [
      {
        "destinationKey": "live rate|22 rate ave|brooklyn|ny|11218|us",
        "chargedCents": 1800,
        "purchasedCents": 1200,
        "marginCents": 600,
        "chargeCarrier": "usps",
        "buyCarrier": "ups"
      }
    ],
    "prepError": []
  },
  {
    "id": "S3",
    "check": "Printed-but-unshipped voidable; route-assigned blocked (P9 stub)",
    "pass": true,
    "voidPrintedOk": true,
    "voidRoutedStatus": 409,
    "voidRoutedError": "Label is assigned to a route and cannot be voided here (P9)"
  }
]
```
