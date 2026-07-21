export type LineMoney = {
  quantity: number;
  unitPriceCents: number;
  optionAdjustCents: number;
  addOns?: Array<{ quantity: number; unitPriceCents: number }>;
};

export function lineSubtotalCents(line: LineMoney): number {
  const base = (line.unitPriceCents + line.optionAdjustCents) * line.quantity;
  const addOns = (line.addOns ?? []).reduce(
    (sum, a) => sum + a.unitPriceCents * a.quantity,
    0,
  );
  return base + addOns;
}

export function draftSubtotalCents(lines: LineMoney[]): number {
  return lines.reduce((sum, line) => sum + lineSubtotalCents(line), 0);
}
