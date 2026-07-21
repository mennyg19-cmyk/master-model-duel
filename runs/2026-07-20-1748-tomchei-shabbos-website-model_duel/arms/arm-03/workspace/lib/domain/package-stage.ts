import type { FulfillmentKind, PackageStage } from "@prisma/client";

// Package stages are optional and forward-only (UR-001, G-004): staff may skip
// stages (NEW straight to SENT) but never move a package backward. Printing is
// a separate act and never drives these transitions (G-002).
const STAGE_ORDER: Record<PackageStage, number> = {
  NEW: 0,
  PRINTED: 1,
  PACKED: 2,
  SENT: 3,
  PICKED_UP: 3,
};

/** The terminal stage depends on the channel: pickup packages are picked up, everything else is sent. */
export function terminalStageFor(kind: FulfillmentKind): PackageStage {
  return kind === "PICKUP" ? "PICKED_UP" : "SENT";
}

export function allowedNextStages(current: PackageStage, kind: FulfillmentKind): PackageStage[] {
  const forward: PackageStage[] = ["PRINTED", "PACKED", terminalStageFor(kind)];
  return forward.filter((stage) => STAGE_ORDER[stage] > STAGE_ORDER[current]);
}

export function canAdvancePackage(
  current: PackageStage,
  to: PackageStage,
  kind: FulfillmentKind
): { ok: true } | { ok: false; reason: string } {
  if (to === "NEW") return { ok: false, reason: "A package cannot move back to New" };
  if (STAGE_ORDER[to] <= STAGE_ORDER[current]) {
    return { ok: false, reason: `Already at or past ${to} (currently ${current})` };
  }
  const terminal = terminalStageFor(kind);
  if ((to === "SENT" || to === "PICKED_UP") && to !== terminal) {
    return { ok: false, reason: `${kind === "PICKUP" ? "Pickup" : "This"} channel finishes at ${terminal}` };
  }
  return { ok: true };
}
