# PHASE-P7-SMOKE

Base: http://127.0.0.1:3103
Passed: 16 / 16
Failed: 0

| ID | Check | Pass |
|---|---|---|
| S1a | Finalize materializes packages via grouping (2 recipients × 2 methods → 2 packages) | PASS |
| S1b | Packages have distinct methods and item counts | PASS |
| S1c | Split one package via API | PASS |
| S1d | After split: 3 packages; audit retained on source | PASS |
| S1e | Split packages both included in print reprint-order | PASS |
| S1f | PACKAGE_SPLIT audit retained | PASS |
| S2a | Print all artifacts → no stage change | PASS |
| S2b | Printed artifacts download as PDF | PASS |
| S2c | Mark Printed separately | PASS |
| S2d | Mark Packed separately | PASS |
| S2e | Mark Sent separately | PASS |
| S2f | Staff package board + fulfillment + print pages load | PASS |
| S3a | Nightly batch twice → second idempotent | PASS |
| S3b | Reprint one group + one order without unrelated regen of nightly | PASS |
| S3c | Printed packages still unshipped (except explicitly marked Sent) | PASS |
| S3d | Fulfillment channel dashboard returns summaries | PASS |

## Details

```json
[
  {
    "id": "S1a",
    "check": "Finalize materializes packages via grouping (2 recipients × 2 methods → 2 packages)",
    "pass": true,
    "packageCount": 2,
    "error": null
  },
  {
    "id": "S1b",
    "check": "Packages have distinct methods and item counts",
    "pass": true,
    "methods": [
      "SHIP",
      "PICKUP"
    ],
    "itemCounts": [
      2,
      2
    ]
  },
  {
    "id": "S1c",
    "check": "Split one package via API",
    "pass": true,
    "status": 200,
    "body": {
      "ok": true,
      "sourceId": "cmrv51eij000aqx4oyphsryle",
      "newPackageId": "cmrv51ezb04dbqxhcenbsdv2l"
    }
  },
  {
    "id": "S1d",
    "check": "After split: 3 packages; audit retained on source",
    "pass": true,
    "packageCount": 3
  },
  {
    "id": "S1e",
    "check": "Split packages both included in print reprint-order",
    "pass": true,
    "body": {
      "ok": true,
      "batchId": "cmrv51f6g04dlqxhcmviep148",
      "runKey": "reprint-order:cmrv51egr0003qx4obsqj4yru:36942662b60d",
      "created": true,
      "artifactCount": 7,
      "packageCount": 3,
      "stagesUnchanged": true,
      "packageStages": [
        {
          "id": "cmrv51eij000aqx4oyphsryle",
          "stage": "NEW",
          "orderId": "cmrv51egr0003qx4obsqj4yru"
        },
        {
          "id": "cmrv51eiu000hqx4o70ji4pcl",
          "stage": "NEW",
          "orderId": "cmrv51egr0003qx4obsqj4yru"
        },
        {
          "id": "cmrv51ezb04dbqxhcenbsdv2l",
          "stage": "NEW",
          "orderId": "cmrv51egr0003qx4obsqj4yru"
        }
      ]
    }
  },
  {
    "id": "S1f",
    "check": "PACKAGE_SPLIT audit retained",
    "pass": true,
    "auditId": "cmrv51ezj04djqxhc7x1dkjdc"
  },
  {
    "id": "S2a",
    "check": "Print all artifacts → no stage change",
    "pass": true,
    "stagesBefore": {
      "cmrv51eij000aqx4oyphsryle": "NEW",
      "cmrv51eiu000hqx4o70ji4pcl": "NEW",
      "cmrv51ezb04dbqxhcenbsdv2l": "NEW"
    },
    "stagesAfter": {
      "cmrv51eij000aqx4oyphsryle": "NEW",
      "cmrv51eiu000hqx4o70ji4pcl": "NEW",
      "cmrv51ezb04dbqxhcenbsdv2l": "NEW"
    }
  },
  {
    "id": "S2b",
    "check": "Printed artifacts download as PDF",
    "pass": true,
    "artifactCount": 7
  },
  {
    "id": "S2c",
    "check": "Mark Printed separately",
    "pass": true,
    "stage": "PRINTED"
  },
  {
    "id": "S2d",
    "check": "Mark Packed separately",
    "pass": true,
    "stage": "PACKED"
  },
  {
    "id": "S2e",
    "check": "Mark Sent separately",
    "pass": true,
    "stage": "SENT"
  },
  {
    "id": "S2f",
    "check": "Staff package board + fulfillment + print pages load",
    "pass": true,
    "board": 200,
    "fulfill": 200,
    "print": 200
  },
  {
    "id": "S3a",
    "check": "Nightly batch twice → second idempotent",
    "pass": true,
    "first": {
      "ok": true,
      "batchId": "cmrv51hpp04e8qxhcqn9vjs6i",
      "runKey": "nightly:cmruro40z0007qx5wepn8bspr:2099-06-16",
      "created": true,
      "artifactCount": 1041,
      "packageCount": 5045,
      "stagesUnchanged": true
    },
    "second": {
      "ok": true,
      "batchId": "cmrv51hpp04e8qxhcqn9vjs6i",
      "runKey": "nightly:cmruro40z0007qx5wepn8bspr:2099-06-16",
      "created": false,
      "artifactCount": 1041,
      "packageCount": 5045,
      "stagesUnchanged": true
    }
  },
  {
    "id": "S3b",
    "check": "Reprint one group + one order without unrelated regen of nightly",
    "pass": true,
    "batchCountBefore": 31,
    "batchCountAfter": 33,
    "expectedDelta": 2,
    "reprintGroup": {
      "ok": true,
      "batchId": "cmrv51iqo0579qxhcje0kf8y1",
      "runKey": "reprint-group:cmruro40z0007qx5wepn8bspr:PICKUP:68379cb62d58",
      "created": true,
      "artifactCount": 22,
      "packageCount": 22,
      "stagesUnchanged": true
    },
    "reprintOrder": {
      "ok": true,
      "batchId": "cmrv51iry057zqxhc5pjy750w",
      "runKey": "reprint-order:cmrv51egr0003qx4obsqj4yru:e0f9fffec2ba",
      "created": true,
      "artifactCount": 7,
      "packageCount": 3,
      "stagesUnchanged": true,
      "packageStages": [
        {
          "id": "cmrv51eij000aqx4oyphsryle",
          "stage": "SENT",
          "orderId": "cmrv51egr0003qx4obsqj4yru"
        },
        {
          "id": "cmrv51eiu000hqx4o70ji4pcl",
          "stage": "NEW",
          "orderId": "cmrv51egr0003qx4obsqj4yru"
        },
        {
          "id": "cmrv51ezb04dbqxhcenbsdv2l",
          "stage": "NEW",
          "orderId": "cmrv51egr0003qx4obsqj4yru"
        }
      ]
    }
  },
  {
    "id": "S3c",
    "check": "Printed packages still unshipped (except explicitly marked Sent)",
    "pass": true,
    "stages": [
      {
        "id": "cmrv51eiu000hqx4o70ji4pcl",
        "stage": "NEW"
      },
      {
        "id": "cmrv51ezb04dbqxhcenbsdv2l",
        "stage": "NEW"
      },
      {
        "id": "cmrv51eij000aqx4oyphsryle",
        "stage": "SENT"
      }
    ]
  },
  {
    "id": "S3d",
    "check": "Fulfillment channel dashboard returns summaries",
    "pass": true,
    "channelCount": 5
  }
]
```
