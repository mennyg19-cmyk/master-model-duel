"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { centsToDollars } from "@/lib/foundation";

type Season = { id: string; name: string; year: number };
type Media = { id: string; url: string; pathname: string };
type Product = {
  id: string;
  season: Season;
  sku: string;
  name: string;
  kind: "PACKAGE" | "ADD_ON" | "DONATION";
  priceCents: number;
  isActive: boolean;
  media: Media | null;
  restrictedAddons: { addOnProductId: string; isRestricted: boolean; addOnProduct: { name: string } }[];
};
type CatalogState = { seasons: Season[]; products: Product[]; media: Media[] };

const initialCatalog: CatalogState = { seasons: [], products: [], media: [] };

export default function CatalogAdminPage() {
  const [catalog, setCatalog] = useState(initialCatalog);
  const [message, setMessage] = useState("");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  async function loadCatalog() {
    const response = await fetch("/api/admin/catalog");
    const body = await response.json();
    setMessage(response.ok ? "" : body.error);
    if (response.ok) setCatalog(body);
  }

  useEffect(() => {
    void Promise.resolve().then(loadCatalog);
  }, []);

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/catalog", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: editingProduct?.id,
        seasonId: form.get("seasonId"),
        sku: form.get("sku"),
        name: form.get("name"),
        kind: form.get("kind"),
        priceCents: Math.round(Number(form.get("priceDollars")) * 100),
        mediaId: form.get("mediaId") || null,
        isActive: form.get("isActive") === "on",
        restrictedAddons: form.getAll("addOnProductIds").map((addOnProductId) => ({
          addOnProductId,
          isRestricted: form.get("isRestricted") === "on",
        })),
      }),
    });
    const body = await response.json();
    setMessage(response.ok ? `${body.product.name} saved.` : body.error);
    if (response.ok) {
      event.currentTarget.reset();
      setEditingProduct(null);
      await loadCatalog();
    }
  }

  async function deleteProduct(product: Product) {
    if (!window.confirm(`Delete ${product.name}? This cannot be undone.`)) return;
    const response = await fetch("/api/admin/catalog", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: product.id }),
    });
    const body = await response.json();
    setMessage(response.ok ? body.message : body.error);
    if (response.ok) {
      if (editingProduct?.id === product.id) setEditingProduct(null);
      await loadCatalog();
    }
  }

  async function uploadMedia(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.set("file", file);
    const response = await fetch("/api/admin/media", { method: "POST", body: formData });
    const body = await response.json();
    setMessage(response.ok ? `Uploaded ${body.media.pathname}.` : body.error);
    if (response.ok) await loadCatalog();
  }

  return (
    <>
      <p className="eyebrow">Catalog management</p>
      <h1>Products, add-ons, and photos</h1>
      <p className="lead">Create, edit, and remove catalog products. Link add-ons to package products and record whether the link is restricted.</p>
      <div className="grid">
        <section className="card">
          <h2>{editingProduct ? `Edit ${editingProduct.name}` : "Add catalog item"}</h2>
          <form key={editingProduct?.id ?? "new"} onSubmit={saveProduct}>
            <label>Season<select defaultValue={editingProduct?.season.id} name="seasonId" required>{catalog.seasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}</select></label>
            <label>SKU<input defaultValue={editingProduct?.sku} name="sku" required /></label>
            <label>Name<input defaultValue={editingProduct?.name} name="name" required /></label>
            <label>Type<select defaultValue={editingProduct?.kind} name="kind"><option value="PACKAGE">Mishloach manos</option><option value="ADD_ON">Add-on</option><option value="DONATION">Donation</option></select></label>
            <label>Price in dollars<input defaultValue={editingProduct ? editingProduct.priceCents / 100 : ""} min="0" name="priceDollars" required step="0.01" type="number" /></label>
            <label>Photo<select defaultValue={editingProduct?.media?.id ?? ""} name="mediaId"><option value="">Needs a photo</option>{catalog.media.map((media) => <option key={media.id} value={media.id}>{media.pathname}</option>)}</select></label>
            <label><input defaultChecked={editingProduct?.isActive ?? true} name="isActive" type="checkbox" /> Visible in the catalog</label>
            <label>Allowed add-ons<select defaultValue={editingProduct?.restrictedAddons.map((addOn) => addOn.addOnProductId)} multiple name="addOnProductIds">{catalog.products.filter((product) => product.kind === "ADD_ON" && product.id !== editingProduct?.id).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
            <label><input defaultChecked={editingProduct?.restrictedAddons.some((addOn) => addOn.isRestricted) ?? true} name="isRestricted" type="checkbox" /> Restrict selected add-ons to this product</label>
            <button className="button" type="submit">Save item</button>
            {editingProduct && <button className="button secondary" onClick={() => setEditingProduct(null)} type="button">Cancel edit</button>}
          </form>
        </section>
        <section className="card">
          <h2>Media library</h2>
          <label>Upload product image<input accept="image/jpeg,image/png,image/webp" onChange={uploadMedia} type="file" /></label>
          <p>JPEG, PNG, or WebP only. Maximum size: 5 MB.</p>
          {catalog.media.map((media) => <img alt="" className="admin-thumbnail" key={media.id} src={media.url} />)}
        </section>
      </div>
      {message && <p role="status">{message}</p>}
      <section className="card">
        <h2>Replacement links</h2>
        <p>Replacement mappings are prepared during season lifecycle work. Use this shell to identify the source and replacement products before that workflow opens.</p>
        <label>Source product<select disabled><option>Select a catalog product</option>{catalog.products.map((product) => <option key={product.id}>{product.name}</option>)}</select></label>
        <label>Replacement product<select disabled><option>Select a catalog product</option>{catalog.products.map((product) => <option key={product.id}>{product.name}</option>)}</select></label>
        <button className="button secondary" disabled type="button">Save replacement link</button>
      </section>
      <section className="card catalog-list">
        <h2>Needs photos</h2>
        {catalog.products.filter((product) => !product.media).map((product) => <p key={product.id}>{product.season.year} · {product.name} ({product.kind})</p>)}
        <h2>Catalog</h2>
        {catalog.products.map((product) => <div key={product.id}><p>{product.season.year} · {product.name} · {centsToDollars(product.priceCents)} · {product.isActive ? "active" : "hidden"}{product.restrictedAddons.length ? ` · ${product.restrictedAddons.map((addOn) => addOn.addOnProduct.name).join(", ")}` : ""}</p><button className="button secondary" onClick={() => setEditingProduct(product)} type="button">Edit</button><button className="button secondary" onClick={() => void deleteProduct(product)} type="button">Delete</button></div>)}
      </section>
    </>
  );
}
