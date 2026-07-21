"use client";

import { useCallback, useState, type FormEvent } from "react";
import { apiFetch, type ApiResult } from "@/lib/api-client";
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

type ReplacementCandidate = { id: string; name: string; seasonId: string; isActive: boolean };

export function CatalogManager({
  seasons,
  initialProducts,
  initialAddOns,
  replacementCandidates,
}: {
  seasons: SeasonRow[];
  initialProducts: ProductRow[];
  initialAddOns: AddOnRow[];
  replacementCandidates: ReplacementCandidate[];
}) {
  const [seasonId, setSeasonId] = useState(seasons[0]?.id ?? "");
  const [products, setProducts] = useState<ProductRow[]>(initialProducts);
  const [addOns, setAddOns] = useState<AddOnRow[]>(initialAddOns);
  const [error, setError] = useState<string | null>(null);

  const loadSeason = useCallback(async (targetSeasonId: string) => {
    const [productsResult, addOnsResult] = await Promise.all([
      apiFetch<ProductRow[]>(`/api/admin/products?seasonId=${targetSeasonId}`),
      apiFetch<AddOnRow[]>(`/api/admin/add-ons?seasonId=${targetSeasonId}`),
    ]);
    if (productsResult.ok) setProducts(productsResult.body);
    if (addOnsResult.ok) setAddOns(addOnsResult.body);
  }, []);

  function switchSeason(nextSeasonId: string) {
    setSeasonId(nextSeasonId);
    void loadSeason(nextSeasonId);
  }

  async function act(action: () => Promise<ApiResult<unknown>>) {
    setError(null);
    const outcome = await action();
    if (!outcome.ok) setError(outcome.error);
    await loadSeason(seasonId);
  }

  // --- create product form state ---
  const [newProduct, setNewProduct] = useState({ name: "", slug: "", category: "", price: "", trackInventory: true });

  async function createProduct(event: FormEvent) {
    event.preventDefault();
    await act(() =>
      apiFetch("/api/admin/products", {
        body: {
          seasonId,
          name: newProduct.name,
          slug: newProduct.slug,
          category: newProduct.category || null,
          basePriceCents: Math.round(Number(newProduct.price) * 100),
          trackInventory: newProduct.trackInventory,
        },
      })
    );
    setNewProduct({ name: "", slug: "", category: "", price: "", trackInventory: true });
  }

  // --- create add-on form state ---
  const [newAddOn, setNewAddOn] = useState({ name: "", price: "", restrictedIds: [] as string[] });

  async function createAddOn(event: FormEvent) {
    event.preventDefault();
    await act(() =>
      apiFetch("/api/admin/add-ons", {
        body: {
          seasonId,
          name: newAddOn.name,
          priceCents: Math.round(Number(newAddOn.price) * 100),
          restrictedToProductIds: newAddOn.restrictedIds,
        },
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
                  {/* Replacement mapping (R-048): may point at any season's active product; repeat orders follow the chain. */}
                  <Select
                    value={product.replacementId ?? ""}
                    aria-label={`Replacement for ${product.name}`}
                    onChange={(event) =>
                      act(() =>
                        apiFetch(`/api/admin/products/${product.id}`, {
                          method: "PATCH",
                          body: { replacementId: event.target.value || null },
                        })
                      )
                    }
                    className="max-w-44 text-xs"
                  >
                    <option value="">None</option>
                    {seasons.map((seasonOption) => {
                      const seasonCandidates = replacementCandidates.filter(
                        (candidate) =>
                          candidate.seasonId === seasonOption.id &&
                          candidate.id !== product.id &&
                          (candidate.isActive || candidate.id === product.replacementId)
                      );
                      if (seasonCandidates.length === 0) return null;
                      return (
                        <optgroup key={seasonOption.id} label={seasonOption.name}>
                          {seasonCandidates.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.name}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
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
                          apiFetch(`/api/admin/products/${product.id}`, {
                            method: "PATCH",
                            body: { isActive: !product.isActive },
                          })
                        )
                      }
                    >
                      {product.isActive ? "Deactivate" : "Activate"}
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => act(() => apiFetch(`/api/admin/products/${product.id}`, { method: "DELETE" }))}
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
                      apiFetch(`/api/admin/add-ons/${addOn.id}`, {
                        method: "PATCH",
                        body: { isActive: !addOn.isActive },
                      })
                    )
                  }
                >
                  {addOn.isActive ? "Deactivate" : "Activate"}
                </Button>
                <Button variant="danger" onClick={() => act(() => apiFetch(`/api/admin/add-ons/${addOn.id}`, { method: "DELETE" }))}>
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
