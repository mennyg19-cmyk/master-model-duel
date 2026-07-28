"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { formatDelta } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface ManagedOption {
  name: string;
  values: { label: string; priceDeltaCents: number }[];
}

// R-146: option editor — add options and values with price adjustments.
// Upsert-only (no delete): paid order snapshots hold RESTRICT references to
// option values, so removal is deliberately not offered.
export function OptionsManager({ productId, options }: { productId: string; options: ManagedOption[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function submit(payload: { name: string; values: { label: string; priceDeltaDollars: number }[] }[]) {
    setIsSaving(true);
    setError(null);
    const { ok, body } = await apiFetch(`/api/admin/products/${productId}`, {
      method: "PATCH",
      body: { options: payload },
    });
    setIsSaving(false);
    if (!ok) {
      setError(body.error ?? "Could not save the option");
      return false;
    }
    router.refresh();
    return true;
  }

  async function onAddOption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("optionName") ?? "").trim();
    const label = String(form.get("firstValue") ?? "").trim();
    const delta = Number(String(form.get("firstDelta") ?? "0")) || 0;
    if (!name || !label) return;
    const saved = await submit([{ name, values: [{ label, priceDeltaDollars: delta }] }]);
    if (saved) (event.target as HTMLFormElement).reset();
  }

  async function onAddValue(event: FormEvent<HTMLFormElement>, optionName: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const label = String(form.get("valueLabel") ?? "").trim();
    const delta = Number(String(form.get("valueDelta") ?? "0")) || 0;
    if (!label) return;
    const saved = await submit([{ name: optionName, values: [{ label, priceDeltaDollars: delta }] }]);
    if (saved) (event.target as HTMLFormElement).reset();
  }

  return (
    <div className="mt-3 flex flex-col gap-5">
      {options.length === 0 && (
        <p className="text-sm text-stone-500">No options yet — add one below (e.g. Size with Standard/Deluxe).</p>
      )}

      {options.map((option) => (
        <div key={option.name} className="rounded-md border border-stone-200 p-3">
          <p className="text-sm font-medium text-stone-900">{option.name}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {option.values.map((value) => (
              <li key={value.label} className="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-700">
                {value.label} ({formatDelta(value.priceDeltaCents)})
              </li>
            ))}
          </ul>
          <form onSubmit={(event) => onAddValue(event, option.name)} className="mt-3 flex gap-2">
            <Input name="valueLabel" placeholder="New value" required className="max-w-[10rem]" />
            <Input name="valueDelta" type="number" step="0.01" placeholder="+$0.00" className="max-w-[7rem]" />
            <Button type="submit" size="sm" variant="secondary" disabled={isSaving}>
              Add value
            </Button>
          </form>
        </div>
      ))}

      <form onSubmit={onAddOption} className="rounded-md border border-dashed border-stone-300 p-3">
        <p className="text-sm font-medium text-stone-700">New option</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Input name="optionName" placeholder="Option name (e.g. Size)" required className="max-w-[12rem]" />
          <Input name="firstValue" placeholder="First value" required className="max-w-[10rem]" />
          <Input name="firstDelta" type="number" step="0.01" placeholder="+$0.00" className="max-w-[7rem]" />
          <Button type="submit" size="sm" disabled={isSaving}>
            {isSaving ? "Saving…" : "Add option"}
          </Button>
        </div>
        <p className="mt-2 text-xs text-stone-500">
          Options can&apos;t be deleted once orders reference them; re-pricing a value updates future
          orders only (snapshots stay frozen).
        </p>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
