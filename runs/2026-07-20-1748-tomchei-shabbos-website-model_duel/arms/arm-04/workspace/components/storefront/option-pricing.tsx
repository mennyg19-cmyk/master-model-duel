"use client";

import { useState } from "react";
import { formatCents } from "@/lib/catalog";

type PricedOption = { id: string; name: string; priceAdjustmentCents: number };

/** Live price as options are toggled (R-017). Ordering itself arrives in P4. */
export function OptionPricing({
  basePriceCents,
  options,
}: {
  basePriceCents: number;
  options: PricedOption[];
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const total =
    basePriceCents +
    options.filter((option) => selectedIds.has(option.id)).reduce((sum, option) => sum + option.priceAdjustmentCents, 0);

  function toggle(optionId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(optionId)) next.delete(optionId);
      else next.add(optionId);
      return next;
    });
  }

  return (
    <div>
      {options.length > 0 && (
        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Options</legend>
          <ul className="mt-2 space-y-2">
            {options.map((option) => (
              <li key={option.id}>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(option.id)}
                    onChange={() => toggle(option.id)}
                    className="accent-brand"
                  />
                  {option.name}
                  <span className="text-muted">+{formatCents(option.priceAdjustmentCents)}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <p className="mt-4 text-xl font-bold text-brand-strong" data-testid="live-price">
        {formatCents(total)}
      </p>
    </div>
  );
}
