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
    "campaignId": "cmrv7wqx700j4qx4suqy9ytzl",
    "created": 15,
    "skippedRerun": 15,
    "rerunCreated": 0,
    "deliveries": 15
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
      "workerId": "smoke-p11-fail",
      "claimed": 3,
      "sent": 0,
      "failed": 3,
      "captured": 0
    },
    "okSweep": {
      "workerId": "smoke-p11-ok",
      "claimed": 3,
      "sent": 0,
      "failed": 0,
      "captured": 3
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
      401
    ],
    "wrong": [
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
      200
    ],
    "overlap": {
      "o1": {
        "ok": true,
        "skipped": false,
        "workerId": "cron_cmrv7ws6l00oyqx4s2shvs5oc_b96835",
        "claimed": 0,
        "sent": 0,
        "failed": 0,
        "captured": 0,
        "runId": "cmrv7ws6l00oyqx4s2shvs5oc"
      },
      "o2": {
        "ok": true,
        "skipped": true,
        "reason": "overlap",
        "token": "p11-overlap-1784672471444"
      }
    },
    "raceClaimed": 1,
    "raceFinal": "CAPTURED"
  },
  {
    "id": "S5",
    "check": "Purge + test mode + SMS",
    "pass": true,
    "purgeResult": {
      "scanned": 2,
      "deleted": 1,
      "skippedActive": 1
    },
    "keepLog": true,
    "purgedGone": true,
    "outboxKept": true,
    "testCaptured": true,
    "smsCaptured": true
  }
]
```

Pages: email-hub=200 preferences=200
