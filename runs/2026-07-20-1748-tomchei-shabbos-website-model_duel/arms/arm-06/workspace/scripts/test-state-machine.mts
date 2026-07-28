// Unit checks for the order state machine (R-044..R-046) and package stage
// rules (R-153/R-154). DB-backed finalize/discard paths are exercised in
// test-order-numbers.mts.
import {
  assertTransition,
  canTransition,
  IllegalTransitionError,
} from "../lib/orders/state-machine";
import { canAdvanceStage } from "../lib/packages/stages";

let failures = 0;

function check(label: string, condition: boolean) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`ok: ${label}`);
  }
}

// Legal order transitions
check("DRAFT → FINALIZED is legal", canTransition("DRAFT", "FINALIZED"));
check("DRAFT → DISCARDED is legal", canTransition("DRAFT", "DISCARDED"));

// Illegal order transitions
check("FINALIZED → DRAFT rejected", !canTransition("FINALIZED", "DRAFT"));
check("FINALIZED → DISCARDED rejected", !canTransition("FINALIZED", "DISCARDED"));
check("FINALIZED → FINALIZED rejected", !canTransition("FINALIZED", "FINALIZED"));
check("DISCARDED → FINALIZED rejected", !canTransition("DISCARDED", "FINALIZED"));
check("DISCARDED → DRAFT rejected", !canTransition("DISCARDED", "DRAFT"));

let threw = false;
try {
  assertTransition("FINALIZED", "DRAFT");
} catch (error) {
  threw = error instanceof IllegalTransitionError;
}
check("assertTransition throws IllegalTransitionError", threw);

// Package stages (delivery skips nothing, pickup skips printing)
const DELIVERY_STAGES = ["NEW", "PRINTED", "PACKED", "SENT"] as const;
const PICKUP_STAGES = ["NEW", "PACKED", "PICKED_UP"] as const;

check("NEW → PRINTED legal on delivery", canAdvanceStage("NEW", "PRINTED", DELIVERY_STAGES));
check("NEW → PACKED skip legal on delivery", canAdvanceStage("NEW", "PACKED", DELIVERY_STAGES));
check("PACKED → PRINTED backward rejected", !canAdvanceStage("PACKED", "PRINTED", DELIVERY_STAGES));
check("NEW → PICKED_UP rejected on delivery method", !canAdvanceStage("NEW", "PICKED_UP", DELIVERY_STAGES));
check("NEW → PACKED legal on pickup", canAdvanceStage("NEW", "PACKED", PICKUP_STAGES));
check("NEW → PRINTED rejected on pickup method", !canAdvanceStage("NEW", "PRINTED", PICKUP_STAGES));
check("SENT → PACKED rejected (terminal)", !canAdvanceStage("SENT", "PACKED", DELIVERY_STAGES));
check("stage → itself rejected", !canAdvanceStage("PACKED", "PACKED", DELIVERY_STAGES));

if (failures > 0) {
  console.error(`${failures} state machine check(s) failed`);
  process.exit(1);
}
console.log("All state machine checks passed");
