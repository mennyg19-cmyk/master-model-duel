"use client";

import { useCallback, useState, type FormEvent } from "react";
import { formatCents } from "@/lib/catalog";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";

type SeasonRow = { id: string; name: string; status: "OPEN" | "CLOSED" };
type ProductRow = {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  basePriceCents: number;
  isActive: boolean;
  trackInventory: boolean;
  imageId: string | null;
  image: { url: string } | null;
  replacementId: string | null;
  replacement: { id: string; name: string } | null;
};
type AddOnRow = {
  id: string;
  name: string;
  priceCents: number;
  isActive: boolean;
  restrictions: { product: { id: string; name: string } }[];
};

async function requestJson(url: string, init?: RequestInit): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, error: body.error };
}

export function CatalogManager({
  seasons,
  initialProducts,
  initialAddOns,
}: {
  seasons: SeasonRow[];
  initialProducts: ProductRow[];
  initialAddOns: AddOnRow[];
}) {
  const [seasonId, setSeasonId] = useState(seasons[0]?.id ?? "");
  const [products, setProducts] = useState<ProductRow[]>(initialProducts);
  const [addOns, setAddOns] = useState<AddOnRow[]>(initialAddOns);
  const [error, setError] = useState<string | null>(null);

  const loadSeason = useCallback(async (targetSeasonId: string) => {
    const [productsResponse, addOnsResponse] = await Promise.all([
      fetch(`/api/admin/products?seasonId=${targetSeasonId}`),
      fetch(`/api/admin/add-ons?seasonId=${targetSeasonId}`),
    ]);
    if (productsResponse.ok) setProducts(await productsResponse.json());
    if (addOnsResponse.ok) setAddOns(await addOnsResponse.json());
  }, []);

  function switchSeason(nextSeasonId: string) {
    setSeasonId(nextSeasonId);
    void loadSeason(nextSeasonId);
  }

  async function act(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    const outcome = await action();
    if (!outcome.ok) setError(outcome.error ?? "Request failed.");
    await loadSeason(seasonId);
  }

  // --- create product form state ---
  const [newProduct, setNewProduct] = useState({ name: "", slug: "", category: "", price: "", trackInventory: true });

  async function createProduct(event: FormEvent) {
    event.preventDefault();
    await act(() =>
      requestJson("/api/admin/products", {
        method: "POST",
        body: JSON.stringify({
          seasonId,
          name: newProduct.name,
          slug: newProduct.slug,
          category: newProduct.category || null,
          basePriceCents: Math.round(Number(newProduct.price) * 100),
          trackInventory: newProduct.trackInventory,
        }),
      })
    );
    setNewProduct({ name: "", slug: "", category: "", price: "", trackInventory: true });
  }

  // --- create add-on form state ---
  const [newAddOn, setNewAddOn] = useState({ name: "", price: "", restrictedIds: [] as string[] });

  async function createAddOn(event: FormEvent) {
    event.preventDefault();
    await act(() =>
      requestJson("/api/admin/add-ons", {
        method: "POST",
        body: JSON.stringify({
          seasonId,
          name: newAddOn.name,
          priceCents: Math.round(Number(newAddOn.price) * 100),
          restrictedToProductIds: newAddOn.restrictedIds,
        }),
      })
    );
    setNewAddOn({ name: "", price: "", restrictedIds: [] });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <label htmlFor="season-select" className="text-sm font-medium">Season</label>
        <Select id="season-select" value={seasonId} onChange={(event) => switchSeason(event.target.value)}>
          {seasons.map((season) => (
            <option key={season.id} value={season.id}>
              {season.name} ({season.status})
            </option>
          ))}
        </Select>
      </div>

      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}

      <Card>
        <CardTitle>Products</CardTitle>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="py-2">Product</th>
              <th>Category</th>
              <th>Price</th>
              <th>Replaced by</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-b border-border" data-testid={`product-row-${product.slug}`}>
                <td className="py-2 pr-2">
                  <span className="flex items-center gap-2">
                    {product.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={product.image.url} alt="" className="h-8 w-8 rounded object-cover" />
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded bg-brand-soft text-xs" aria-hidden>—</span>
                    )}
                    {product.name}
                  </span>
                </td>
                <td className="pr-2">{product.category ?? "—"}</td>
                <td className="pr-2">{formatCents(product.basePriceCents)}</td>
                <td className="pr-2">
                  {/* Replacement-link editor shell (R-065): full mapping UI lands with repeat orders. */}
                  <Select
                    value={product.replacementId ?? ""}
                    aria-label={`Replacement for ${product.name}`}
                    onChange={(event) =>
                      act(() =>
                        requestJson(`/api/admin/products/${product.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ replacementId: event.target.value || null }),
                        })
                      )
                    }
                    className="max-w-40 text-xs"
                  >
                    <option value="">None</option>
                    {products
                      .filter((candidate) => candidate.id !== product.id)
                      .map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                  </Select>
                </td>
                <td className="pr-2">
                  <Badge tone={product.isActive ? "success" : "neutral"}>
                    {product.isActive ? "Active" : "Inactive"}
                  </Badge>
                </td>
                <td className="py-2 text-right">
                  <span className="flex justify-end gap-2">
                    <Button
                      variant="secondary"
                      onClick={() =>
                        act(() =>
                          requestJson(`/api/admin/products/${product.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ isActive: !product.isActive }),
                          })
                        )
                      }
                    >
                      {product.isActive ? "Deactivate" : "Activate"}
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => act(() => requestJson(`/api/admin/products/${product.id}`, { method: "DELETE" }))}
                    >
                      Delete
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-muted">No products in this season yet.</td>
              </tr>
            )}
          </tbody>
        </table>

        <form onSubmit={createProduct} className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4">
          <label className="text-xs">
            Name
            <Input required value={newProduct.name} onChange={(event) => setNewProduct({ ...newProduct, name: event.target.value })} className="mt-1 block" />
          </label>
          <label className="text-xs">
            Slug
            <Input required value={newProduct.slug} onChange={(event) => setNewProduct({ ...newProduct, slug: event.target.value })} placeholder="deluxe-basket" className="mt-1 block" />
          </label>
          <label className="text-xs">
            Category
            <Input value={newProduct.category} onChange={(event) => setNewProduct({ ...newProduct, category: event.target.value })} placeholder="Baskets" className="mt-1 block" />
          </label>
          <label className="text-xs">
            Price ($)
            <Input required type="number" step="0.01" min="0" value={newProduct.price} onChange={(event) => setNewProduct({ ...newProduct, price: event.target.value })} className="mt-1 block w-24" />
          </label>
          <label className="flex items-center gap-1 pb-2 text-xs">
            <input
              type="checkbox"
              checked={newProduct.trackInventory}
              onChange={(event) => setNewProduct({ ...newProduct, trackInventory: event.target.checked })}
              className="accent-brand"
            />
            Track inventory
          </label>
          <Button type="submit">Add product</Button>
        </form>
      </Card>

      <Card>
        <CardTitle>Add-ons</CardTitle>
        <ul className="space-y-2 text-sm">
          {addOns.map((addOn) => (
            <li key={addOn.id} className="flex items-center gap-3 border-b border-border pb-2">
              <span className="font-medium">{addOn.name}</span>
              <span className="text-muted">{formatCents(addOn.priceCents)}</span>
              <span className="text-xs text-muted">
                {addOn.restrictions.length === 0
                  ? "Any product"
                  : `Only: ${addOn.restrictions.map((restriction) => restriction.product.name).join(", ")}`}
              </span>
              <Badge tone={addOn.isActive ? "success" : "neutral"}>{addOn.isActive ? "Active" : "Inactive"}</Badge>
              <span className="ml-auto flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() =>
                    act(() =>
                      requestJson(`/api/admin/add-ons/${addOn.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ isActive: !addOn.isActive }),
                      })
                    )
                  }
                >
                  {addOn.isActive ? "Deactivate" : "Activate"}
                </Button>
                <Button variant="danger" onClick={() => act(() => requestJson(`/api/admin/add-ons/${addOn.id}`, { method: "DELETE" }))}>
                  Delete
                </Button>
              </span>
            </li>
          ))}
          {addOns.length === 0 && <li className="text-muted">No add-ons in this season yet.</li>}
        </ul>

        <form onSubmit={createAddOn} className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4">
          <label className="text-xs">
            Name
            <Input required value={newAddOn.name} onChange={(event) => setNewAddOn({ ...newAddOn, name: event.target.value })} className="mt-1 block" />
          </label>
          <label className="text-xs">
            Price ($)
            <Input required type="number" step="0.01" min="0" value={newAddOn.price} onChange={(event) => setNewAddOn({ ...newAddOn, price: event.target.value })} className="mt-1 block w-24" />
          </label>
          <label className="text-xs">
            Restrict to products (none = allowed on all)
            <select
              multiple
              value={newAddOn.restrictedIds}
              onChange={(event) =>
                setNewAddOn({
                  ...newAddOn,
                  restrictedIds: [...event.target.selectedOptions].map((option) => option.value),
                })
              }
              className="mt-1 block rounded-md border border-border bg-surface px-2 py-1 text-xs"
            >
              {products.map((product) => (
                <option key={product.id} value={product.id}>{product.name}</option>
              ))}
            </select>
          </label>
          <Button type="submit">Add add-on</Button>
        </form>
      </Card>
    </div>
  );
}
