"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export interface ProductFormInitial {
  id: string;
  seasonId: string;
  name: string;
  description: string | null;
  kind: string;
  basePriceDollars: string;
  category: string | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  weightGrams: number | null;
  trackInventory: boolean;
  allowBackorder: boolean;
  active: boolean;
  replacedById: string | null;
  addOnIds: string[];
}

interface SeasonOption {
  id: string;
  name: string;
  status: string;
}

interface ReplacementOption {
  id: string;
  name: string;
}

interface AddOnOption {
  id: string;
  name: string;
  active: boolean;
}

function numberOrNull(form: FormData, key: string): number | null {
  const raw = String(form.get(key) ?? "").trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

// R-065: one form for create and edit. Create posts and navigates to the new
// product's detail page; edit patches in place. Options are managed on the
// detail page (options manager), not here.
export function ProductForm({
  mode,
  seasons,
  replacementOptions,
  addOnOptions,
  initial,
}: {
  mode: "create" | "edit";
  seasons: SeasonOption[];
  replacementOptions: ReplacementOption[];
  addOnOptions: AddOnOption[];
  initial: ProductFormInitial;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const payload = {
      seasonId: String(form.get("seasonId")),
      name: String(form.get("name")),
      ...(mode === "create" ? { slug: String(form.get("slug") ?? "").trim() || undefined } : {}),
      description: String(form.get("description") ?? "") || null,
      kind: String(form.get("kind")),
      basePriceDollars: Number(String(form.get("basePriceDollars"))),
      category: String(form.get("category") ?? "") || null,
      lengthMm: numberOrNull(form, "lengthMm"),
      widthMm: numberOrNull(form, "widthMm"),
      heightMm: numberOrNull(form, "heightMm"),
      weightGrams: numberOrNull(form, "weightGrams"),
      trackInventory: form.get("trackInventory") === "on",
      allowBackorder: form.get("allowBackorder") === "on",
      active: form.get("active") === "on",
      replacedById: String(form.get("replacedById") ?? "") || null,
      addOnIds: form.getAll("addOnIds").map(String),
    };

    const { ok, body } =
      mode === "create"
        ? await apiFetch<{ product?: { id: string } }>("/api/admin/products", {
            method: "POST",
            body: payload,
          })
        : await apiFetch(`/api/admin/products/${initial.id}`, { method: "PATCH", body: payload });
    setIsSubmitting(false);

    if (!ok) {
      setError(body.error ?? "Could not save the product");
      return;
    }
    if (mode === "create") {
      const created = (body as { product?: { id: string } }).product;
      router.push(created ? `/admin/products/${created.id}` : "/admin/products");
    }
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required defaultValue={initial.name} />
      </div>
      <div>
        <Label htmlFor="seasonId">Season</Label>
        <Select id="seasonId" name="seasonId" defaultValue={initial.seasonId} className="w-full">
          {seasons.map((season) => (
            <option key={season.id} value={season.id}>
              {season.name}
              {season.status === "OPEN" ? " (open)" : ""}
            </option>
          ))}
        </Select>
      </div>
      {mode === "create" && (
        <div className="sm:col-span-2">
          <Label htmlFor="slug">Slug (optional)</Label>
          <Input id="slug" name="slug" placeholder="Derived from the name when blank" />
          <p className="mt-1 text-xs text-stone-500">
            Set this when the name matches a past season&apos;s product — e.g. classic-mishloach-manos-2027.
          </p>
        </div>
      )}
      <div className="sm:col-span-2">
        <Label htmlFor="description">Description</Label>
        <Input id="description" name="description" defaultValue={initial.description ?? ""} />
      </div>
      <div>
        <Label htmlFor="kind">Kind</Label>
        <Select id="kind" name="kind" defaultValue={initial.kind} className="w-full">
          <option value="GOOD">Good</option>
          <option value="BUNDLE">Bundle</option>
          <option value="SERVICE">Service</option>
        </Select>
      </div>
      <div>
        <Label htmlFor="basePriceDollars">Base price ($)</Label>
        <Input
          id="basePriceDollars"
          name="basePriceDollars"
          type="number"
          step="0.01"
          min="0"
          required
          defaultValue={initial.basePriceDollars}
        />
      </div>
      <div>
        <Label htmlFor="category">Category</Label>
        <Input id="category" name="category" defaultValue={initial.category ?? ""} placeholder="Packages" />
      </div>
      <div>
        <Label htmlFor="weightGrams">Weight (g)</Label>
        <Input id="weightGrams" name="weightGrams" type="number" min="1" defaultValue={initial.weightGrams ?? ""} />
      </div>
      <div className="grid grid-cols-3 gap-2 sm:col-span-2">
        <div>
          <Label htmlFor="lengthMm">L (mm)</Label>
          <Input id="lengthMm" name="lengthMm" type="number" min="1" defaultValue={initial.lengthMm ?? ""} />
        </div>
        <div>
          <Label htmlFor="widthMm">W (mm)</Label>
          <Input id="widthMm" name="widthMm" type="number" min="1" defaultValue={initial.widthMm ?? ""} />
        </div>
        <div>
          <Label htmlFor="heightMm">H (mm)</Label>
          <Input id="heightMm" name="heightMm" type="number" min="1" defaultValue={initial.heightMm ?? ""} />
        </div>
      </div>

      <fieldset className="flex flex-col gap-2 rounded-md border border-stone-200 p-3">
        <legend className="px-1 text-sm font-medium text-stone-700">Flags</legend>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" name="trackInventory" defaultChecked={initial.trackInventory} className="h-4 w-4 accent-brand-700" />
          Track inventory
        </label>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" name="allowBackorder" defaultChecked={initial.allowBackorder} className="h-4 w-4 accent-brand-700" />
          Allow backorder
        </label>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" name="active" defaultChecked={initial.active} className="h-4 w-4 accent-brand-700" />
          Visible in storefront
        </label>
      </fieldset>

      {mode === "edit" && (
        <div>
          <Label htmlFor="replacedById">Replaced by (next season&apos;s equivalent)</Label>
          <Select
            id="replacedById"
            name="replacedById"
            defaultValue={initial.replacedById ?? ""}
            className="w-full"
          >
            <option value="">— no replacement —</option>
            {replacementOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      <fieldset className="rounded-md border border-stone-200 p-3 sm:col-span-2">
        <legend className="px-1 text-sm font-medium text-stone-700">Allowed add-ons</legend>
        {addOnOptions.length === 0 ? (
          <p className="text-sm text-stone-500">No add-ons yet — create them under Add-ons.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {addOnOptions.map((addOn) => (
              <label key={addOn.id} className="flex items-center gap-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  name="addOnIds"
                  value={addOn.id}
                  defaultChecked={initial.addOnIds.includes(addOn.id)}
                  className="h-4 w-4 accent-brand-700"
                />
                {addOn.name}
                {!addOn.active && <span className="text-xs text-stone-400">(inactive)</span>}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : mode === "create" ? "Create product" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
