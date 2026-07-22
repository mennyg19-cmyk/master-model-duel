# PHASE-P11-SMOKE

**Arm:** arm-03
**Base:** http://127.0.0.1:3103
**Passed:** 5 / 5
**Failed:** 0

| ID | Check | Pass |
|---|---|---|
| S1 | Preferences + tokens | PASS |
| S2 | Campaign flow + idempotent rerun | PASS |
| S3 | Transactional + failure trail | PASS |
| S4 | Cron auth + overlap | PASS |
| S5 | Purge + test mode + SMS | PASS |

## Details

```json
[
  {
    "id": "S1",
    "check": "Preferences + tokens",
    "pass": true,
    "subscribed": true,
    "threeStates": true,
    "tamperedRejected": true,
    "expiredRejected": true,
    "unsubscribed": true,
    "noTokenLeak": true
  },
  {
    "id": "S2",
    "check": "Campaign flow + idempotent rerun",
    "pass": true,
    "campaignId": "cmrvddwkf0008qxfc5g90hu6g",
    "created": 5,
    "skippedRerun": 5,
    "rerunCreated": 0,
    "deliveries": 5,
    "sweeps": 1
  },
  {
    "id": "S3",
    "check": "Transactional + failure trail",
    "pass": true,
    "enqueued": [
      "PENDING",
      "PENDING",
      "PENDING"
    ],
    "failSweep": {
      "retried": 3
    },
    "okSweep": {
      "sent": 3
    },
    "outboxCount": 3,
    "uniqueKeys": 3,
    "rerunCreated": false,
    "failedBefore": 3
  },
  {
    "id": "S4",
    "check": "Cron auth + overlap",
    "pass": true,
    "missing": [
      401,
      401,
      401,
      401,
      401,
      401
    ],
    "wrong": [
      401,
      401,
      401,
      401,
      401,
      401
    ],
    "correct": [
      200,
      200,
      200,
      200,
      200,
      200
    ],
    "overlap": {
      "o1": {
        "held": true
      },
      "o2": {
        "skipped": true,
        "reason": "overlap"
      }
    },
    "raceClaimed": 1,
    "raceFinal": "SENT"
  },
  {
    "id": "S5",
    "check": "Purge + test mode + SMS",
    "pass": true,
    "purgeResult": {
      "scanned": 2,
      "deleted": 1,
      "skippedActive": 1,
      "retentionDays": 90
    },
    "keepLog": true,
    "purgedGone": true,
    "outboxKept": true,
    "testCaptured": true,
    "smsCaptured": true,
    "emailMode": "mock",
    "smsMode": "capture",
    "smsSweep": "captured"
  }
]
```
