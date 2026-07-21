"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Season = { id: string; name: string; year: number; slug: string };
type Product = {
  id: string;
  seasonId: string;
  sku: string;
  name: string;
  slug: string;
  category: string | null;
  description: string | null;
  basePriceCents: number;
  isActive: boolean;
  primaryImageUrl: string | null;
  mediaAssetId: string | null;
  inventory: { onHand: number; reserved: number } | null;
  replacementsFrom: { toProductId: string }[];
};

const emptyForm = (seasonId = "") => ({
  id: "",
  seasonId,
  sku: "",
  name: "",
  slug: "",
  category: "Packages",
  description: "",
  basePriceCents: 5400,
  onHand: 10,
  replacementToProductIds: "" as string,
});

export function CatalogAdmin() {
  const [products, setProducts] = useState<Product[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());

  async function load() {
    const res = await fetch("/api/admin/catalog");
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error || "Failed to load catalog");
      return;
    }
    setProducts(json.products);
    setSeasons(json.seasons);
    if (!form.seasonId && json.seasons[0]) {
      setForm((f) => ({ ...f, seasonId: json.seasons[0].id }));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await fetch("/api/admin/catalog", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: form.id || undefined,
        seasonId: form.seasonId,
        sku: form.sku,
        name: form.name,
        slug: form.slug,
        category: form.category || null,
        description: form.description || null,
        basePriceCents: Number(form.basePriceCents),
        onHand: Number(form.onHand),
        options: form.id
          ? undefined
          : [
              { name: "Standard", priceAdjustmentCents: 0, sortOrder: 1 },
              { name: "Deluxe", priceAdjustmentCents: 1200, sortOrder: 2 },
            ],
        replacementToProductIds: form.replacementToProductIds
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error || "Save failed");
      return;
    }
    setMessage(`Saved ${json.product.name}`);
    setForm(emptyForm(form.seasonId || seasons[0]?.id || ""));
    await load();
  }

  function edit(product: Product) {
    setForm({
      id: product.id,
      seasonId: product.seasonId,
      sku: product.sku,
      name: product.name,
      slug: product.slug,
      category: product.category || "",
      description: product.description || "",
      basePriceCents: product.basePriceCents,
      onHand: product.inventory?.onHand ?? 0,
      replacementToProductIds: product.replacementsFrom.map((r) => r.toProductId).join(","),
    });
  }

  async function remove(product: Product) {
    if (!window.confirm(`Delete ${product.name}?`)) return;
    setMessage(null);
    const res = await fetch("/api/admin/catalog", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: product.id }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error || "Delete failed");
      return;
    }
    setMessage(`Deleted ${product.name}`);
    if (form.id === product.id) setForm(emptyForm(form.seasonId || seasons[0]?.id || ""));
    await load();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={save} className="grid gap-3 rounded-[var(--radius-lg)] bg-white p-4 shadow-sm md:grid-cols-2">
        <h2 className="md:col-span-2 font-semibold text-[var(--color-forest)]">
          {form.id ? "Edit product" : "New product"}
        </h2>
        <label className="text-sm">
          Season
          <select
            className="mt-1 w-full rounded border px-2 py-1.5"
            value={form.seasonId}
            onChange={(e) => setForm({ ...form, seasonId: e.target.value })}
            required
          >
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Category
          <input
            className="mt-1 w-full rounded border px-2 py-1.5"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          />
        </label>
        <label className="text-sm">
          SKU
          <input
            className="mt-1 w-full rounded border px-2 py-1.5"
            value={form.sku}
            onChange={(e) => setForm({ ...form, sku: e.target.value })}
            required
          />
        </label>
        <label className="text-sm">
          Slug
          <input
            className="mt-1 w-full rounded border px-2 py-1.5"
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            required
          />
        </label>
        <label className="text-sm md:col-span-2">
          Name
          <input
            className="mt-1 w-full rounded border px-2 py-1.5"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </label>
        <label className="text-sm md:col-span-2">
          Description
          <textarea
            className="mt-1 w-full rounded border px-2 py-1.5"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
          />
        </label>
        <label className="text-sm">
          Price (cents)
          <input
            type="number"
            className="mt-1 w-full rounded border px-2 py-1.5"
            value={form.basePriceCents}
            onChange={(e) => setForm({ ...form, basePriceCents: Number(e.target.value) })}
            required
          />
        </label>
        <label className="text-sm">
          On hand
          <input
            type="number"
            className="mt-1 w-full rounded border px-2 py-1.5"
            value={form.onHand}
            onChange={(e) => setForm({ ...form, onHand: Number(e.target.value) })}
          />
        </label>
        <label className="text-sm md:col-span-2">
          Replacement link targets (product ids, comma-separated) — editor shell
          <input
            className="mt-1 w-full rounded border px-2 py-1.5"
            value={form.replacementToProductIds}
            onChange={(e) => setForm({ ...form, replacementToProductIds: e.target.value })}
            placeholder="productId1, productId2"
            data-testid="replacement-editor"
          />
        </label>
        <div className="md:col-span-2 flex gap-2">
          <Button type="submit">Save product</Button>
          {form.id ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setForm(emptyForm(seasons[0]?.id || form.seasonId))}
            >
              Clear
            </Button>
          ) : null}
        </div>
        {message ? <p className="md:col-span-2 text-sm">{message}</p> : null}
      </form>

      <ul className="space-y-2" data-testid="admin-product-list">
        {products.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-white px-3 py-2 text-sm shadow-sm">
            <span>
              <strong>{p.name}</strong> · {p.sku} · {(p.basePriceCents / 100).toFixed(2)}
              {p.category ? ` · ${p.category}` : ""}
              {p.inventory ? ` · on hand ${p.inventory.onHand}` : ""}
            </span>
            <span className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => edit(p)}>
                Edit
              </Button>
              <Button type="button" variant="secondary" onClick={() => void remove(p)}>
                Delete
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
