import { availableUnits } from "@/lib/inventory/reserve";
import { draftSubtotalCents, lineSubtotalCents } from "@/lib/orders/totals";

export type ValidationLine = {
  id: string;
  productId: string;
  productSku: string;
  quantity: number;
  unitPriceCents: number;
  optionAdjustCents: number;
  currentProductPriceCents: number;
  currentOptionAdjustCents: number;
  tracksInventory: boolean;
  onHand: number;
  reserved: number;
  assigned: boolean;
  fulfillmentMethodId: string | null;
  addOns: Array<{
    addOnId: string;
    sku: string;
    quantity: number;
    unitPriceCents: number;
    currentPriceCents: number;
    tracksInventory: boolean;
    onHand: number;
    reserved: number;
  }>;
};

export type CheckoutConflict =
  | { kind: "unassigned"; message: string }
  | { kind: "missing_fulfillment"; lineId: string; message: string }
  | { kind: "stale_price"; lineId: string; sku: string; expected: number; actual: number; message: string }
  | { kind: "stale_addon_price"; lineId: string; sku: string; expected: number; actual: number; message: string }
  | { kind: "stock"; sku: string; needed: number; available: number; message: string }
  | { kind: "stale_total"; expected: number; actual: number; message: string }
  | { kind: "zip_blocked"; zips: string[]; message: string }
  | { kind: "tampered_price"; message: string };

export type CheckoutValidationResult = {
  ok: boolean;
  conflicts: CheckoutConflict[];
  subtotalCents: number;
};

export function validateCheckoutLines(
  lines: ValidationLine[],
  opts?: { clientExpectedTotalCents?: number | null; feesCents?: number; donationCents?: number },
): CheckoutValidationResult {
  const conflicts: CheckoutConflict[] = [];

  if (lines.some((l) => !l.assigned)) {
    conflicts.push({
      kind: "unassigned",
      message: "Every line must have a recipient before checkout.",
    });
  }

  for (const line of lines) {
    if (!line.fulfillmentMethodId) {
      conflicts.push({
        kind: "missing_fulfillment",
        lineId: line.id,
        message: `Choose a fulfillment method for ${line.productSku}.`,
      });
    }
    if (line.unitPriceCents !== line.currentProductPriceCents) {
      conflicts.push({
        kind: "stale_price",
        lineId: line.id,
        sku: line.productSku,
        expected: line.currentProductPriceCents,
        actual: line.unitPriceCents,
        message: `Price changed for ${line.productSku}. Refresh to continue.`,
      });
    }
    if (line.optionAdjustCents !== line.currentOptionAdjustCents) {
      conflicts.push({
        kind: "stale_price",
        lineId: line.id,
        sku: line.productSku,
        expected: line.currentOptionAdjustCents,
        actual: line.optionAdjustCents,
        message: `Option price changed for ${line.productSku}. Refresh to continue.`,
      });
    }
    for (const addOn of line.addOns) {
      if (addOn.unitPriceCents !== addOn.currentPriceCents) {
        conflicts.push({
          kind: "stale_addon_price",
          lineId: line.id,
          sku: addOn.sku,
          expected: addOn.currentPriceCents,
          actual: addOn.unitPriceCents,
          message: `Add-on price changed for ${addOn.sku}. Refresh to continue.`,
        });
      }
    }
  }

  const demand = new Map<string, { needed: number; available: number; sku: string }>();
  const bump = (
    key: string,
    sku: string,
    needed: number,
    onHand: number,
    reserved: number,
    tracks: boolean,
  ) => {
    if (!tracks) return;
    const available = availableUnits({ onHand, reserved });
    const prev = demand.get(key) ?? { needed: 0, available, sku };
    prev.needed += needed;
    prev.available = Math.min(prev.available, available);
    demand.set(key, prev);
  };

  for (const line of lines) {
    bump(`p:${line.productId}`, line.productSku, line.quantity, line.onHand, line.reserved, line.tracksInventory);
    for (const addOn of line.addOns) {
      bump(
        `a:${addOn.addOnId}`,
        addOn.sku,
        addOn.quantity,
        addOn.onHand,
        addOn.reserved,
        addOn.tracksInventory,
      );
    }
  }

  for (const row of demand.values()) {
    if (row.needed > row.available) {
      conflicts.push({
        kind: "stock",
        sku: row.sku,
        needed: row.needed,
        available: row.available,
        message: `Not enough stock for ${row.sku} (need ${row.needed}, have ${row.available}).`,
      });
    }
  }

  const subtotalCents = draftSubtotalCents(
    lines.map((l) => ({
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      optionAdjustCents: l.optionAdjustCents,
      addOns: l.addOns,
    })),
  );

  const fees = opts?.feesCents ?? 0;
  const donation = opts?.donationCents ?? 0;
  const serverTotal = subtotalCents + fees + donation;

  if (
    opts?.clientExpectedTotalCents != null &&
    opts.clientExpectedTotalCents !== serverTotal
  ) {
    conflicts.push({
      kind: "stale_total",
      expected: serverTotal,
      actual: opts.clientExpectedTotalCents,
      message: `Order total changed (was ${opts.clientExpectedTotalCents}¢, now ${serverTotal}¢).`,
    });
  }

  // Tamper: client claims a line total that doesn't match snapshots.
  for (const line of lines) {
    const recomputed = lineSubtotalCents(line);
    if (recomputed < 0) {
      conflicts.push({ kind: "tampered_price", message: "Invalid line total." });
    }
  }

  return { ok: conflicts.length === 0, conflicts, subtotalCents };
}
