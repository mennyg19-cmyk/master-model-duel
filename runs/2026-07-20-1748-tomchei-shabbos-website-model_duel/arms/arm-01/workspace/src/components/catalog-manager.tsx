"use client";

import type { ProductKind } from "@prisma/client";
import { useState } from "react";
import { formatCurrency } from "@/lib/currency";

type SeasonChoice = { id: string; name: string; year: number };
type ManagedProduct = {
  id: string;
  seasonId: string;
  sku: string;
  name: string;
  description: string | null;
  category: string;
  kind: ProductKind;
  priceCents: number;
  imageUrl: string | null;
  replacementProductId: string | null;
  isActive: boolean;
  version: number;
};

export function CatalogManager({
  seasons,
  initialProducts,
}: {
  seasons: SeasonChoice[];
  initialProducts: ManagedProduct[];
}) {
  const [products, setProducts] = useState(initialProducts);
  const [message, setMessage] = useState("");

  async function createProduct(formData: FormData) {
    const response = await fetch("/api/admin/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seasonId: formData.get("seasonId"),
        sku: formData.get("sku"),
        name: formData.get("name"),
        description: formData.get("description"),
        category: formData.get("category"),
        kind: formData.get("kind"),
        priceCents: Math.round(Number(formData.get("price")) * 100),
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error);
      return;
    }
    setProducts((current) => [...current, payload.product]);
    setMessage(`${payload.product.name} is now in the catalog.`);
  }

  async function updateProduct(
    product: ManagedProduct,
    changes: Partial<ManagedProduct>,
  ) {
    const response = await fetch("/api/admin/catalog", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: product.id, version: product.version, ...changes }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error);
      return;
    }
    setProducts((current) =>
      current.map((candidate) =>
        candidate.id === product.id ? payload.product : candidate,
      ),
    );
    setMessage(`Saved ${payload.product.name}.`);
  }

  async function archiveProduct(product: ManagedProduct) {
    const response = await fetch(
      `/api/admin/catalog?id=${encodeURIComponent(product.id)}&version=${product.version}`,
      {
      method: "DELETE",
      },
    );
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error);
      return;
    }
    setProducts((current) =>
      current.map((candidate) =>
        candidate.id === product.id
          ? { ...candidate, isActive: false, version: candidate.version + 1 }
          : candidate,
      ),
    );
    setMessage(`${product.name} was archived.`);
  }

  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
        Storefront
      </p>
      <h1 className="mt-2 text-4xl font-black">Catalog</h1>
      <p className="mt-3 text-[var(--muted)]">
        Manage gifts and add-ons across seasons. Replacement links are prepared
        here for the repeat-order release.
      </p>
      <form
        action={createProduct}
        className="mt-8 grid gap-4 rounded-3xl border border-[var(--border)] bg-white p-6 lg:grid-cols-4"
      >
        <h2 className="text-xl font-bold lg:col-span-4">Add a catalog item</h2>
        <label className="grid gap-2 text-sm font-semibold">
          Season
          <select className="rounded-xl border border-[var(--border)] px-3 py-2.5" name="seasonId">
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>{season.name}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Type
          <select className="rounded-xl border border-[var(--border)] px-3 py-2.5" name="kind">
            <option value="PACKAGE">Gift package</option>
            <option value="ADD_ON">Add-on</option>
            <option value="DONATION">Donation</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          SKU
          <input className="rounded-xl border border-[var(--border)] px-3 py-2.5" name="sku" required />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Price
          <input className="rounded-xl border border-[var(--border)] px-3 py-2.5" min="0" name="price" required step="0.01" type="number" />
        </label>
        <label className="grid gap-2 text-sm font-semibold lg:col-span-2">
          Name
          <input className="rounded-xl border border-[var(--border)] px-3 py-2.5" name="name" required />
        </label>
        <label className="grid gap-2 text-sm font-semibold lg:col-span-2">
          Category
          <input className="rounded-xl border border-[var(--border)] px-3 py-2.5" defaultValue="Gifts" name="category" />
        </label>
        <label className="grid gap-2 text-sm font-semibold lg:col-span-4">
          Description
          <textarea className="rounded-xl border border-[var(--border)] px-3 py-2.5" name="description" rows={2} />
        </label>
        <button className="rounded-xl bg-[var(--ink)] px-5 py-3 font-bold text-white lg:col-start-4" type="submit">
          Add item
        </button>
      </form>
      {message && (
        <p aria-live="polite" className="mt-4 rounded-xl bg-[var(--brand-soft)] px-4 py-3 text-sm font-semibold">
          {message}
        </p>
      )}
      <div className="mt-8 space-y-4">
        {products.map((product) => (
          <article
            className={`rounded-3xl border border-[var(--border)] bg-white p-6 ${product.isActive ? "" : "opacity-60"}`}
            key={product.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--brand)]">
                  {product.kind.replace("_", " ")} · {product.sku}
                </p>
                <h2 className="mt-1 text-xl font-bold">{product.name}</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {formatCurrency(product.priceCents)} · {product.category}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-bold"
                  onClick={() => updateProduct(product, { isActive: !product.isActive })}
                  type="button"
                >
                  {product.isActive ? "Hide" : "Publish"}
                </button>
                {product.isActive && (
                  <button
                    className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-bold text-[var(--danger)]"
                    onClick={() => archiveProduct(product)}
                    type="button"
                  >
                    Archive
                  </button>
                )}
              </div>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <label className="grid gap-2 text-sm font-semibold">
                Display name
                <input
                  className="rounded-xl border border-[var(--border)] px-3 py-2.5"
                  defaultValue={product.name}
                  onBlur={(event) => {
                    if (event.target.value !== product.name) updateProduct(product, { name: event.target.value });
                  }}
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                Price in cents
                <input
                  className="rounded-xl border border-[var(--border)] px-3 py-2.5"
                  defaultValue={product.priceCents}
                  min="0"
                  onBlur={(event) => {
                    const priceCents = Number(event.target.value);
                    if (priceCents !== product.priceCents) updateProduct(product, { priceCents });
                  }}
                  type="number"
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                Replacement link
                <select
                  className="rounded-xl border border-[var(--border)] px-3 py-2.5"
                  onChange={(event) => updateProduct(product, { replacementProductId: event.target.value || null })}
                  value={product.replacementProductId ?? ""}
                >
                  <option value="">Not mapped</option>
                  {products
                    .filter((candidate) => candidate.id !== product.id && candidate.kind === product.kind)
                    .map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                    ))}
                </select>
              </label>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
