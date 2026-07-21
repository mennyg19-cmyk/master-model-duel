# PHASE-P9-SMOKE

**Arm:** arm-03
**Base:** http://127.0.0.1:3103
**Passed:** 5 / 5
**Failed:** 0

| ID | Check | Pass |
|---|---|---|
| S1 | Driver magic link | PASS |
| S2 | Maps + print fallback | PASS |
| S3 | Method switch + reroute | PASS |
| S4 | Bulk + day-of notify | PASS |
| S5 | Pickup + crons | PASS |

## Details

```json
[
  {
    "id": "S1",
    "check": "Driver magic link",
    "pass": true,
    "routeId": "cmrv6944z0067qxsgurw0qwz1",
    "linkId": "cmrv694c8006hqxsgoydhtyvk",
    "stopCount": 2,
    "throttled": true,
    "linkExpired": true,
    "auditHasLink": true,
    "magicUrl": "http://127.0.0.1:3103/d/69cThIvaRfo5qToXfe8QenL_eLf0gvMKNpCEfK_4FGA"
  },
  {
    "id": "S2",
    "check": "Maps + print fallback",
    "pass": true,
    "mapsOk": true,
    "mapsUrl": "https://www.google.com/maps/dir/?api=1&destination=500%20Community%20Ave%2C%20Brooklyn%2C%20NY%2C%2011218%2C%20US",
    "printHasAddress": true,
    "hasPdf": true,
    "delivered": true,
    "completed": true
  },
  {
    "id": "S3",
    "check": "Method switch + reroute",
    "pass": true,
    "feeBefore": 1800,
    "feeAfter": 1800,
    "voided": true,
    "noConfirmStatus": 400,
    "suggestionHit": true,
    "confirmed": true,
    "rejectSentStatus": 409
  },
  {
    "id": "S4",
    "check": "Bulk + day-of notify",
    "pass": true,
    "bulkOk": true,
    "emailBulk": true,
    "smsBulk": true,
    "dayEmail": 1,
    "daySms": 1
  },
  {
    "id": "S5",
    "check": "Pickup + crons",
    "pass": true,
    "notReady": {
      "ok": true,
      "ready": false,
      "reason": "inventory_unavailable"
    },
    "ready1": {
      "ready": true,
      "already": false
    },
    "ready2Already": true,
    "pickupNotes": 2,
    "stamped": true,
    "unclaimedHit": true,
    "cronNoAuth": 401,
    "cronOk": true,
    "payNoAuth": 401,
    "payOk": true,
    "doorBeforeStampNote": "door checked after stamp"
  }
]
```
