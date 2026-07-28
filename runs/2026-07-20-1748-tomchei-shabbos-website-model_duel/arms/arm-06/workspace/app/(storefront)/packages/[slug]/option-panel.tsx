"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { formatCents, formatDelta } from "@/lib/money";
import { Button } from "@/components/ui/button";

export interface DetailOption {
  name: string;
  values: { label: string; priceDeltaCents: number }[];
}

// R-004: option pricing on the detail page — picking an option value updates
// the displayed price live (base + delta). The CTA heads to the order flow
// (cart lands in P4).
export function OptionPanel({
  slug,
  basePriceCents,
  options,
  addOns,
  soldOut,
}: {
  slug: string;
  basePriceCents: number;
  options: DetailOption[];
  addOns: { name: string; priceCents: number }[];
  soldOut: boolean;
}) {
  const router = useRouter();
  const [selections, setSelections] = useState<Record<string, number>>({});

  const totalCents =
    basePriceCents +
    options.reduce((sum, option) => {
      const selected = selections[option.name] ?? 0;
      return sum + (option.values[selected]?.priceDeltaCents ?? 0);
    }, 0);

  return (
    <div className="mt-6">
      {options.map((option) => {
        const selected = selections[option.name] ?? 0;
        return (
          <fieldset key={option.name} className="mb-4">
            <legend className="text-sm font-medium text-stone-700">{option.name}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {option.values.map((value, index) => (
                <button
                  key={value.label}
                  type="button"
                  aria-pressed={selected === index}
                  onClick={() => setSelections((current) => ({ ...current, [option.name]: index }))}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm",
                    selected === index
                      ? "border-brand-700 bg-brand-50 font-medium text-brand-900"
                      : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100",
                  )}
                >
                  {value.label}
                  <span className="ml-1 text-xs text-stone-500">{formatDelta(value.priceDeltaCents)}</span>
                </button>
              ))}
            </div>
          </fieldset>
        );
      })}

      {addOns.length > 0 && (
        <div className="mb-4">
          <p className="text-sm font-medium text-stone-700">Available add-ons</p>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-stone-600">
            {addOns.map((addOn) => (
              <li key={addOn.name}>
                {addOn.name} — {formatCents(addOn.priceCents)}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-stone-500">Add-ons are chosen during checkout.</p>
        </div>
      )}

      <div className="mt-6 flex items-center gap-4 border-t border-stone-200 pt-4">
        <span className="text-2xl font-bold text-stone-900" aria-live="polite">
          {formatCents(totalCents)}
        </span>
        <Button
          disabled={soldOut}
          onClick={() => router.push(`/order?product=${slug}`)}
          title={soldOut ? "This package is sold out" : "Start an order with this package"}
        >
          {soldOut ? "Sold out" : "Add to order"}
        </Button>
      </div>
    </div>
  );
}
