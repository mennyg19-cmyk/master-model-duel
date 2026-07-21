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
      "sourceId": "cmrv4vc1v000aqxesz9ghozq1",
      "newPackageId": "cmrv4vc3j03icqxhcmv13zj01"
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
      "batchId": "cmrv4vc4e03imqxhcqza5s78q",
      "runKey": "reprint-order:cmrv4vc0l0003qxesdfuoykfb:3b9b65adbaf8",
      "created": true,
      "artifactCount": 7,
      "packageCount": 3,
      "stagesUnchanged": true,
      "packageStages": [
        {
          "id": "cmrv4vc1v000aqxesz9ghozq1",
          "stage": "NEW",
          "orderId": "cmrv4vc0l0003qxesdfuoykfb"
        },
        {
          "id": "cmrv4vc1y000hqxesdptcn4cp",
          "stage": "NEW",
          "orderId": "cmrv4vc0l0003qxesdfuoykfb"
        },
        {
          "id": "cmrv4vc3j03icqxhcmv13zj01",
          "stage": "NEW",
          "orderId": "cmrv4vc0l0003qxesdfuoykfb"
        }
      ]
    }
  },
  {
    "id": "S1f",
    "check": "PACKAGE_SPLIT audit retained",
    "pass": true,
    "auditId": "cmrv4vc3m03ikqxhcmvmiza4d"
  },
  {
    "id": "S2a",
    "check": "Print all artifacts → no stage change",
    "pass": true,
    "stagesBefore": {
      "cmrv4vc1y000hqxesdptcn4cp": "NEW",
      "cmrv4vc1v000aqxesz9ghozq1": "NEW",
      "cmrv4vc3j03icqxhcmv13zj01": "NEW"
    },
    "stagesAfter": {
      "cmrv4vc1y000hqxesdptcn4cp": "NEW",
      "cmrv4vc1v000aqxesz9ghozq1": "NEW",
      "cmrv4vc3j03icqxhcmv13zj01": "NEW"
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
      "batchId": "cmrv4vd4k03j9qxhcnvolvrt2",
      "runKey": "nightly:cmruro40z0007qx5wepn8bspr:2099-06-04",
      "created": true,
      "artifactCount": 1040,
      "packageCount": 5043,
      "stagesUnchanged": true
    },
    "second": {
      "ok": true,
      "batchId": "cmrv4vd4k03j9qxhcnvolvrt2",
      "runKey": "nightly:cmruro40z0007qx5wepn8bspr:2099-06-04",
      "created": false,
      "artifactCount": 1040,
      "packageCount": 5043,
      "stagesUnchanged": true
    }
  },
  {
    "id": "S3b",
    "check": "Reprint one group + one order without unrelated regen of nightly",
    "pass": true,
    "batchCountBefore": 27,
    "batchCountAfter": 29,
    "expectedDelta": 2,
    "reprintGroup": {
      "ok": true,
      "batchId": "cmrv4ve1104c9qxhcn2cwsohr",
      "runKey": "reprint-group:cmruro40z0007qx5wepn8bspr:PICKUP:4afc672e09db",
      "created": true,
      "artifactCount": 21,
      "packageCount": 21,
      "stagesUnchanged": true
    },
    "reprintOrder": {
      "ok": true,
      "batchId": "cmrv4ve1w04cyqxhcvhahxdsl",
      "runKey": "reprint-order:cmrv4vc0l0003qxesdfuoykfb:811eb3b4002c",
      "created": true,
      "artifactCount": 7,
      "packageCount": 3,
      "stagesUnchanged": true,
      "packageStages": [
        {
          "id": "cmrv4vc1v000aqxesz9ghozq1",
          "stage": "SENT",
          "orderId": "cmrv4vc0l0003qxesdfuoykfb"
        },
        {
          "id": "cmrv4vc1y000hqxesdptcn4cp",
          "stage": "NEW",
          "orderId": "cmrv4vc0l0003qxesdfuoykfb"
        },
        {
          "id": "cmrv4vc3j03icqxhcmv13zj01",
          "stage": "NEW",
          "orderId": "cmrv4vc0l0003qxesdfuoykfb"
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
        "id": "cmrv4vc1y000hqxesdptcn4cp",
        "stage": "NEW"
      },
      {
        "id": "cmrv4vc3j03icqxhcmv13zj01",
        "stage": "NEW"
      },
      {
        "id": "cmrv4vc1v000aqxesz9ghozq1",
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
